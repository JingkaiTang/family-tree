import { describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import {
  BrowserDirectoryError,
  createBrowserDirectoryStorage,
  getDirectoryStorageAvailability,
  type DirectoryFileHandle,
  type DirectoryHandle,
  type DirectoryRegistry,
} from './browserDirectory'

const domError = (name: string) => new DOMException(name, name)

/** A staged writer models real File System Access commit-on-close behavior. */
class MemoryFile implements DirectoryFileHandle {
  readonly kind = 'file'
  data: Blob
  writes = 0
  aborts = 0
  failure?: 'write' | 'close'
  failureError = domError('QuotaExceededError')
  reportedSize?: number

  constructor(readonly name: string, text = '') { this.data = new Blob([text]) }
  async isSameEntry(other: DirectoryFileHandle): Promise<boolean> { return this === other }

  async getFile(): Promise<Blob> {
    if (this.reportedSize !== undefined) {
      const copy = new Blob([this.data])
      Object.defineProperty(copy, 'size', { value: this.reportedSize })
      return copy
    }
    return this.data
  }

  async createWritable() {
    let staged = new Blob([])
    return {
      write: async (data: Blob | string) => {
        this.writes++
        if (this.failure === 'write') throw this.failureError
        staged = new Blob([data])
      },
      close: async () => {
        if (this.failure === 'close') throw this.failureError
        this.data = staged
      },
      abort: async () => { this.aborts++ },
    }
  }
}

class MemoryDirectory implements DirectoryHandle {
  readonly kind = 'directory'
  readonly files = new Map<string, MemoryFile>()
  readonly directories = new Map<string, MemoryDirectory>()
  permission: PermissionState = 'granted'
  permissionResult: PermissionState = 'granted'
  queries = 0
  prompts = 0
  removes = 0
  removeError?: Error
  nextFileFailure?: 'write' | 'close'

  constructor(readonly name = '测试家族.family') {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    if (this.files.has(name)) throw domError('TypeMismatchError')
    let directory = this.directories.get(name)
    if (!directory && options?.create) {
      directory = new MemoryDirectory(name)
      this.directories.set(name, directory)
    }
    if (!directory) throw domError('NotFoundError')
    return directory
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    if (this.directories.has(name)) throw domError('TypeMismatchError')
    let file = this.files.get(name)
    if (!file && options?.create) {
      file = new MemoryFile(name)
      file.failure = this.nextFileFailure
      this.files.set(name, file)
    }
    if (!file) throw domError('NotFoundError')
    return file
  }

  async removeEntry(name: string) {
    if (this.removeError) throw this.removeError
    this.removes++
    if (!this.files.delete(name) && !this.directories.delete(name)) throw domError('NotFoundError')
  }

  async *values() {
    yield* this.files.values()
    yield* this.directories.values()
  }

  async isSameEntry(other: DirectoryHandle): Promise<boolean> { return other === this }
  async queryPermission() { this.queries++; return this.permission }
  async requestPermission() { this.prompts++; this.permission = this.permissionResult; return this.permission }

  text(name: string) { return this.files.get(name)?.data.text() }
  put(name: string, value: unknown) {
    const file = new MemoryFile(name, typeof value === 'string' ? value : JSON.stringify(value))
    this.files.set(name, file)
    return file
  }
}

function fixture(root = new MemoryDirectory(), registryEntries = new Map<string, DirectoryHandle>()) {
  const registry: DirectoryRegistry = {
    get: vi.fn(async id => registryEntries.get(id)),
    entries: vi.fn(async () => [...registryEntries]),
    set: vi.fn(async (id, handle) => { registryEntries.set(id, handle) }),
  }
  const pickDirectory = vi.fn(async () => root)
  const preparePhoto = vi.fn(async () => ({ photo: new Blob(['photo']), thumbnail: new Blob(['thumb']) }))
  let serial = 0
  const options = {
    registry,
    pickDirectory,
    preparePhoto,
    availability: () => ({ supported: true, reason: null }),
    newId: () => `id-${++serial}`,
  }
  const adapter = createBrowserDirectoryStorage(options)
  return { ...adapter, root, options, registry, registryEntries, pickDirectory, preparePhoto }
}

async function created() {
  const test = fixture()
  const selected = await test.picker.pickProject('create')
  if (!selected) throw new Error('selection required')
  await test.storage.createProject(selected.id, '测试家族')
  return { ...test, id: selected.id }
}

async function seedPhoto(root: MemoryDirectory, id = 'photo1') {
  const media = await root.getDirectoryHandle('media', { create: true })
  const photos = await media.getDirectoryHandle('photos', { create: true })
  const thumbs = await media.getDirectoryHandle('thumbs', { create: true })
  photos.put(`${id}.webp`, 'original')
  thumbs.put(`${id}.webp`, 'thumbnail')
  return { photos, thumbs }
}

describe('browser directory selection and permissions', () => {
  it('invokes the system picker in the initiating call stack, then persists an opaque ID', async () => {
    const test = fixture()
    const picked = test.picker.pickProject('open')
    expect(test.pickDirectory).toHaveBeenCalledOnce()
    expect(test.registry.entries).not.toHaveBeenCalled()
    expect(await picked).toEqual({ id: 'id-1', displayName: '测试家族.family' })
    expect(test.registryEntries.get('id-1')).toBe(test.root)
  })

  it('reuses the same physical directory reference', async () => {
    const test = fixture()
    const first = await test.picker.pickProject('open')
    const second = await test.picker.pickProject('open')
    expect(second).toEqual(first)
    expect(test.registryEntries.size).toBe(1)
  })

  it('treats picker cancellation as cancellation without creating a registry record', async () => {
    const test = fixture()
    test.pickDirectory.mockRejectedValueOnce(domError('AbortError'))
    expect(await test.picker.pickProject('open')).toBeNull()
    expect(test.registry.set).not.toHaveBeenCalled()
  })

  it('restores a persisted handle before asking the user to reauthorize', async () => {
    const test = await created()
    const reopened = createBrowserDirectoryStorage(test.options)
    test.root.permission = 'prompt'
    await expect(reopened.storage.loadProject(test.id)).rejects.toMatchObject({ code: 'permission-required' })
    expect(test.root.prompts).toBe(0)
    const authorizing = reopened.picker.authorizeProject(test.id)
    expect(test.root.prompts).toBe(1)
    await authorizing
    expect((await reopened.storage.loadProject(test.id)).meta).toMatchObject({ name: '测试家族' })
  })

  it('never prompts permission during background save or media IO', async () => {
    const test = await created()
    test.root.permission = 'denied'
    for (const operation of [
      () => test.storage.saveProject(test.id, createEmptyFamily()),
      () => test.storage.importPhoto(test.id, new Uint8Array(), 'image/webp'),
      () => test.storage.readPhoto(test.id, 'photo1', false),
      () => test.storage.deletePhoto(test.id, 'photo1'),
    ]) await expect(operation()).rejects.toMatchObject({ code: 'permission-required' })
    expect(test.root.prompts).toBe(0)
  })

  it('reports a cleared registry without creating a replacement project', async () => {
    const test = fixture()
    await expect(test.storage.loadProject('missing')).rejects.toMatchObject({ code: 'missing-directory' })
    await expect(test.picker.authorizeProject('missing')).rejects.toMatchObject({ code: 'missing-directory' })
    expect(test.root.files.size).toBe(0)
    expect(test.root.prompts).toBe(0)
  })

  it('reports failed IndexedDB restore with recovery instructions', async () => {
    const test = fixture()
    vi.mocked(test.registry.get).mockRejectedValueOnce(new Error('IDB disabled'))
    await expect(test.storage.loadProject('missing')).rejects.toThrow('重新选择原目录')
  })

  it('reports denied authorization, and does not silently continue', async () => {
    const test = await created()
    test.root.permissionResult = 'denied'
    await expect(test.picker.authorizeProject(test.id)).rejects.toMatchObject({ code: 'permission-required' })
  })

  it('rejects unsupported environments before showing a picker or doing IO', async () => {
    const test = fixture()
    const adapter = createBrowserDirectoryStorage({
      ...test.options,
      availability: () => ({ supported: false, reason: 'HTTPS required' }),
    })
    await expect(adapter.picker.pickProject('open')).rejects.toThrow('HTTPS required')
    expect(test.pickDirectory).not.toHaveBeenCalled()
  })
})

describe('browser directory project persistence', () => {
  it('creates compatible project JSON and loads it without rewriting files', async () => {
    const test = await created()
    const before = await test.root.text('family.json')
    const metaWrites = test.root.files.get('meta.json')?.writes
    const familyWrites = test.root.files.get('family.json')?.writes
    expect((await test.storage.loadProject(test.id)).family).toEqual(createEmptyFamily())
    expect(await test.root.text('family.json')).toBe(before)
    expect(test.root.files.get('meta.json')?.writes).toBe(metaWrites)
    expect(test.root.files.get('family.json')?.writes).toBe(familyWrites)
    expect(test.root.directories.size).toBe(0)
  })

  it('refuses all nonempty directories, including incomplete projects', async () => {
    const test = fixture()
    test.root.put('unrelated.txt', 'user data')
    const selected = await test.picker.pickProject('create')
    if (!selected) throw new Error('selection required')
    await expect(test.storage.createProject(selected.id, '家族')).rejects.toThrow('空目录')
    expect(await test.root.text('unrelated.txt')).toBe('user data')
    expect(test.root.files.size).toBe(1)
  })

  it('rejects invalid project names without writing', async () => {
    const test = fixture()
    await test.picker.pickProject('create')
    await expect(test.storage.createProject('id-1', '   ')).rejects.toThrow('1 到 100')
    await expect(test.storage.createProject('id-1', '名'.repeat(101))).rejects.toThrow('1 到 100')
    expect(test.root.files.size).toBe(0)
  })

  it('cleans an incomplete new project after failed close and permits a retry', async () => {
    const test = fixture()
    await test.picker.pickProject('create')
    const getFile = test.root.getFileHandle.bind(test.root)
    const intercepted = vi.spyOn(test.root, 'getFileHandle').mockImplementation(async (name, options) => {
      const handle = await getFile(name, options)
      if (name === 'family.json') handle.failure = 'close'
      return handle
    })
    await expect(test.storage.createProject('id-1', '家族')).rejects.toThrow('磁盘空间')
    expect(test.root.files.size).toBe(0)
    intercepted.mockRestore()
    await test.storage.createProject('id-1', '重试家族')
    expect((await test.storage.loadProject('id-1')).meta).toMatchObject({ name: '重试家族' })
  })

  it('keeps three backups of previous snapshots and skips unchanged saves', async () => {
    const test = await created()
    const initial = await test.root.text('family.json')
    await test.storage.saveProject(test.id, createEmptyFamily())
    expect(test.root.files.has('family.json.bak.1')).toBe(false)
    for (let i = 1; i <= 4; i++) {
      await test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: i })
    }
    expect(JSON.parse((await test.root.text('family.json'))!)).toMatchObject({ extension: 4 })
    expect(JSON.parse((await test.root.text('family.json.bak.1'))!)).toMatchObject({ extension: 3 })
    expect(JSON.parse((await test.root.text('family.json.bak.2'))!)).toMatchObject({ extension: 2 })
    expect(JSON.parse((await test.root.text('family.json.bak.3'))!)).toMatchObject({ extension: 1 })
    expect([...test.root.files.keys()].filter(name => name.includes('.bak.'))).toHaveLength(3)
    expect(await test.root.text('family.json.bak.3')).not.toBe(initial)
  })

  it.each(['write', 'close'] as const)('preserves the main file and aborts after a failed %s', async failure => {
    const test = await created()
    const before = await test.root.text('family.json')
    const main = await test.root.getFileHandle('family.json')
    main.failure = failure
    await expect(test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 1 }))
      .rejects.toMatchObject({ code: 'quota' })
    expect(await test.root.text('family.json')).toBe(before)
    expect(await test.root.text('family.json.bak.1')).toBe(before)
    expect(main.aborts).toBe(1)
    main.failure = undefined
    await test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 2 })
    expect(JSON.parse((await test.root.text('family.json'))!)).toMatchObject({ extension: 2 })
  })

  it('does not replace the main file when its backup fails', async () => {
    const test = await created()
    const before = await test.root.text('family.json')
    test.root.nextFileFailure = 'close'
    await expect(test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 1 })).rejects.toThrow('磁盘空间')
    expect(await test.root.text('family.json')).toBe(before)
  })

  it('detects changes from another window and allows explicit reload', async () => {
    const test = await created()
    const otherWindow = createBrowserDirectoryStorage(test.options)
    await otherWindow.storage.loadProject(test.id)
    const current = { ...createEmptyFamily(), extension: 'other window' }
    await otherWindow.storage.saveProject(test.id, current)
    await expect(test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 'stale' }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(JSON.parse((await test.root.text('family.json'))!)).toEqual(current)
    await test.storage.loadProject(test.id)
    await test.storage.saveProject(test.id, { ...current, extension: 'reopened' })
    expect(JSON.parse((await test.root.text('family.json'))!)).toMatchObject({ extension: 'reopened' })
  })

  it('serializes simultaneous saves against the latest committed baseline', async () => {
    const test = await created()
    await Promise.all([
      test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 1 }),
      test.storage.saveProject(test.id, { ...createEmptyFamily(), extension: 2 }),
    ])
    expect(JSON.parse((await test.root.text('family.json'))!)).toMatchObject({ extension: 2 })
    expect(JSON.parse((await test.root.text('family.json.bak.1'))!)).toMatchObject({ extension: 1 })
  })

  it('requires a loaded snapshot before a save from a fresh instance', async () => {
    const test = await created()
    const fresh = createBrowserDirectoryStorage(test.options)
    await expect(fresh.storage.saveProject(test.id, createEmptyFamily())).rejects.toThrow('先打开项目')
  })

  it.each([
    ['family.json', 50 * 1024 * 1024 + 1],
    ['meta.json', 1024 * 1024 + 1],
  ] as const)('rejects oversized %s before decoding JSON', async (name, size) => {
    const test = await created()
    const file = await test.root.getFileHandle(name)
    file.reportedSize = size
    await expect(test.storage.loadProject(test.id)).rejects.toThrow('MiB 限制')
  })

  it('rejects malformed JSON and future metadata without changing them', async () => {
    const test = await created()
    test.root.put('family.json', 'broken JSON')
    await expect(test.storage.loadProject(test.id)).rejects.toThrow('有效的 JSON')
    expect(await test.root.text('family.json')).toBe('broken JSON')
    test.root.put('family.json', createEmptyFamily())
    test.root.put('meta.json', { ...createEmptyMeta('future'), schemaVersion: 999 })
    await expect(test.storage.loadProject(test.id)).rejects.toThrow('版本过新')
  })
})

