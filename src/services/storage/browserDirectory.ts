import { createStore, entries, get, set } from 'idb-keyval'
import { v4 as uuidv4 } from 'uuid'
import { createEmptyFamily, createEmptyMeta, PhotoId, ProjectMeta, SCHEMA_VERSION } from '@/core/schema'
import type { ProjectPicker, ProjectStorageProvider } from './types'
import { prepareBrowserPhoto } from './browserPhotos'
import { openProjectBundle } from './projectBundle'
import type { CreatedProject } from './types'

const FAMILY_LIMIT = 50 * 1024 * 1024
const META_LIMIT = 1024 * 1024
const MEDIA_LIMIT = 25 * 1024 * 1024
const PROVIDER = 'browser-directory'

/** The browser's external-directory API, deliberately separate from OPFS. */
export interface DirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<DirectoryFileHandle>
  removeEntry(name: string): Promise<void>
  values(): AsyncIterable<DirectoryHandle | DirectoryFileHandle>
  isSameEntry(other: DirectoryHandle): Promise<boolean>
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

export interface DirectoryFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<Blob>
  isSameEntry(other: DirectoryFileHandle): Promise<boolean>
  createWritable(): Promise<{
    write(data: Blob | string): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}

export interface DirectoryRegistry {
  get(id: string): Promise<DirectoryHandle | undefined>
  entries(): Promise<Array<[string, DirectoryHandle]>>
  set(id: string, handle: DirectoryHandle): Promise<void>
}

type DirectoryErrorCode = 'unsupported' | 'permission-required' | 'missing-directory'
  | 'invalid-project' | 'conflict' | 'quota' | 'io'

export class BrowserDirectoryError extends Error {
  constructor(readonly code: DirectoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserDirectoryError'
  }
}

type DirectoryWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandle>
}

export function getDirectoryStorageAvailability(): { supported: boolean; reason: string | null } {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return { supported: false, reason: '本地目录需要通过 HTTPS 或 localhost 打开网页。' }
  }
  try {
    if (window.top && window.top.location.origin !== window.location.origin) {
      return { supported: false, reason: '请在独立窗口中打开应用，再选择本地目录。' }
    }
  } catch {
    return { supported: false, reason: '请在独立窗口中打开应用，再选择本地目录。' }
  }
  if (typeof (window as DirectoryWindow).showDirectoryPicker !== 'function') {
    return { supported: false, reason: '此浏览器不支持本地目录 API，请使用支持 showDirectoryPicker 的浏览器。' }
  }
  return { supported: true, reason: null }
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error || error instanceof DOMException ? error.name : undefined
}

