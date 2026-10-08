import { describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, type FamilyData } from '@/core/schema'
import { createGoogleDriveStorage, GoogleDriveConflictError } from './googleDrive'
import type { DriveApi, DriveFile } from './googleDriveClient'

class MemoryDrive implements DriveApi {
  files = new Map<string, DriveFile>()
  contents = new Map<string, Blob>()
  sequence = 0
  creates: string[] = []
  reads: string[] = []
  beforeCreate?: (file: DriveFile) => Promise<void>
  afterCreate?: (file: DriveFile) => Promise<void>
  beforeGet?: (id: string) => Promise<void>
  beforeList?: (query: string) => Promise<void>

  async getAccount() { return { permissionId: 'account-one', displayName: '测试用户' } }
  async generateId() { return `file-${++this.sequence}` }
  async getFile(id: string): Promise<DriveFile> {
    await this.beforeGet?.(id)
    const file = this.files.get(id)
    if (!file) throw new Error('not found')
    return structuredClone(file)
  }
  async renameFile(id: string, name: string): Promise<DriveFile> {
    const file = await this.getFile(id)
    file.name = name
    this.files.set(id, file)
    return structuredClone(file)
  }
  async listFiles(query: string): Promise<DriveFile[]> {
    await this.beforeList?.(query)
    const properties = [...query.matchAll(/key='([^']+)' and value='([^']+)'/g)]
    const parent = /'([^']+)' in parents/.exec(query)?.[1]
    const mime = /mimeType = '([^']+)'/.exec(query)?.[1]
    return [...this.files.values()].filter(file => !file.trashed &&
      properties.every(([, key, value]) => file.appProperties?.[key] === value) &&
      (!parent || file.parents?.includes(parent)) && (!mime || file.mimeType === mime)).map(file => structuredClone(file))
  }
  async readFile(id: string, maxBytes: number): Promise<Blob> {
    this.reads.push(id)
    const content = this.contents.get(id)
    if (!content) throw new Error('not found')
    if (content.size > maxBytes) throw new Error('too large')
    return content
  }
  async createFile(metadata: DriveFile, content?: Blob): Promise<DriveFile> {
    this.creates.push(metadata.id)
    await this.beforeCreate?.(metadata)
    if (this.files.has(metadata.id)) throw new Error('conflict: existing ID')
    const file = { ...structuredClone(metadata), isAppAuthorized: true,
      capabilities: { canAddChildren: true, canRename: true },
      createdTime: new Date(this.sequence * 1000).toISOString(), size: String(content?.size ?? 0) }
    this.files.set(file.id, file)
    if (content) this.contents.set(file.id, content)
    await this.afterCreate?.(metadata)
    return structuredClone(file)
  }
}

function family(label: string): FamilyData {
  return { ...createEmptyFamily(), testLabel: label }
}

async function fixture() {
  const api = new MemoryDrive()
  const provider = createGoogleDriveStorage('google-drive:account-one', api)
  const created = await provider.createProject('root', '测试家族')
  await provider.saveProject(created.id, family('initial'))
  return { api, provider, projectId: created.id }
}

async function revision(api: MemoryDrive, id: string) {
  return JSON.parse(await api.contents.get(id)!.text())
}

