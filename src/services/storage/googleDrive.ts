import { v4 as uuidv4 } from 'uuid'
import { createEmptyMeta, PhotoId, ProjectMeta, SCHEMA_VERSION, type FamilyData } from '@/core/schema'
import { prepareBrowserPhoto } from './browserPhotos'
import type { DriveApi, DriveFile } from './googleDriveClient'
import type { ProjectStorageProvider, StoredProject } from './types'

const FOLDER = 'application/vnd.google-apps.folder'
const JSON_MIME = 'application/json'
const REVISION_LIMIT = 51 * 1024 * 1024
const FAMILY_LIMIT = 50 * 1024 * 1024
const META_LIMIT = 1024 * 1024
const MEDIA_LIMIT = 25 * 1024 * 1024
const marker = { familyTree: '1' }

export class GoogleDriveConflictError extends Error {
  readonly heads: string[]

  constructor(heads: readonly string[], message = 'Google Drive 中存在其他版本，请先选择保留的内容并确认解决冲突。') {
    super(message)
    this.name = 'GoogleDriveConflictError'
    this.heads = [...heads].sort()
  }
}

interface Revision {
  formatVersion: 1
  projectId: string
  revisionId: string
  parents: string[]
  meta: ProjectMeta
  family: unknown
}

interface PendingRevision {
  metadata: DriveFile
  content: Blob
  revision: Revision
  familyText: string
}

interface ProjectState {
  base: string | null
  meta: ProjectMeta
  historical: boolean
  pending?: PendingRevision
}

export interface GoogleDriveStorage extends ProjectStorageProvider {
  listProjects(): Promise<Array<{ id: string; displayName: string }>>
  listVersions(projectId: string): Promise<Array<{ id: string; createdTime: string; isHead: boolean }>>
  loadVersion(projectId: string, revisionId: string): Promise<StoredProject>
  resolveConflict(projectId: string, family: FamilyData, expectedHeads: readonly string[]): Promise<void>
}

function invalid(message: string): never {
  throw new Error(`Google Drive 项目无效：${message}`)
}

function checkId(id: string): void {
  // IDs are opaque. Restrict only to Drive's URL-safe alphabet, including the
  // property budget (a key/value pair is limited to 124 UTF-8 bytes).
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) invalid('文件标识无效')
}

function tagged(file: DriveFile, kind: string): boolean {
  return file.trashed !== true && file.appProperties?.familyTree === '1' && file.appProperties.kind === kind
}

function checkProject(file: DriveFile, id: string): void {
  checkId(id)
  if (file.id !== id || file.mimeType !== FOLDER || !tagged(file, 'project')) invalid('所选文件夹不是本应用创建的项目')
}

function checkChild(file: DriveFile, projectId: string, kind: string, mime: string): void {
  checkId(file.id)
  if (!tagged(file, kind) || file.mimeType !== mime || file.appProperties?.project !== projectId ||
      file.parents?.length !== 1 || file.parents[0] !== projectId) invalid('文件不属于当前项目或已被移动')
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort()
  return left.length === right.length && [...left].sort().every((id, index) => id === sortedRight[index])
}

function query(kind: string, projectId?: string): string {
  if (projectId !== undefined) checkId(projectId)
  return `trashed = false and appProperties has { key='familyTree' and value='1' } and appProperties has { key='kind' and value='${kind}' }` +
    (projectId === undefined ? '' : ` and '${projectId}' in parents and appProperties has { key='project' and value='${projectId}' }`)
}

function indexedParents(file: DriveFile): string[] | null {
  const properties = file.appProperties ?? {}
  if (properties.merge === '1') {
    if (properties.parent !== undefined) invalid('版本父节点索引不一致')
    return null
  }
  if (properties.merge !== undefined) invalid('未知的版本父节点格式')
  if (properties.parent === undefined) return []
  checkId(properties.parent)
  return [properties.parent]
}

/**
 * Drive has no assumed compare-and-swap guarantee here. Every save creates a
 * new immutable snapshot. Competing saves remain separate heads until the user
 * explicitly publishes a revision naming all observed heads as parents.
 */