function explain(error: unknown): Error {
  if (error instanceof BrowserDirectoryError) return error
  if (['NotAllowedError', 'SecurityError'].includes(errorName(error) ?? '')) {
    return new BrowserDirectoryError('permission-required', '目录访问权限已失效，请点击重新授权或重新选择原目录。', { cause: error })
  }
  if (errorName(error) === 'QuotaExceededError') {
    return new BrowserDirectoryError('quota', '写入失败：磁盘空间不足或浏览器拒绝继续写入。请释放空间后重试。', { cause: error })
  }
  return new BrowserDirectoryError('io', `本地目录操作失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
}

function invalid(message: string): never {
  throw new BrowserDirectoryError('invalid-project', message)
}

async function fileIfPresent(root: DirectoryHandle, name: string): Promise<DirectoryFileHandle | null> {
  try {
    return await root.getFileHandle(name)
  } catch (error) {
    if (errorName(error) === 'NotFoundError') return null
    throw error
  }
}

async function limitedFile(handle: DirectoryFileHandle, limit: number): Promise<Blob> {
  const file = await handle.getFile()
  if (file.size > limit) invalid(`${handle.name} 超过 ${limit / 1024 / 1024} MiB 限制`)
  return file
}

async function readText(root: DirectoryHandle, name: string, limit: number): Promise<string> {
  const handle = await fileIfPresent(root, name)
  if (!handle) invalid(`项目缺少 ${name}，请重新选择完整的家族项目目录。`)
  return (await limitedFile(handle, limit)).text()
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    invalid(`${name} 不是有效的 JSON；请保留目录并从备份恢复。`)
  }
}

/** createWritable stages writes; only successful close commits to the existing file. */
async function writeFile(root: DirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true })
  await writeHandle(handle, data)
}

async function writeHandle(handle: DirectoryFileHandle, data: Blob | string): Promise<void> {
  const writer = await handle.createWritable()
  try {
    await writer.write(data)
    await writer.close()
  } catch (error) {
    try { await writer.abort() } catch { /* The failed stream may already be closed. */ }
    throw error
  }
}

async function sameContents(left: Blob, right: Blob): Promise<boolean> {
  if (left.size !== right.size) return false
  const leftBytes = new Uint8Array(await left.arrayBuffer())
  const rightBytes = new Uint8Array(await right.arrayBuffer())
  return leftBytes.every((byte, index) => byte === rightBytes[index])
}

async function contentDigest(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Roll back only files this attempt created and whose content still matches it. */
function creationJournal() {
  // Keep only fingerprints, not source Blobs: a bundle can contain 1 GiB of
  // extracted media, while extraction and rollback must retain one file at a time.
  const files: Array<{
    parent: DirectoryHandle
    handle: DirectoryFileHandle
    size: number
    digest: string
    committed: boolean
  }> = []
  const directories: Array<{ parent: DirectoryHandle; handle: DirectoryHandle }> = []
  return {
    async write(parent: DirectoryHandle, name: string, data: Blob | string) {
      if (await fileIfPresent(parent, name)) invalid(`目标目录已出现 ${name}，已停止写入以避免覆盖。`)
      const blob = typeof data === 'string' ? new Blob([data]) : data
      // Hash before creating the file so a digest failure cannot leave an
      // untracked empty file. The array buffer dies after this one digest.
      const digest = await contentDigest(blob)
      const handle = await parent.getFileHandle(name, { create: true })
      if ((await handle.getFile()).size !== 0) invalid(`目标文件 ${name} 已被其他程序写入，已停止覆盖。`)
      const record = { parent, handle, size: blob.size, digest, committed: false }
      files.push(record)
      await writeHandle(handle, data)
      record.committed = true
    },
    async directory(parent: DirectoryHandle, name: string) {
      try {
        await parent.getDirectoryHandle(name)
        invalid(`目标目录已出现 ${name}，已停止导入以避免覆盖。`)
      } catch (error) {
        if (errorName(error) !== 'NotFoundError') throw error
      }
      const handle = await parent.getDirectoryHandle(name, { create: true })
      directories.push({ parent, handle })
      return handle
    },
    async cleanup() {
      for (const { parent, handle, size, digest, committed } of [...files].reverse()) {
        try {
          const current = await parent.getFileHandle(handle.name)
          if (!await current.isSameEntry(handle)) continue
          const actual = await current.getFile()
          // Empty means createWritable never committed; otherwise verify the
          // fingerprint without keeping any other file's bytes in memory.
          if ((committed || actual.size !== 0)
            && (actual.size !== size || await contentDigest(actual) !== digest)) continue
          await parent.removeEntry(handle.name)
        } catch { /* Preserve the original error and anything that may have changed. */ }
      }
      for (const { parent, handle } of [...directories].reverse()) {
        try {
          const current = await parent.getDirectoryHandle(handle.name)
          if (!await current.isSameEntry(handle)) continue
          let empty = true
          for await (const _entry of current.values()) { empty = false; break }
          if (empty) await parent.removeEntry(handle.name)
        } catch { /* Never recursively remove a directory during rollback. */ }
      }
    },
  }
}

interface ProjectBaseline {
  family: string
  createdAt: string
  name: string
}

export interface BrowserDirectoryOptions {
  registry: DirectoryRegistry
  pickDirectory(): Promise<DirectoryHandle>
  availability?: typeof getDirectoryStorageAvailability
  newId?: () => string
  withLock?: <T>(operation: () => Promise<T>) => Promise<T>
  preparePhoto?: typeof prepareBrowserPhoto
  openBundle?: typeof openProjectBundle
}

/** All instances share a lock: picking the same directory must also reuse its registry ID. */
let localQueue: Promise<unknown> = Promise.resolve()
function withDirectoryLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('family-tree:browser-directories', operation)
  }
  // The external directory API's supported browsers also implement Web Locks. This
  // queue still serializes one document if locks are unavailable in a test/embedder.
  const result = localQueue.then(operation, operation)
  localQueue = result.catch(() => undefined)
  return result
}

export function createBrowserDirectoryStorage(options: BrowserDirectoryOptions): {
  storage: ProjectStorageProvider
  picker: ProjectPicker & { authorizeProject(id: string): Promise<void> }
  importProjectBundle(targetId: string, input: Blob): Promise<CreatedProject>
} {
  const handles = new Map<string, DirectoryHandle>()
  const baselines = new Map<string, ProjectBaseline>()
  const withLock = options.withLock ?? withDirectoryLock
  const newId = options.newId ?? uuidv4
  const availability = options.availability ?? getDirectoryStorageAvailability

  function requireSupport() {
    const result = availability()
    if (!result.supported) throw new BrowserDirectoryError('unsupported', result.reason ?? '不支持本地目录')
  }

  async function handleFor(id: string): Promise<DirectoryHandle> {
    requireSupport()
    let handle = handles.get(id)
    if (!handle) {
      try { handle = await options.registry.get(id) } catch (error) {
        throw new BrowserDirectoryError('missing-directory', '无法恢复目录授权记录，请重新选择原目录。项目文件仍保存在原目录。', { cause: error })
      }
      if (!handle || handle.kind !== 'directory') {
        throw new BrowserDirectoryError('missing-directory', '目录授权记录已被清除，请重新选择原目录。项目文件仍保存在原目录。')
      }
      // Restore before checking permission: the subsequent user click can request
      // permission synchronously, without losing activation to an IndexedDB read.
      handles.set(id, handle)
    }
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new BrowserDirectoryError('permission-required', '需要重新授权此目录，请点击重新授权或重新选择原目录。')
    }
    return handle
  }

  async function markers(root: DirectoryHandle, id: string): Promise<{ meta: ProjectMeta; family: DirectoryFileHandle }> {
    const meta = ProjectMeta.safeParse(parseJson(await readText(root, 'meta.json', META_LIMIT), 'meta.json'))
    if (!meta.success) invalid('meta.json 项目标记无效，请重新选择完整的项目目录。')
    if (meta.data.schemaVersion > SCHEMA_VERSION) invalid('项目元数据版本过新，当前版本不支持。')
    const family = await fileIfPresent(root, 'family.json')
    if (!family) invalid('项目缺少 family.json，请重新选择完整的家族项目目录。')
    await limitedFile(family, FAMILY_LIMIT)
    const baseline = baselines.get(id)
    if (baseline && (baseline.createdAt !== meta.data.createdAt || baseline.name !== meta.data.name)) {
      throw new BrowserDirectoryError('conflict', '目录中的项目标记已被其他程序更改，请重新打开项目后再操作。')
    }
    return { meta: meta.data, family }
  }

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await withLock(operation) } catch (error) { throw explain(error) }
  }

  async function mediaDirectory(root: DirectoryHandle, thumb: boolean, create: boolean) {
    return (await root.getDirectoryHandle('media', { create }))
      .getDirectoryHandle(thumb ? 'thumbs' : 'photos', { create })
  }

  function validatePhotoId(photoId: string) {
    if (!PhotoId.safeParse(photoId).success) invalid('照片标识无效')
  }

  const storage: ProjectStorageProvider = {
    id: PROVIDER,
    createProject(id, name) {
      return run(async () => {
        const root = await handleFor(id)
        const trimmedName = name.trim()
        if (!trimmedName || [...trimmedName].length > 100) invalid('项目名称须为 1 到 100 个字符')
        for await (const _entry of root.values()) invalid('请选择空目录创建项目，已有项目请使用“打开”。')
        const meta = createEmptyMeta(trimmedName)
        const family = JSON.stringify(createEmptyFamily())
        const journal = creationJournal()
        try {
          await journal.write(root, 'meta.json', JSON.stringify(meta, null, 2))
          await journal.write(root, 'family.json', family)
        } catch (error) {
          await journal.cleanup()
          throw error
        }
        baselines.set(id, { family, createdAt: meta.createdAt, name: meta.name })
        return { id, displayName: root.name, meta }
      })
    },
    loadProject(id) {
      return run(async () => {
        const root = await handleFor(id)
        // An explicit reload intentionally starts a new snapshot, including an
        // externally renamed project. Media/auto-save never reset this baseline.
        const previous = baselines.get(id)
        baselines.delete(id)
        try {
          const { meta } = await markers(root, id)
          const text = await readText(root, 'family.json', FAMILY_LIMIT)
          const family = parseJson(text, 'family.json')
          baselines.set(id, { family: text, createdAt: meta.createdAt, name: meta.name })
          return { id, displayName: root.name, meta, family }
        } catch (error) {
          if (previous) baselines.set(id, previous)
          throw error
        }
      })
    },
    saveProject(id, family) {
      return run(async () => {
        const root = await handleFor(id)
        const { meta } = await markers(root, id)
        const baseline = baselines.get(id)
        if (!baseline) invalid('请先打开项目，再保存修改。')
        if (family.schemaVersion !== SCHEMA_VERSION) invalid(`schemaVersion 必须为 ${SCHEMA_VERSION}`)
        const next = JSON.stringify(family)
        if (new Blob([next]).size > FAMILY_LIMIT) invalid('family.json 超过 50 MiB 限制')
        const current = await readText(root, 'family.json', FAMILY_LIMIT)
        if (current !== baseline.family) {
          throw new BrowserDirectoryError('conflict', 'family.json 已被其他窗口或程序修改。为避免覆盖，已停止保存；请保留当前修改并重新打开项目。')
        }
        if (current === next) return
        // Copy instead of move: any failed backup leaves the main file intact.
        for (let i = 2; i >= 1; i--) {
          const source = await fileIfPresent(root, `family.json.bak.${i}`)
          if (source) await writeFile(root, `family.json.bak.${i + 1}`, await limitedFile(source, FAMILY_LIMIT))
        }
        await writeFile(root, 'family.json.bak.1', current)
        await writeFile(root, 'meta.json', JSON.stringify({ ...meta, updatedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION }, null, 2))
        if (await readText(root, 'family.json', FAMILY_LIMIT) !== current) {
          throw new BrowserDirectoryError('conflict', '保存期间项目被其他程序修改，已停止覆盖，请重新打开项目。')
        }
        await writeFile(root, 'family.json', next)
        baseline.family = next
      })
    },
    importPhoto(id, bytes, mime) {
      return run(async () => {
        const root = await handleFor(id)
        await markers(root, id)
        const prepared = await (options.preparePhoto ?? prepareBrowserPhoto)(bytes, mime)
        await markers(root, id)
        const photoId = newId()
        validatePhotoId(photoId)
        const photos = await mediaDirectory(root, false, true)
        const thumbs = await mediaDirectory(root, true, true)
        if (await fileIfPresent(photos, `${photoId}.webp`) || await fileIfPresent(thumbs, `${photoId}.webp`)) {
          invalid('生成的照片标识已存在，请重试。')
        }
        const journal = creationJournal()
        try {
          await journal.write(photos, `${photoId}.webp`, prepared.photo)
          await journal.write(thumbs, `${photoId}.webp`, prepared.thumbnail)
        } catch (error) {
          await journal.cleanup()
          throw error
        }
        return { photoId }
      })
    },
    readPhoto(id, photoId, thumb) {
      return run(async () => {
        validatePhotoId(photoId)
        const root = await handleFor(id)
        await markers(root, id)
        const directory = await mediaDirectory(root, thumb, false)
        const file = await limitedFile(await directory.getFileHandle(`${photoId}.webp`), MEDIA_LIMIT)
        return new Blob([file], { type: 'image/webp' })
      })
    },
    deletePhoto(id, photoId) {
      return run(async () => {
        validatePhotoId(photoId)
        const root = await handleFor(id)
        await markers(root, id)
        const found: Array<{ directory: DirectoryHandle; handle: DirectoryFileHandle; file: Blob; thumb: boolean }> = []
        for (const thumb of [false, true]) {
          let directory: DirectoryHandle
          try { directory = await mediaDirectory(root, thumb, false) } catch (error) {
            if (errorName(error) === 'NotFoundError') continue
            throw error
          }
          const handle = await fileIfPresent(directory, `${photoId}.webp`)
          if (handle) found.push({ directory, handle, file: await limitedFile(handle, MEDIA_LIMIT), thumb })
        }
        if (!found.length) return
        const trash = await root.getDirectoryHandle('.trash', { create: true })
        const deletionId = newId()
        const journal = creationJournal()
        // Preserve BOTH copies before deleting either original.
        for (const entry of found) {
          await journal.write(trash, `${photoId}-${entry.thumb ? 'thumb' : 'photo'}-${deletionId}.webp`, entry.file)
        }
        await markers(root, id)
        for (const entry of found) {
          const current = await entry.directory.getFileHandle(`${photoId}.webp`)
          if (!await current.isSameEntry(entry.handle) || !await sameContents(await current.getFile(), entry.file)) {
            throw new BrowserDirectoryError('conflict', '照片在删除前被其他程序修改，已保留原文件及垃圾箱副本。')
          }
        }
        for (const entry of found) await entry.directory.removeEntry(`${photoId}.webp`)
      })
    },
  }

  const picker: ProjectPicker & { authorizeProject(id: string): Promise<void> } = {
    providerId: PROVIDER,
    async pickProject(_mode) {
      requireSupport()
      let selected: DirectoryHandle
      try {
        // No await before this call: the browser requires the original click's activation.
        selected = await options.pickDirectory()
      } catch (error) {
        if (errorName(error) === 'AbortError') return null
        throw explain(error)
      }
      return run(async () => {
        for (const [id, handle] of await options.registry.entries()) {
          if (await selected.isSameEntry(handle)) {
            await options.registry.set(id, selected)
            handles.set(id, selected)
            return { id, displayName: selected.name }
          }
        }
        const id = newId()
        await options.registry.set(id, selected)
        handles.set(id, selected)
        return { id, displayName: selected.name }
      })
    },
    async authorizeProject(id) {
      requireSupport()
      const handle = handles.get(id)
      if (!handle) throw new BrowserDirectoryError('missing-directory', '请重新选择原目录以恢复访问权限。')
      try {
        // This call must happen synchronously in a user click, never in background IO.
        if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
          throw new BrowserDirectoryError('permission-required', '目录授权未获允许，请重新授权或选择原目录。')
        }
      } catch (error) { throw explain(error) }
    },
  }
  return {
    storage,
    picker,
    importProjectBundle(targetId, input) {
      return run(async () => {
        const root = await handleFor(targetId)
        for await (const _entry of root.values()) invalid('请选择空目录导入备份，现有文件不会被覆盖。')
        const bundle = await (options.openBundle ?? openProjectBundle)(input)
        const journal = creationJournal()
        let closed = false
        try {
          const family = JSON.stringify(bundle.family)
          const meta = JSON.stringify(bundle.meta, null, 2)
          if (new Blob([family]).size > FAMILY_LIMIT || new Blob([meta]).size > META_LIMIT) {
            invalid('备份中的项目数据超过大小限制。')
          }
          let media: DirectoryHandle | undefined
          const buckets = new Map<string, DirectoryHandle>()
          for await (const entry of bundle.files()) {
            const match = /^media\/(photos|thumbs)\/([A-Za-z0-9_-]{1,128})\.webp$/.exec(entry.path)
            if (!match || entry.data.size > MEDIA_LIMIT) invalid('备份包含非法媒体路径或过大的照片。')
            media ??= await journal.directory(root, 'media')
            const bucket = match[1]
            let directory = buckets.get(bucket)
            if (!directory) {
              directory = await journal.directory(media, bucket)
              buckets.set(bucket, directory)
            }
            await journal.write(directory, `${match[2]}.webp`, entry.data)
          }
          await bundle.close()
          closed = true
          // Project markers appear only after the complete media archive was read.
          await journal.write(root, 'family.json', family)
          await journal.write(root, 'meta.json', meta)
          baselines.set(targetId, { family, createdAt: bundle.meta.createdAt, name: bundle.meta.name })
          return { id: targetId, displayName: root.name, meta: bundle.meta }
        } catch (error) {
          await journal.cleanup()
          throw error
        } finally {
          if (!closed) await bundle.close().catch(() => undefined)
        }
      })
    },
  }
}

// Keep IndexedDB lazy so native builds and unsupported browsers can import the
// shared storage entry point without opening a browser database.
let directoryStore: ReturnType<typeof createStore> | undefined
function registryStore() {
  return directoryStore ??= createStore('family-tree-directories', 'handles')
}
const browserDirectory = createBrowserDirectoryStorage({
  registry: {
    get: id => get<DirectoryHandle>(id, registryStore()),
    entries: () => entries<string, DirectoryHandle>(registryStore()),
    set: (id, handle) => set(id, handle, registryStore()),
  },
  pickDirectory() {
    const picker = (window as DirectoryWindow).showDirectoryPicker
    if (!picker) throw new BrowserDirectoryError('unsupported', '此浏览器不支持本地目录 API。')
    return picker.call(window, { mode: 'readwrite', id: 'family-tree-project' })
  },
})

export const browserDirectoryStorage = browserDirectory.storage
export const browserDirectoryPicker = browserDirectory.picker
export const importBrowserProjectBundle = browserDirectory.importProjectBundle