describe('browser directory portable bundle imports', () => {
  function importFixture() {
    const test = fixture()
    const meta = createEmptyMeta('导入家族')
    const family = createEmptyFamily()
    const close = vi.fn(async () => {})
    const media = [
      { path: 'media/photos/photo1.webp', data: new Blob(['original']) },
      { path: 'media/thumbs/photo1.webp', data: new Blob(['thumbnail']) },
    ]
    const files = vi.fn(async function* () {
      for (const entry of media) {
        expect(test.root.files.has('meta.json')).toBe(false)
        expect(test.root.files.has('family.json')).toBe(false)
        yield entry
      }
    })
    const openBundle = vi.fn(async () => ({ meta, family, files, close }))
    const adapter = createBrowserDirectoryStorage({ ...test.options, openBundle })
    return { ...test, ...adapter, meta, family, close, files, media, openBundle }
  }

  it('extracts media before markers, closes the archive, and initializes the save baseline', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    expect(await test.importProjectBundle('id-1', new Blob(['bundle'])))
      .toEqual({ id: 'id-1', displayName: test.root.name, meta: test.meta })
    expect(test.close).toHaveBeenCalledOnce()
    expect(await (await test.storage.readPhoto('id-1', 'photo1', false)).text()).toBe('original')
    await test.storage.saveProject('id-1', { ...test.family, extra: true })
    expect(JSON.parse((await test.root.text('family.json'))!)).toMatchObject({ extra: true })
  })

  it('refuses to import into a nonempty directory before reading the archive', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.root.put('myfile.txt', 'user data')
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('空目录')
    expect(test.openBundle).not.toHaveBeenCalled()
    expect(await test.root.text('myfile.txt')).toBe('user data')
  })

  it('removes partial imports after lazy archive verification fails', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      throw new Error('CRC mismatch')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('CRC mismatch')
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.root.files.size).toBe(0)
    expect(test.root.directories.size).toBe(0)
  })

  it('preserves unrelated files created during a failed import', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      const media = await test.root.getDirectoryHandle('media')
      media.put('user.txt', 'unrelated')
      throw new Error('transfer interrupted')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('transfer interrupted')
    const media = await test.root.getDirectoryHandle('media')
    expect(await media.text('user.txt')).toBe('unrelated')
    expect(media.directories.size).toBe(0)
    expect(test.root.files.size).toBe(0)
  })

  it('preserves a file externally replaced during rollback', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      const media = await test.root.getDirectoryHandle('media')
      const photos = await media.getDirectoryHandle('photos')
      photos.put('photo1.webp', 'externally replaced')
      throw new Error('transfer interrupted')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('transfer interrupted')
    const photos = await (await test.root.getDirectoryHandle('media')).getDirectoryHandle('photos')
    expect(await photos.text('photo1.webp')).toBe('externally replaced')
  })

  it('preserves same-size external edits to a created file during rollback', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      const media = await test.root.getDirectoryHandle('media')
      const photos = await media.getDirectoryHandle('photos')
      const existing = await photos.getFileHandle('photo1.webp')
      existing.data = new Blob(['changed!']) // Same eight-byte size as "original".
      throw new Error('transfer interrupted')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('transfer interrupted')
    const photos = await (await test.root.getDirectoryHandle('media')).getDirectoryHandle('photos')
    expect(await photos.text('photo1.webp')).toBe('changed!')
  })

  it('cleans a created file with identical content after the source Blob is replaced', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      const media = await test.root.getDirectoryHandle('media')
      const photos = await media.getDirectoryHandle('photos')
      const existing = await photos.getFileHandle('photo1.webp')
      existing.data = new Blob(['original'])
      throw new Error('transfer interrupted')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('transfer interrupted')
    expect(test.root.directories.size).toBe(0)
  })

  it('does not create an untracked file if hashing fails, and cleans preceding media', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let calls = 0
    const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
      if (++calls === 2) throw new Error('digest failed')
      return digest(algorithm, bytes)
    })
    try {
      await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('digest failed')
      expect(test.root.files.size).toBe(0)
      expect(test.root.directories.size).toBe(0)
      expect(test.close).toHaveBeenCalledOnce()
    } finally { hashing.mockRestore() }
  })

  it('fingerprints one media entry at a time while consuming the lazy archive', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    const hashing = vi.spyOn(crypto.subtle, 'digest')
    test.files.mockImplementationOnce(async function* () {
      for (let index = 0; index < 8; index++) {
        expect(hashing).toHaveBeenCalledTimes(index)
        yield { path: `media/photos/photo${index}.webp`, data: new Blob([new Uint8Array(256 + index)]) }
      }
      expect(hashing).toHaveBeenCalledTimes(8)
      throw new Error('test rollback')
    })
    try {
      await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('test rollback')
      // Creation and rollback each hash one bounded file; no concatenated archive.
      expect(hashing).toHaveBeenCalledTimes(16)
      for (const [algorithm, bytes] of hashing.mock.calls) {
        expect(algorithm).toBe('SHA-256')
        expect(bytes.byteLength).toBeGreaterThanOrEqual(256)
        expect(bytes.byteLength).toBeLessThanOrEqual(263)
      }
      expect(test.root.directories.size).toBe(0)
    } finally { hashing.mockRestore() }
  })

  it('does not delete a committed file externally truncated during rollback', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.files.mockImplementationOnce(async function* () {
      yield test.media[0]
      const media = await test.root.getDirectoryHandle('media')
      const photos = await media.getDirectoryHandle('photos')
      const existing = await photos.getFileHandle('photo1.webp')
      existing.data = new Blob([])
      throw new Error('transfer interrupted')
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('transfer interrupted')
    const photos = await (await test.root.getDirectoryHandle('media')).getDirectoryHandle('photos')
    expect(photos.files.has('photo1.webp')).toBe(true)
  })

  it('cleans media and markers if the final metadata commit fails', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    const getFile = test.root.getFileHandle.bind(test.root)
    vi.spyOn(test.root, 'getFileHandle').mockImplementation(async (name, options) => {
      const handle = await getFile(name, options)
      if (name === 'meta.json') handle.failure = 'close'
      return handle
    })
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('磁盘空间')
    expect(test.root.files.size).toBe(0)
    expect(test.root.directories.size).toBe(0)
  })

  it('defends its own write boundary against an unsafe archive path', async () => {
    const test = importFixture()
    await test.picker.pickProject('create')
    test.media[0].path = '../escape'
    await expect(test.importProjectBundle('id-1', new Blob())).rejects.toThrow('非法媒体路径')
    expect(test.root.files.size).toBe(0)
    expect(test.root.directories.size).toBe(0)
  })
})