export function createGoogleDriveStorage(
  providerId: string,
  api: DriveApi,
  options: { preparePhoto?: typeof prepareBrowserPhoto } = {},
): GoogleDriveStorage {
  if (!providerId) throw new Error('Google Drive 存储连接标识不能为空')
  const states = new Map<string, ProjectState>()
  const queues = new Map<string, Promise<unknown>>()
  const preparePhoto = options.preparePhoto ?? prepareBrowserPhoto

  function serial<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(projectId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    queues.set(projectId, current)
    void current.finally(() => {
      if (queues.get(projectId) === current) queues.delete(projectId)
    }).catch(() => {})
    return current
  }

  async function project(id: string): Promise<DriveFile> {
    checkId(id)
    const file = await api.getFile(id)
    checkProject(file, id)
    return file
  }

  async function limitedRead(file: DriveFile, limit: number): Promise<Blob> {
    if (file.size !== undefined && (!/^\d+$/.test(file.size) || Number(file.size) > limit)) invalid('文件超过大小限制')
    const blob = await api.readFile(file.id, limit)
    if (blob.size > limit) invalid('文件超过大小限制')
    return blob
  }

  async function readRevision(file: DriveFile, projectId: string): Promise<Revision> {
    checkChild(file, projectId, 'revision', JSON_MIME)
    const blob = await limitedRead(file, REVISION_LIMIT)
    let value: unknown
    try { value = JSON.parse(await blob.text()) } catch { invalid('版本内容不是有效 JSON') }
    if (!value || typeof value !== 'object') invalid('版本内容格式错误')
    const record = value as Record<string, unknown>
    if (record.formatVersion !== 1 || record.projectId !== projectId || record.revisionId !== file.id ||
        !Array.isArray(record.parents) || record.parents.some(parent => typeof parent !== 'string')) invalid('版本身份或格式不一致')
    const parents = record.parents as string[]
    parents.forEach(checkId)
    if (new Set(parents).size !== parents.length || parents.includes(file.id)) invalid('版本父节点无效')
    const index = indexedParents(file)
    if (index === null ? parents.length < 2 : !sameIds(index, parents)) invalid('版本父节点索引与内容不一致')
    const meta = ProjectMeta.safeParse(record.meta)
    if (!meta.success || meta.data.schemaVersion > SCHEMA_VERSION) invalid('项目元数据格式或版本不受支持')
    if (new Blob([JSON.stringify(record.meta)]).size > META_LIMIT ||
        new Blob([JSON.stringify(record.family)]).size > FAMILY_LIMIT) invalid('家族数据或元数据超过大小限制')
    return { formatVersion: 1, projectId, revisionId: file.id, parents, meta: meta.data, family: record.family }
  }

  async function graph(projectId: string) {
    const folder = await project(projectId)
    const files = await api.listFiles(query('revision', projectId))
    const nodes = new Map<string, { file: DriveFile; parents: string[]; revision?: Revision }>()
    for (const file of files) {
      checkChild(file, projectId, 'revision', JSON_MIME)
      if (nodes.has(file.id)) invalid('版本列表包含重复文件')
      const parents = indexedParents(file)
      // Most revisions need only list metadata. Merge parent lists live in the
      // JSON body, avoiding Drive's 124-byte property and 30-property limits.
      const revision = parents === null ? await readRevision(file, projectId) : undefined
      nodes.set(file.id, { file, parents: parents ?? revision!.parents, revision })
    }
    const children = new Map<string, string[]>()
    const degrees = new Map<string, number>()
    for (const [id, node] of nodes) {
      degrees.set(id, node.parents.length)
      for (const parent of node.parents) {
        if (!nodes.has(parent)) invalid('版本历史缺失，请恢复被移动或删除的版本文件')
        children.set(parent, [...(children.get(parent) ?? []), id])
      }
    }
    const ready = [...nodes.keys()].filter(id => degrees.get(id) === 0)
    for (let index = 0; index < ready.length; index++) {
      for (const child of children.get(ready[index]) ?? []) {
        const count = degrees.get(child)! - 1
        degrees.set(child, count)
        if (count === 0) ready.push(child)
      }
    }
    if (ready.length !== nodes.size) invalid('版本历史包含循环引用')
    const heads = [...nodes.keys()].filter(id => !children.has(id)).sort()
    return { folder, nodes, heads }
  }

  async function persist(metadata: DriveFile, content?: Blob): Promise<void> {
    try {
      const created = await api.createFile(metadata, content)
      if (created.id !== metadata.id) invalid('服务器返回了不同的文件标识')
    } catch (uploadError) {
      // A lost response is not evidence of failure. Probe the pre-generated ID
      // and prove its contents before acknowledging or retrying that same ID.
      try {
        const existing = await api.getFile(metadata.id)
        if (existing.trashed || existing.mimeType !== metadata.mimeType || existing.name !== metadata.name ||
            (metadata.parents !== undefined && !sameIds(existing.parents ?? [], metadata.parents)) ||
            JSON.stringify(Object.entries(existing.appProperties ?? {}).sort()) !== JSON.stringify(Object.entries(metadata.appProperties ?? {}).sort())) throw uploadError
        if (content) {
          const actual = await limitedRead(existing, content.size)
          if (actual.size !== content.size) throw uploadError
          const left = new Uint8Array(await actual.arrayBuffer())
          const right = new Uint8Array(await content.arrayBuffer())
          if (!left.every((byte, index) => byte === right[index])) throw uploadError
        }
        return
      } catch {
        throw uploadError
      }
    }
  }

  async function finishPending(projectId: string, state: ProjectState): Promise<string | undefined> {
    const pending = state.pending
    if (!pending) return undefined
    await persist(pending.metadata, pending.content)
    // Clear only after confirmed persistence. A competing head is preserved;
    // callers remain dirty and must explicitly resolve the conflict.
    const current = await graph(projectId)
    state.pending = undefined
    if (!sameIds(current.heads, [pending.metadata.id])) throw new GoogleDriveConflictError(current.heads)
    state.base = pending.metadata.id
    state.meta = pending.revision.meta
    state.historical = false
    return pending.familyText
  }

  async function append(projectId: string, state: ProjectState, family: FamilyData, parents: string[]): Promise<void> {
    const familyText = JSON.stringify(family)
    if (new Blob([familyText]).size > FAMILY_LIMIT) invalid('家族数据超过 50 MiB 限制')
    const id = await api.generateId()
    checkId(id)
    const meta = { ...state.meta, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() }
    if (new Blob([JSON.stringify(meta)]).size > META_LIMIT) invalid('项目元数据超过 1 MiB 限制')
    const revision: Revision = {
      formatVersion: 1, projectId, revisionId: id, parents: [...parents], meta,
      family: JSON.parse(familyText),
    }
    const content = new Blob([JSON.stringify(revision)], { type: JSON_MIME })
    if (content.size > REVISION_LIMIT) invalid('版本快照超过 51 MiB 限制')
    state.pending = {
      metadata: {
        id, name: `revision-${id}.json`, mimeType: JSON_MIME, parents: [projectId],
        appProperties: {
          ...marker, kind: 'revision', project: projectId,
          ...(parents.length > 1 ? { merge: '1' } : parents.length === 1 ? { parent: parents[0] } : {}),
        },
      },
      content, revision, familyText,
    }
    await finishPending(projectId, state)
  }

  function stored(projectId: string, folder: DriveFile, revision: Revision): StoredProject {
    return { id: projectId, displayName: folder.name, meta: revision.meta, family: revision.family }
  }

  return {
    id: providerId,
    async listProjects() {
      const files = await api.listFiles(query('project') + ` and mimeType = '${FOLDER}'`)
      const seen = new Set<string>()
      return files.map(file => {
        checkProject(file, file.id)
        if (seen.has(file.id)) invalid('项目列表包含重复文件')
        seen.add(file.id)
        return { id: file.id, displayName: file.name }
      }).sort((left, right) => left.displayName.localeCompare(right.displayName))
    },
    async createProject(targetId, name) {
      if (targetId !== 'root') throw new Error('Google Drive 新项目只能创建在“我的云端硬盘”中')
      const meta = createEmptyMeta(name.trim() || '未命名家族')
      if (new Blob([JSON.stringify(meta)]).size > META_LIMIT) invalid('项目名称过长')
      const id = await api.generateId()
      checkId(id)
      await persist({ id, name: meta.name, mimeType: FOLDER, appProperties: { ...marker, kind: 'project' } })
      states.set(id, { base: null, meta, historical: false })
      return { id, displayName: meta.name, meta }
    },
    loadProject(projectId) {
      return serial(projectId, async () => {
        const current = await graph(projectId)
        if (current.heads.length > 1) throw new GoogleDriveConflictError(current.heads)
        if (current.heads.length === 0) invalid('项目尚未完成首次保存')
        const node = current.nodes.get(current.heads[0])!
        const revision = node.revision ?? await readRevision(node.file, projectId)
        states.set(projectId, { base: revision.revisionId, meta: revision.meta, historical: false })
        return stored(projectId, current.folder, revision)
      })
    },
    saveProject(projectId, family) {
      return serial(projectId, async () => {
        const state = states.get(projectId)
        if (!state) throw new Error('请先打开 Google Drive 项目，再保存修改')
        const completed = await finishPending(projectId, state)
        if (completed !== undefined && completed === JSON.stringify(family)) return
        const current = await graph(projectId)
        if (state.historical || !sameIds(current.heads, state.base === null ? [] : [state.base])) {
          throw new GoogleDriveConflictError(current.heads)
        }
        await append(projectId, state, family, [...current.heads])
      })
    },
    async listVersions(projectId) {
      const current = await graph(projectId)
      return [...current.nodes].map(([id, node]) => ({
        id, createdTime: node.file.createdTime ?? '', isHead: current.heads.includes(id),
      })).sort((left, right) => right.createdTime.localeCompare(left.createdTime) || left.id.localeCompare(right.id))
    },
    loadVersion(projectId, revisionId) {
      return serial(projectId, async () => {
        checkId(revisionId)
        const current = await graph(projectId)
        const node = current.nodes.get(revisionId)
        if (!node) invalid('该版本不属于当前项目')
        const revision = node.revision ?? await readRevision(node.file, projectId)
        states.set(projectId, { base: revisionId, meta: revision.meta, historical: true })
        return stored(projectId, current.folder, revision)
      })
    },
    resolveConflict(projectId, family, expectedHeads) {
      return serial(projectId, async () => {
        const state = states.get(projectId)
        if (!state) throw new Error('请先打开要保留的版本')
        const current = await graph(projectId)
        if (expectedHeads.length === 0 || new Set(expectedHeads).size !== expectedHeads.length ||
            !sameIds(current.heads, expectedHeads)) throw new GoogleDriveConflictError(current.heads, '远端版本再次发生变化，请重新查看并确认。')
        // A prior uncertain write must be resolved before starting a new one;
        // never silently drop a snapshot whose result is not known yet.
        if (state.pending) {
          const completed = await finishPending(projectId, state)
          if (completed === JSON.stringify(family)) return
          throw new GoogleDriveConflictError((await graph(projectId)).heads, '上次保存已确认，请重新查看远端版本后再确认。')
        }
        await append(projectId, state, family, [...expectedHeads].sort())
      })
    },
    async importPhoto(projectId, bytes, mime) {
      await project(projectId)
      const { photo, thumbnail } = await preparePhoto(bytes, mime)
      const photoId = uuidv4()
      for (const [kind, content] of [['photo', photo], ['thumbnail', thumbnail]] as const) {
        if (content.size === 0 || content.size > MEDIA_LIMIT || content.type !== 'image/webp') invalid('图片格式或大小无效')
        const id = await api.generateId()
        checkId(id)
        await persist({
          id, name: `${kind}-${photoId}.webp`, mimeType: 'image/webp', parents: [projectId],
          appProperties: { ...marker, kind, project: projectId, photoId },
        }, content)
      }
      // No reference escapes until both uploads are durable. Partial uploads
      // are retained rather than risking removal of media used by history.
      return { photoId }
    },
    async readPhoto(projectId, photoId, thumb) {
      PhotoId.parse(photoId)
      await project(projectId)
      const kind = thumb ? 'thumbnail' : 'photo'
      const files = await api.listFiles(query(kind, projectId) + ` and appProperties has { key='photoId' and value='${photoId}' }`)
      if (files.length !== 1) invalid(files.length ? '同一照片存在多个文件，请保留文件并检查云端项目' : '照片文件缺失')
      const file = files[0]
      checkChild(file, projectId, kind, 'image/webp')
      if (file.appProperties?.photoId !== photoId) invalid('照片标识不一致')
      const content = await limitedRead(file, MEDIA_LIMIT)
      return new Blob([content], { type: 'image/webp' })
    },
    async deletePhoto(projectId, photoId) {
      PhotoId.parse(photoId)
      await project(projectId)
      // Deleting a member removes the reference in the next revision. Old
      // snapshots must keep their images, so media is never physically deleted.
    },
  }
}