describe('Google Drive immutable project storage', () => {
  it.each([
    { isAppAuthorized: false, capabilities: { canAddChildren: true, canRename: true } },
    { isAppAuthorized: undefined, capabilities: { canAddChildren: true } },
    { isAppAuthorized: true, capabilities: undefined },
  ])('requires both app authorization and folder capabilities before writing: %j', async permissions => {
    const { api, provider, projectId } = await fixture()
    Object.assign(api.files.get(projectId)!, permissions)
    expect((await provider.loadProject(projectId)).access).toEqual({ canEdit: false, canRename: false })
    const writes = api.creates.length
    await expect(provider.saveProject(projectId, family('forbidden'))).rejects.toThrow('仅查看')
    expect(api.creates).toHaveLength(writes)
  })

  it('discovers and loads shared projects but refuses writes when the folder cannot accept children', async () => {
    const { api, projectId } = await fixture()
    Object.assign(api.files.get(projectId)!, { capabilities: { canAddChildren: false, canRename: false } })
    const reader = createGoogleDriveStorage('google-drive:recipient', api)
    expect(await reader.listProjects()).toContainEqual({ id: projectId, displayName: '测试家族' })
    expect(await reader.loadProject(projectId)).toMatchObject({
      family: family('initial'), access: { canEdit: false, canRename: false },
    })
    const writes = api.creates.length
    await expect(reader.saveProject(projectId, family('forbidden'))).rejects.toThrow('仅查看')
    await expect(reader.renameProject!(projectId, 'forbidden')).rejects.toThrow('仅查看')
    await expect(reader.importPhoto(projectId, new Uint8Array([1]), 'image/png')).rejects.toThrow('仅查看')
    expect(api.creates).toHaveLength(writes)
  })

  it('creates discoverable projects and keeps every saved snapshot across fresh connections', async () => {
    const { api, provider, projectId } = await fixture()
    await provider.saveProject(projectId, family('changed'))
    const fresh = createGoogleDriveStorage('google-drive:account-one', api)
    expect(await fresh.listProjects()).toEqual([{ id: projectId, displayName: '测试家族' }])
    expect((await fresh.loadProject(projectId)).family).toEqual(family('changed'))
    const versions = await fresh.listVersions(projectId)
    expect(versions).toHaveLength(2)
    expect(versions.filter(version => version.isHead)).toHaveLength(1)
    const latest = versions.find(version => version.isHead)!
    const first = versions.find(version => !version.isHead)!
    expect((await revision(api, latest.id)).parents).toEqual([first.id])
    expect((await revision(api, first.id)).family).toEqual(family('initial'))
    expect(provider.gcMedia).toBeUndefined()
  })

  it('does not download every ordinary historical snapshot to discover the head', async () => {
    const { api, provider, projectId } = await fixture()
    await provider.saveProject(projectId, family('second'))
    await provider.saveProject(projectId, family('third'))
    api.reads = []
    const loaded = await createGoogleDriveStorage('google-drive:account-one', api).loadProject(projectId)
    expect(loaded.family).toEqual(family('third'))
    expect(api.reads).toHaveLength(1)
  })

  it('requires a loaded baseline and restricts the creation target', async () => {
    const { api, projectId } = await fixture()
    const fresh = createGoogleDriveStorage('google-drive:account-one', api)
    await expect(fresh.saveProject(projectId, family('unsafe'))).rejects.toThrow('先打开')
    await expect(fresh.createProject(projectId, 'nested')).rejects.toThrow('我的云端硬盘')
    expect(api.files.size).toBe(2)
  })

  it('rejects stale saves before creating a revision', async () => {
    const { api, provider, projectId } = await fixture()
    const other = createGoogleDriveStorage('google-drive:account-one', api)
    await other.loadProject(projectId)
    await provider.saveProject(projectId, family('newer'))
    const count = api.files.size
    await expect(other.saveProject(projectId, family('stale'))).rejects.toBeInstanceOf(GoogleDriveConflictError)
    expect(api.files.size).toBe(count)
    expect((await provider.loadProject(projectId)).family).toEqual(family('newer'))
  })

  it('retains racing writes as two heads, then explicitly resolves and retains both histories', async () => {
    const { api, provider, projectId } = await fixture()
    const other = createGoogleDriveStorage('google-drive:account-one', api)
    await other.loadProject(projectId)
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    let arrivals = 0
    api.beforeCreate = async file => {
      if (file.appProperties?.kind !== 'revision') return
      if (++arrivals === 2) release()
      await barrier
    }
    const results = await Promise.allSettled([
      provider.saveProject(projectId, family('device one')),
      other.saveProject(projectId, family('device two')),
    ])
    expect(results.every(result => result.status === 'rejected' && result.reason instanceof GoogleDriveConflictError)).toBe(true)
    api.beforeCreate = undefined
    const versions = await provider.listVersions(projectId)
    const heads = versions.filter(version => version.isHead).map(version => version.id)
    expect(heads).toHaveLength(2)
    await expect(provider.loadProject(projectId)).rejects.toMatchObject({ heads: [...heads].sort() })
    await provider.resolveConflict(projectId, family('resolved'), heads)
    expect((await provider.loadProject(projectId)).family).toEqual(family('resolved'))
    const all = await provider.listVersions(projectId)
    expect(all).toHaveLength(4)
    const merge = all.find(version => version.isHead)!
    expect((await revision(api, merge.id)).parents).toEqual([...heads].sort())
    expect(api.files.get(merge.id)?.appProperties).toMatchObject({ merge: '1' })
    expect(api.files.get(merge.id)?.appProperties?.parent).toBeUndefined()
    expect(await Promise.all(heads.map(async id => (await revision(api, id)).family.testLabel))).toEqual(expect.arrayContaining(['device one', 'device two']))
  })

  it('refuses confirmation against heads which changed after the user reviewed them', async () => {
    const { api, provider, projectId } = await fixture()
    const reviewed = (await provider.listVersions(projectId)).filter(v => v.isHead).map(v => v.id)
    const other = createGoogleDriveStorage('google-drive:account-one', api)
    await other.loadProject(projectId)
    await other.saveProject(projectId, family('arrived later'))
    const count = api.files.size
    await expect(provider.resolveConflict(projectId, family('mine'), reviewed)).rejects.toThrow('再次发生变化')
    expect(api.files.size).toBe(count)
  })

  it('loads old versions without silently making them the current version', async () => {
    const { api, provider, projectId } = await fixture()
    const first = (await provider.listVersions(projectId))[0].id
    await provider.saveProject(projectId, family('current'))
    const currentHeads = (await provider.listVersions(projectId)).filter(v => v.isHead).map(v => v.id)
    const selected = await provider.loadVersion(projectId, first)
    expect(selected.family).toEqual(family('initial'))
    await expect(provider.saveProject(projectId, family('initial'))).rejects.toBeInstanceOf(GoogleDriveConflictError)
    await provider.resolveConflict(projectId, family('initial'), currentHeads)
    expect((await createGoogleDriveStorage('google-drive:account-one', api).loadProject(projectId)).family).toEqual(family('initial'))
    expect(await provider.listVersions(projectId)).toHaveLength(3)
  })

  it('treats even explicitly selected current versions as requiring confirmation', async () => {
    const { provider, projectId } = await fixture()
    const head = (await provider.listVersions(projectId))[0].id
    await provider.loadVersion(projectId, head)
    await expect(provider.saveProject(projectId, family('edit'))).rejects.toBeInstanceOf(GoogleDriveConflictError)
    await provider.resolveConflict(projectId, family('edit'), [head])
    await expect(provider.saveProject(projectId, family('another edit'))).resolves.toBeUndefined()
  })

  it('verifies a persisted snapshot after an upload response is lost', async () => {
    const { api, provider, projectId } = await fixture()
    api.afterCreate = async () => { throw new Error('connection lost after commit') }
    await provider.saveProject(projectId, family('response lost'))
    expect((await provider.loadProject(projectId)).family).toEqual(family('response lost'))
    expect(api.files.size).toBe(3)
  })

  it('retries an uncertain upload with the same fixed ID instead of making duplicate snapshots', async () => {
    const { api, provider, projectId } = await fixture()
    api.afterCreate = async () => { throw new Error('lost response') }
    api.beforeGet = async id => { if (id !== projectId) throw new Error('still offline') }
    await expect(provider.saveProject(projectId, family('durable but uncertain'))).rejects.toThrow('lost response')
    const sequence = api.sequence
    api.afterCreate = undefined
    api.beforeGet = undefined
    await provider.saveProject(projectId, family('durable but uncertain'))
    expect(api.sequence).toBe(sequence)
    expect(api.creates.at(-1)).toBe(api.creates.at(-2))
    expect((await provider.loadProject(projectId)).family).toEqual(family('durable but uncertain'))
    expect(api.files.size).toBe(3)
  })

  it('finishes an uncertain older snapshot before saving newer local edits', async () => {
    const { api, provider, projectId } = await fixture()
    api.beforeCreate = async () => { throw new Error('offline before commit') }
    await expect(provider.saveProject(projectId, family('older unsent'))).rejects.toThrow('offline')
    api.beforeCreate = undefined
    await provider.saveProject(projectId, family('newer local'))
    expect((await provider.loadProject(projectId)).family).toEqual(family('newer local'))
    expect(await provider.listVersions(projectId)).toHaveLength(3)
  })

  it('retains pending confirmation when the post-upload graph request fails', async () => {
    const { api, provider, projectId } = await fixture()
    api.afterCreate = async () => { api.beforeList = async () => { throw new Error('listing offline') } }
    await expect(provider.saveProject(projectId, family('confirmed next retry'))).rejects.toThrow('listing offline')
    api.afterCreate = undefined
    api.beforeList = undefined
    const sequence = api.sequence
    await provider.saveProject(projectId, family('confirmed next retry'))
    expect(api.sequence).toBe(sequence)
    expect((await provider.loadProject(projectId)).family).toEqual(family('confirmed next retry'))
  })

  it('does not acknowledge an existing ID whose contents do not match the pending upload', async () => {
    const { api, provider, projectId } = await fixture()
    api.afterCreate = async file => {
      api.contents.set(file.id, new Blob(['corrupt']))
      throw new Error('response lost')
    }
    await expect(provider.saveProject(projectId, family('wanted'))).rejects.toThrow('response lost')
    api.afterCreate = undefined
    await expect(provider.saveProject(projectId, family('wanted'))).rejects.toThrow('existing ID')
    expect(api.sequence).toBe(3)
  })

  it('rejects foreign projects, trashed folders, and versions from another project', async () => {
    const { api, provider, projectId } = await fixture()
    const second = await provider.createProject('root', 'another')
    await provider.saveProject(second.id, family('second project'))
    const foreignRevision = (await provider.listVersions(second.id))[0].id
    await expect(provider.loadVersion(projectId, foreignRevision)).rejects.toThrow('不属于当前项目')
    api.files.get(projectId)!.appProperties = {}
    await expect(provider.loadProject(projectId)).rejects.toThrow('不是本应用创建')
    api.files.get(projectId)!.appProperties = { familyTree: '1', kind: 'project' }
    api.files.get(projectId)!.trashed = true
    await expect(provider.loadProject(projectId)).rejects.toThrow('不是本应用创建')
  })

  it('validates revision identity and its parent index against the saved JSON', async () => {
    const { api, provider, projectId } = await fixture()
    const id = (await provider.listVersions(projectId))[0].id
    const original = await revision(api, id)
    api.contents.set(id, new Blob([JSON.stringify({ ...original, projectId: 'foreign' })]))
    await expect(provider.loadProject(projectId)).rejects.toThrow('版本身份')
    api.contents.set(id, new Blob([JSON.stringify({ ...original, parents: ['invented-parent'] })]))
    await expect(provider.loadProject(projectId)).rejects.toThrow('索引与内容不一致')
  })

  it('rejects missing history and cycles rather than selecting arbitrary versions', async () => {
    const { api, provider, projectId } = await fixture()
    await provider.saveProject(projectId, family('second'))
    const versions = await provider.listVersions(projectId)
    const head = versions.find(v => v.isHead)!.id
    const base = versions.find(v => !v.isHead)!.id
    api.files.get(head)!.appProperties!.parent = 'missing'
    await expect(provider.loadProject(projectId)).rejects.toThrow('版本历史缺失')
    api.files.get(head)!.appProperties!.parent = base
    api.files.get(base)!.appProperties!.parent = head
    await expect(provider.loadProject(projectId)).rejects.toThrow('循环引用')
  })

  it('rejects oversized metadata before downloading and oversized outgoing family data', async () => {
    const { api, provider, projectId } = await fixture()
    const head = (await provider.listVersions(projectId))[0].id
    api.files.get(head)!.size = String(52 * 1024 * 1024)
    api.reads = []
    await expect(provider.loadProject(projectId)).rejects.toThrow('超过大小限制')
    expect(api.reads).toEqual([])
    api.files.get(head)!.size = String(api.contents.get(head)!.size)
    await expect(provider.saveProject(projectId, family('x'.repeat(50 * 1024 * 1024)))).rejects.toThrow('50 MiB')
    expect(api.files.size).toBe(2)
  })
})