describe('browser directory media safety', () => {
  it('persists original and thumbnail as WebP blobs using the shared layout', async () => {
    const test = await created()
    const bytes = new Uint8Array([1, 2, 3])
    const { photoId } = await test.storage.importPhoto(test.id, bytes, 'image/png')
    expect(test.preparePhoto).toHaveBeenCalledWith(bytes, 'image/png')
    expect(await (await test.storage.readPhoto(test.id, photoId, false)).text()).toBe('photo')
    const thumbnail = await test.storage.readPhoto(test.id, photoId, true)
    expect(thumbnail.type).toBe('image/webp')
    expect(await thumbnail.text()).toBe('thumb')
  })

  it.each(['../escape', 'a/b', '', 'a'.repeat(129)])('rejects unsafe photo IDs: %s', async id => {
    const test = await created()
    await expect(test.storage.readPhoto(test.id, id, false)).rejects.toThrow('照片标识')
    await expect(test.storage.deletePhoto(test.id, id)).rejects.toThrow('照片标识')
    expect(test.root.directories.size).toBe(0)
  })

  it('checks both original project markers for every media operation', async () => {
    const test = await created()
    const { photos } = await seedPhoto(test.root)
    test.root.files.delete('family.json')
    await expect(test.storage.importPhoto(test.id, new Uint8Array([1]), 'image/png')).rejects.toThrow('缺少 family.json')
    await expect(test.storage.readPhoto(test.id, 'photo1', false)).rejects.toThrow('缺少 family.json')
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toThrow('缺少 family.json')
    expect(test.preparePhoto).not.toHaveBeenCalled()
    expect(photos.removes).toBe(0)
    test.root.put('family.json', createEmptyFamily())
    test.root.files.delete('meta.json')
    await expect(test.storage.readPhoto(test.id, 'photo1', true)).rejects.toThrow('缺少 meta.json')
  })

  it('does not act on a different project substituted into the selected directory', async () => {
    const test = await created()
    const { photos } = await seedPhoto(test.root)
    test.root.put('meta.json', createEmptyMeta('another project'))
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toMatchObject({ code: 'conflict' })
    expect(photos.files.has('photo1.webp')).toBe(true)
  })

  it('copies originals and thumbnails into trash before removing either', async () => {
    const test = await created()
    const { photos, thumbs } = await seedPhoto(test.root)
    await test.storage.deletePhoto(test.id, 'photo1')
    const trash = await test.root.getDirectoryHandle('.trash')
    expect(await trash.text('photo1-photo-id-2.webp')).toBe('original')
    expect(await trash.text('photo1-thumb-id-2.webp')).toBe('thumbnail')
    expect(photos.files.has('photo1.webp')).toBe(false)
    expect(thumbs.files.has('photo1.webp')).toBe(false)
    await test.storage.deletePhoto(test.id, 'photo1')
    expect(trash.files.size).toBe(2)
  })

  it('retains both originals if either trash write fails', async () => {
    const test = await created()
    const { photos, thumbs } = await seedPhoto(test.root)
    const trash = await test.root.getDirectoryHandle('.trash', { create: true })
    trash.nextFileFailure = 'close'
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toThrow('磁盘空间')
    expect(await photos.text('photo1.webp')).toBe('original')
    expect(await thumbs.text('photo1.webp')).toBe('thumbnail')
    expect(photos.removes + thumbs.removes).toBe(0)
  })

  it('never overwrites an existing trash backup on a generated ID collision', async () => {
    const test = await created()
    const { photos, thumbs } = await seedPhoto(test.root)
    const trash = await test.root.getDirectoryHandle('.trash', { create: true })
    trash.put('photo1-photo-id-2.webp', 'previous deletion')
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toThrow('避免覆盖')
    expect(await trash.text('photo1-photo-id-2.webp')).toBe('previous deletion')
    expect(photos.removes + thumbs.removes).toBe(0)
  })

  it('preserves media replaced while trash copies are being written', async () => {
    const test = await created()
    const { photos } = await seedPhoto(test.root)
    const trash = await test.root.getDirectoryHandle('.trash', { create: true })
    const getFile = trash.getFileHandle.bind(trash)
    vi.spyOn(trash, 'getFileHandle').mockImplementation(async (name, options) => {
      if (name.includes('-thumb-') && options?.create) photos.put('photo1.webp', 'external change')
      return getFile(name, options)
    })
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toMatchObject({ code: 'conflict' })
    expect(await photos.text('photo1.webp')).toBe('external change')
    expect(await trash.text('photo1-photo-id-2.webp')).toBe('original')
  })

  it('retains recoverable trash if original removal fails', async () => {
    const test = await created()
    const { photos } = await seedPhoto(test.root)
    photos.removeError = domError('NotAllowedError')
    await expect(test.storage.deletePhoto(test.id, 'photo1')).rejects.toMatchObject({ code: 'permission-required' })
    const trash = await test.root.getDirectoryHandle('.trash')
    expect(trash.files.size).toBe(2)
    expect(await photos.text('photo1.webp')).toBe('original')
  })

  it('rejects invalid photos before creating media directories', async () => {
    const test = await created()
    test.preparePhoto.mockRejectedValueOnce(new Error('不支持的图片格式'))
    await expect(test.storage.importPhoto(test.id, new Uint8Array([1]), 'image/gif')).rejects.toThrow('不支持')
    expect(test.root.directories.size).toBe(0)
  })

  it('does not expose a photo ID until thumbnail persistence succeeds', async () => {
    const test = await created()
    const media = await test.root.getDirectoryHandle('media', { create: true })
    const thumbs = await media.getDirectoryHandle('thumbs', { create: true })
    thumbs.nextFileFailure = 'close'
    await expect(test.storage.importPhoto(test.id, new Uint8Array([1]), 'image/png')).rejects.toThrow('磁盘空间')
    expect((await media.getDirectoryHandle('photos')).files.size).toBe(0)
    expect(thumbs.files.size).toBe(0)
    expect(await test.root.text('family.json')).toBe(JSON.stringify(createEmptyFamily()))
  })

  it('does not advertise automatic GC without a cross-session ownership protocol', async () => {
    expect((await created()).storage.gcMedia).toBeUndefined()
  })
})

describe('directory capability detection', () => {
  it('gates only secure origin, frame origin, and actual directory API availability', () => {
    const location = { origin: 'https://family.example' }
    try {
      vi.stubGlobal('window', { isSecureContext: false, location })
      expect(getDirectoryStorageAvailability()).toMatchObject({ supported: false })
      vi.stubGlobal('window', { isSecureContext: true, location, top: { location }, showDirectoryPicker() {} })
      expect(getDirectoryStorageAvailability()).toEqual({ supported: true, reason: null })
      vi.stubGlobal('window', { isSecureContext: true, location, top: { location } })
      expect(getDirectoryStorageAvailability()).toMatchObject({ supported: false })
      vi.stubGlobal('window', { isSecureContext: true, location, top: { location: { origin: 'https://embedder.example' } }, showDirectoryPicker() {} })
      expect(getDirectoryStorageAvailability().reason).toContain('独立窗口')
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps actionable error codes in addition to display text', () => {
    const error = new BrowserDirectoryError('conflict', 'changed')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('conflict')
  })
})