describe('Google Drive private media', () => {
  const preparePhoto = vi.fn(async () => ({
    photo: new Blob(['full private webp'], { type: 'image/webp' }),
    thumbnail: new Blob(['small private webp'], { type: 'image/webp' }),
  }))

  it('only returns a photo ID after full image and thumbnail are durably stored', async () => {
    const { api, projectId } = await fixture()
    const provider = createGoogleDriveStorage('google-drive:account-one', api, { preparePhoto })
    const { photoId } = await provider.importPhoto(projectId, new Uint8Array([1, 2, 3]), 'image/png')
    expect(await (await provider.readPhoto(projectId, photoId, false)).text()).toBe('full private webp')
    expect(await (await provider.readPhoto(projectId, photoId, true)).text()).toBe('small private webp')
    await provider.deletePhoto(projectId, photoId)
    expect(await (await provider.readPhoto(projectId, photoId, false)).text()).toBe('full private webp')
    expect(api.files.size).toBe(4)
  })

  it('does not return a reference when thumbnail upload fails or remove the retained partial upload', async () => {
    const { api, projectId } = await fixture()
    const provider = createGoogleDriveStorage('google-drive:account-one', api, { preparePhoto })
    api.beforeCreate = async file => {
      if (file.appProperties?.kind === 'thumbnail') throw new Error('thumbnail failed')
    }
    await expect(provider.importPhoto(projectId, new Uint8Array([1]), 'image/png')).rejects.toThrow('thumbnail failed')
    expect([...api.files.values()].filter(file => file.appProperties?.kind === 'photo')).toHaveLength(1)
    expect([...api.files.values()].filter(file => file.appProperties?.kind === 'thumbnail')).toHaveLength(0)
  })

  it('refuses duplicate media and prevents cross-project photo reads', async () => {
    const { api, projectId } = await fixture()
    const provider = createGoogleDriveStorage('google-drive:account-one', api, { preparePhoto })
    const { photoId } = await provider.importPhoto(projectId, new Uint8Array([1]), 'image/png')
    const second = await provider.createProject('root', 'another')
    await expect(provider.readPhoto(second.id, photoId, false)).rejects.toThrow('照片文件缺失')
    const original = [...api.files.values()].find(file => file.appProperties?.kind === 'photo')!
    await api.createFile({ ...original, id: await api.generateId() }, new Blob(['duplicate']))
    await expect(provider.readPhoto(projectId, photoId, false)).rejects.toThrow('多个文件')
    await expect(provider.readPhoto(projectId, "invalid'photo", false)).rejects.toThrow()
  })
})


describe('project renaming', () => {
  it('persists the title and folder name without changing members or old revisions', async () => {
    const { api, provider, projectId } = await fixture()
    const oldHead = (await provider.listVersions(projectId))[0].id
    const result = await provider.renameProject!(projectId, '  新家族  ')
    expect(result.meta.name).toBe('新家族')
    expect(result.displayName).toBe('新家族')
    const reopened = await createGoogleDriveStorage('google-drive:account-one', api).loadProject(projectId)
    expect(reopened.meta).toMatchObject({ name: '新家族' })
    expect(reopened.family).toEqual(family('initial'))
    expect((await revision(api, oldHead)).meta.name).toBe('测试家族')
    await provider.saveProject(projectId, family('later edit'))
    expect((await provider.loadProject(projectId)).meta).toMatchObject({ name: '新家族' })
  })

  it('renames a supported older snapshot immediately after opening and preserves its members', async () => {
    const { api, projectId } = await fixture()
    const revisionFile = [...api.files.values()].find(file => file.appProperties?.kind === 'revision')!
    const legacy = await revision(api, revisionFile.id)
    legacy.family.schemaVersion = 3
    legacy.meta.schemaVersion = 3
    api.contents.set(revisionFile.id, new Blob([JSON.stringify(legacy)]))
    const reopened = createGoogleDriveStorage('google-drive:account-one', api)
    await reopened.loadProject(projectId)
    const renamed = await reopened.renameProject!(projectId, '旧家谱的新标题')
    expect(renamed.meta).toMatchObject({ name: '旧家谱的新标题', schemaVersion: 4 })
    const loaded = await reopened.loadProject(projectId)
    expect(loaded.family).toEqual(family('initial'))
  })

  it('rejects stale or historical renames before touching the folder', async () => {
    const { api, provider, projectId } = await fixture()
    const other = createGoogleDriveStorage('google-drive:account-one', api)
    await other.loadProject(projectId)
    await provider.saveProject(projectId, family('newer'))
    const rename = vi.spyOn(api, 'renameFile')
    await expect(other.renameProject!(projectId, '过期')).rejects.toBeInstanceOf(GoogleDriveConflictError)
    const head = (await provider.listVersions(projectId)).find(v => v.isHead)!
    await provider.loadVersion(projectId, head.id)
    await expect(provider.renameProject!(projectId, '历史')).rejects.toBeInstanceOf(GoogleDriveConflictError)
    expect(rename).not.toHaveBeenCalled()
  })

  it('reports a folder sync failure and retries it without duplicating the title revision', async () => {
    const { api, provider, projectId } = await fixture()
    vi.spyOn(api, 'renameFile').mockRejectedValueOnce(new Error('offline'))
    const partial = await provider.renameProject!(projectId, '新家族')
    expect(partial.meta.name).toBe('新家族')
    expect(partial.warning).toContain('文件夹')
    const count = api.files.size
    const retried = await provider.renameProject!(projectId, '新家族')
    expect(retried.warning).toBeUndefined()
    expect(retried.displayName).toBe('新家族')
    expect(api.files.size).toBe(count)
  })

  it('requires explicit rename recovery before autosave can confirm an uncertain title write', async () => {
    const { api, provider, projectId } = await fixture()
    api.beforeCreate = async () => { throw new Error('offline') }
    await expect(provider.renameProject!(projectId, '新家族')).rejects.toThrow('offline')
    api.beforeCreate = undefined
    const count = api.files.size
    await expect(provider.saveProject(projectId, family('later edit'))).rejects.toThrow('重命名尚未确认')
    expect(api.files.size).toBe(count)
    expect(api.files.get(projectId)?.name).toBe('测试家族')
    await provider.renameProject!(projectId, '新家族')
    await provider.saveProject(projectId, family('later edit'))
    expect(api.files.get(projectId)?.name).toBe('新家族')
    expect((await provider.loadProject(projectId)).meta).toMatchObject({ name: '新家族' })
  })

  it('keeps autosave blocked if rename recovery confirms the upload but the next graph read fails', async () => {
    const { api, provider, projectId } = await fixture()
    api.beforeCreate = async () => { throw new Error('offline upload') }
    await expect(provider.renameProject!(projectId, '新家族')).rejects.toThrow('offline upload')
    api.beforeCreate = undefined
    let lists = 0
    api.beforeList = async () => { if (++lists === 2) throw new Error('offline graph') }
    await expect(provider.renameProject!(projectId, '新家族')).rejects.toThrow('offline graph')
    api.beforeList = undefined
    await expect(provider.saveProject(projectId, family('later edit'))).rejects.toThrow('重命名尚未确认')
    const heads = (await provider.listVersions(projectId)).filter(v => v.isHead).map(v => v.id)
    await expect(provider.resolveConflict(projectId, family('later edit'), heads)).rejects.toThrow('重命名尚未确认')
    expect(api.files.get(projectId)?.name).toBe('测试家族')
    await provider.renameProject!(projectId, '新家族')
    await provider.saveProject(projectId, family('later edit'))
    expect(api.files.get(projectId)?.name).toBe('新家族')
    expect((await provider.loadProject(projectId)).meta).toMatchObject({ name: '新家族' })
  })

  it.each(['', '   ', '长'.repeat(101)])('rejects invalid name %s without writing', async name => {
    const { api, provider, projectId } = await fixture()
    const count = api.files.size
    await expect(provider.renameProject!(projectId, name)).rejects.toThrow('1 到 100')
    expect(api.files.size).toBe(count)
  })
})
