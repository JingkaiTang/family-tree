import { BlobReader, BlobWriter, ZipReader, ZipWriter, type ZipWriterAddDataOptions } from '@zip.js/zip.js'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta, Member, type FamilyData } from '@/core/schema'
import { exportProjectBundleToStream, openProjectBundle } from './projectBundle'

const photoPath = 'project/media/photos/photo-1.webp'
const thumbPath = 'project/media/thumbs/photo-1.webp'

function familyWithPhotos(...photoIds: string[]): FamilyData {
  const family = createEmptyFamily()
  photoIds.forEach((photoId, index) => {
    const id = `member-${index}`
    family.members[id] = Member.parse({
      id, firstName: '测试', lastName: '示例', gender: 'other', photoId,
    })
  })
  return family
}

interface FixtureEntry {
  path: string
  content: string | Blob
  options?: ZipWriterAddDataOptions
}

function projectEntries(family: unknown = familyWithPhotos('photo-1')): FixtureEntry[] {
  return [
    { path: 'archive.json', content: '{"archiveVersion":1}' },
    { path: 'project/meta.json', content: JSON.stringify(createEmptyMeta('示例家族')) },
    { path: 'project/family.json', content: JSON.stringify(family) },
    { path: photoPath, content: 'original-image' },
    { path: thumbPath, content: 'thumbnail-image' },
  ]
}

/** Native Rust ZIP layout: ordinary Unix files, archive.json, project/*, no app-specific extensions. */
async function fixture(entries = projectEntries()): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0, unixMode: 0o100600 })
  for (const entry of entries) {
    const blob = typeof entry.content === 'string' ? new Blob([entry.content]) : entry.content
    await zip.add(entry.path, new BlobReader(blob), entry.options)
  }
  return zip.close()
}

function transaction() {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let committed: Blob | undefined
  const abort = vi.fn(() => { chunks.length = 0 })
  const close = vi.fn(() => { committed = new Blob(chunks) })
  return {
    abort,
    close,
    get committed() { return committed },
    destination: new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(new Uint8Array(chunk)) },
      close,
      abort,
    }),
  }
}

/** Mutate real ZIP header fields to represent malformed input without allocating huge files. */
async function mutateEntry(
  blob: Blob,
  path: string,
  mutate: (bytes: Uint8Array<ArrayBuffer>, view: DataView, central: number, local: number) => void,
): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const decoder = new TextDecoder()
  for (let offset = 0; offset <= bytes.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    const length = view.getUint16(offset + 28, true)
    if (decoder.decode(bytes.subarray(offset + 46, offset + 46 + length)) === path) {
      mutate(bytes, view, offset, view.getUint32(offset + 42, true))
      return new Blob([bytes])
    }
  }
  throw new Error(`Fixture entry not found: ${path}`)
}

async function renameEntry(blob: Blob, oldPath: string, newPath: string): Promise<Blob> {
  expect(newPath.length).toBe(oldPath.length)
  return mutateEntry(blob, oldPath, (bytes, _view, central, local) => {
    const name = new TextEncoder().encode(newPath)
    bytes.set(name, central + 46)
    bytes.set(name, local + 30)
  })
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

async function oversizedIndexFixture(zip64: boolean): Promise<Blob> {
  const original = await fixture()
  const end = new Uint8Array(await original.slice(-22).arrayBuffer())
  const endView = new DataView(end.buffer)
  const indexSize = 9 * 1024 * 1024
  const indexOffset = endView.getUint32(16, true)
  const padding = new Uint8Array(indexSize - endView.getUint32(12, true))
  const prefix = new Blob([original.slice(0, -22), padding])
  if (!zip64) {
    endView.setUint32(12, indexSize, true)
    return new Blob([prefix, end])
  }
  // ZIP64 stores the true index size in its 64-bit end record, bypassing classic EOCD-only checks.
  const end64 = new Uint8Array(56)
  const view64 = new DataView(end64.buffer)
  view64.setUint32(0, 0x06064b50, true)
  view64.setBigUint64(4, 44n, true)
  view64.setUint16(12, 45, true)
  view64.setUint16(14, 45, true)
  view64.setBigUint64(24, 5n, true)
  view64.setBigUint64(32, 5n, true)
  view64.setBigUint64(40, BigInt(indexSize), true)
  view64.setBigUint64(48, BigInt(indexOffset), true)
  const locator = new Uint8Array(20)
  const locatorView = new DataView(locator.buffer)
  locatorView.setUint32(0, 0x07064b50, true)
  locatorView.setBigUint64(8, BigInt(prefix.size), true)
  locatorView.setUint32(16, 1, true)
  endView.setUint16(8, 0xffff, true)
  endView.setUint16(10, 0xffff, true)
  endView.setUint32(12, 0xffffffff, true)
  endView.setUint32(16, 0xffffffff, true)
  return new Blob([prefix, end64, locator, end])
}

describe('portable project bundles', () => {
  it('exports a native-compatible ZIP and roundtrips shared photos exactly once', async () => {
    const output = transaction()
    const family = familyWithPhotos('photo-1', 'photo-1')
    const meta = createEmptyMeta('示例家族')
    const readPhoto = vi.fn(async (_id: string, thumb: boolean) => new Blob([thumb ? 'thumb' : 'photo']))
    await exportProjectBundleToStream({ meta, family, readPhoto }, output.destination)
    expect(output.close).toHaveBeenCalledOnce()
    expect(output.abort).not.toHaveBeenCalled()
    expect(readPhoto.mock.calls).toEqual([['photo-1', false], ['photo-1', true]])
    const bundle = output.committed!
    const zip = new ZipReader(new BlobReader(bundle), { useWebWorkers: false })
    const entries = await zip.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual([
      'archive.json', 'project/meta.json', 'project/family.json', photoPath, thumbPath,
    ])
    await zip.close()
    const reader = await openProjectBundle(bundle)
    try {
      expect(reader.meta).toEqual(meta)
      expect(reader.family).toEqual(family)
      const files = []
      for await (const { path, data } of reader.files()) files.push([path, await data.text(), data.type])
      expect(files).toEqual([
        ['media/photos/photo-1.webp', 'photo', 'image/webp'],
        ['media/thumbs/photo-1.webp', 'thumb', 'image/webp'],
      ])
    } finally {
      await reader.close()
    }
  })

  it('opens native-shaped archives, including allowed directories and unreferenced media', async () => {
    const entries = projectEntries(createEmptyFamily())
    entries.unshift({ path: 'project/', content: '', options: { directory: true, unixMode: 0o040700 } })
    const reader = await openProjectBundle(await fixture(entries))
    try {
      const paths = []
      for await (const file of reader.files()) paths.push(file.path)
      expect(paths).toEqual(['media/photos/photo-1.webp', 'media/thumbs/photo-1.webp'])
    } finally {
      await reader.close()
    }
  })

  it('migrates legacy family data and returns current metadata for the final commit', async () => {
    const entries = projectEntries({ schemaVersion: 2, members: {}, nicknameOverrides: {} })
    entries[1].content = JSON.stringify({ ...createEmptyMeta('旧家族'), schemaVersion: 2 })
    const reader = await openProjectBundle(await fixture(entries))
    expect(reader.family.schemaVersion).toBe(4)
    expect(reader.meta.schemaVersion).toBe(4)
    await reader.close()
  })

  it.each([
    ['archive.json', '{"archiveVersion":2}'],
    ['archive.json', '{"archiveVersion":1,"surprise":true}'],
    ['project/meta.json', JSON.stringify({ ...createEmptyMeta('新家族'), schemaVersion: 99 })],
    ['project/family.json', '{"schemaVersion":99,"members":{}}'],
    ['project/meta.json', '{}'],
    ['project/family.json', '{}'],
    ['project/family.json', '{'],
  ])('rejects invalid or future project formats in %s', async (path, content) => {
    const entries = projectEntries().map(entry => entry.path === path ? { ...entry, content } : entry)
    await expect(openProjectBundle(await fixture(entries))).rejects.toThrow()
  })

  it('rejects inconsistent family relationships before any media is consumed', async () => {
    const family = familyWithPhotos('photo-1')
    family.members['member-0'].parents.push({ id: 'missing', type: 'blood' })
    await expect(openProjectBundle(await fixture(projectEntries(family)))).rejects.toThrow('完整性')
  })

  it('rejects invalid UTF-8 JSON instead of silently replacing project content', async () => {
    const entries = projectEntries()
    entries[1].content = new Blob([
      '{"name":"', new Uint8Array([0xff]), '","schemaVersion":4,"createdAt":"now","updatedAt":"now"}',
    ])
    await expect(openProjectBundle(await fixture(entries))).rejects.toThrow('JSON 无效')
  })

  it.each(['archive.json', 'project/meta.json', 'project/family.json', photoPath, thumbPath])(
    'rejects a missing required file: %s', async path => {
      await expect(openProjectBundle(await fixture(projectEntries().filter(entry => entry.path !== path))))
        .rejects.toThrow('缺少文件')
    },
  )

  it('rejects unsafe photo identifiers in family data', async () => {
    const family = familyWithPhotos('photo-1')
    family.members['member-0'].photoId = '../escaped'
    await expect(openProjectBundle(await fixture(projectEntries(family)))).rejects.toThrow('校验失败')
  })

  it.each(['../escape.json', '/absolute.json', 'project/other.json', 'project/media/photos/../x.webp', 'project\\meta.json'])(
    'rejects unknown or unsafe archive paths: %s', async path => {
      const bundle = await fixture([...projectEntries(), { path, content: 'unsafe' }])
      await expect(openProjectBundle(bundle)).rejects.toThrow()
    },
  )

  it('rejects symbolic links, special files and encrypted entries', async () => {
    for (const options of [{ unixMode: 0o120777 }, { unixMode: 0o020600 }, { password: 'secret', zipCrypto: true }]) {
      const entries = projectEntries().map(entry => entry.path === photoPath ? { ...entry, options } : entry)
      await expect(openProjectBundle(await fixture(entries))).rejects.toThrow()
    }
  })

  it('rejects duplicate and case-insensitive colliding archive names', async () => {
    const duplicate = await fixture([
      ...projectEntries(), { path: photoPath.replace('photo-1', 'photo-2'), content: 'another-photo' },
    ])
    await expect(openProjectBundle(await renameEntry(duplicate, photoPath.replace('photo-1', 'photo-2'), photoPath)))
      .rejects.toThrow()
    const collision = await fixture([...projectEntries(), { path: photoPath.replace('photo-1', 'PHOTO-1'), content: 'other' }])
    await expect(openProjectBundle(collision)).rejects.toThrow('重复条目')
  })

  it.each([
    ['archive.json', 1024 * 1024 + 1],
    ['project/meta.json', 1024 * 1024 + 1],
    ['project/family.json', 50 * 1024 * 1024 + 1],
    [photoPath, 25 * 1024 * 1024 + 1],
  ])('rejects excessive declared entry sizes before decompressing %s', async (path, size) => {
    const bundle = await mutateEntry(await fixture(), path, (_bytes, view, central) => {
      view.setUint32(central + 24, size, true)
    })
    await expect(openProjectBundle(bundle)).rejects.toThrow('条目过大')
  })

  it('rejects a total extracted size above 1 GiB even when individual entries fit', async () => {
    const media: FixtureEntry[] = Array.from({ length: 42 }, (_, index) => ({
      path: `project/media/photos/budget-${index}.webp`, content: 'small compressed input',
    }))
    let bundle = await fixture([...projectEntries(createEmptyFamily()), ...media])
    for (const entry of media) {
      bundle = await mutateEntry(bundle, entry.path, (_bytes, view, central) => {
        view.setUint32(central + 24, 25 * 1024 * 1024, true)
      })
    }
    await expect(openProjectBundle(bundle)).rejects.toThrow('1 GiB')
  })

  it('rejects archives with more than 5000 entries', async () => {
    const entries: FixtureEntry[] = Array.from({ length: 5001 }, (_, index) => ({
      path: `project/media/photos/entry-${index}.webp`, content: '',
    }))
    await expect(openProjectBundle(await fixture(entries))).rejects.toThrow('5000')
  }, 15000)

  it.each([false, true])('rejects oversized ZIP indexes before allocating their bytes (ZIP64=%s)', async zip64 => {
    const malicious = await oversizedIndexFixture(zip64)
    const readSizes: number[] = []
    const original = Blob.prototype.arrayBuffer
    const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      readSizes.push(this.size)
      return original.call(this)
    })
    try {
      await expect(openProjectBundle(malicious)).rejects.toThrow('备份包索引过大')
      expect(readSizes.length).toBeGreaterThan(0)
      expect(Math.max(...readSizes)).toBeLessThanOrEqual(8 * 1024 * 1024)
    } finally {
      arrayBuffer.mockRestore()
    }
  })

  it('still reads legitimate JSON and media larger than the index limit through chunked streams', async () => {
    const family = familyWithPhotos('photo-1')
    const notes = '项目正文'.repeat(1024 * 1024)
    family.members['member-0'].notes = notes
    const entries = projectEntries(family)
    const media = new Blob([new Uint8Array(9 * 1024 * 1024)])
    entries[3].content = media
    const reader = await openProjectBundle(await fixture(entries))
    try {
      expect(reader.family.members['member-0'].notes).toBe(notes)
      const files = await collect(reader.files())
      expect(files[0].data.size).toBe(media.size)
    } finally {
      await reader.close()
    }
  })

  it('rejects CRC corruption when consuming media, leaving callers able to roll back', async () => {
    const corrupt = await mutateEntry(await fixture(), photoPath, (bytes, view, _central, local) => {
      const dataOffset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      bytes[dataOffset] ^= 1
    })
    const reader = await openProjectBundle(corrupt)
    try {
      await expect(collect(reader.files())).rejects.toThrow()
    } finally {
      await reader.close()
    }
  })

  it('rejects a lying decompressed size while consuming bounded media', async () => {
    const bundle = await mutateEntry(await fixture(), photoPath, (_bytes, view, central, local) => {
      view.setUint32(central + 24, 1, true)
      view.setUint32(local + 22, 1, true)
    })
    const reader = await openProjectBundle(bundle)
    try {
      await expect(collect(reader.files())).rejects.toThrow()
    } finally {
      await reader.close()
    }
  })

  it('allows only one media pass and closes idempotently', async () => {
    const reader = await openProjectBundle(await fixture())
    await collect(reader.files())
    await expect(collect(reader.files())).rejects.toThrow('只能读取一次')
    await reader.close()
    await reader.close()
    await expect(collect(reader.files())).rejects.toThrow('已关闭')
  })

  it('aborts a partially written destination if a referenced image cannot be read', async () => {
    const output = transaction()
    await expect(exportProjectBundleToStream({
      meta: createEmptyMeta('示例家族'), family: familyWithPhotos('photo-1'),
      async readPhoto(_id, thumb) {
        if (thumb) throw new Error('缩略图丢失')
        return new Blob(['original'])
      },
    }, output.destination)).rejects.toThrow('缩略图丢失')
    expect(output.abort).toHaveBeenCalledOnce()
    expect(output.close).not.toHaveBeenCalled()
    expect(output.committed).toBeUndefined()
  })

  it('rejects invalid export data and aborts without committing', async () => {
    const output = transaction()
    const family = familyWithPhotos('photo-1')
    family.members['member-0'].parents.push({ id: 'missing', type: 'blood' })
    const readPhoto = vi.fn()
    await expect(exportProjectBundleToStream({ meta: createEmptyMeta('示例家族'), family, readPhoto }, output.destination))
      .rejects.toThrow('完整性')
    expect(readPhoto).not.toHaveBeenCalled()
    expect(output.abort).toHaveBeenCalledOnce()
    expect(output.close).not.toHaveBeenCalled()
  })

  it('rejects an export exceeding the entry budget before reading images', async () => {
    const output = transaction()
    const family = familyWithPhotos(...Array.from({ length: 2499 }, (_, index) => `photo-${index}`))
    const readPhoto = vi.fn()
    await expect(exportProjectBundleToStream({ meta: createEmptyMeta('大族谱'), family, readPhoto }, output.destination))
      .rejects.toThrow('5000')
    expect(readPhoto).not.toHaveBeenCalled()
    expect(output.abort).toHaveBeenCalledOnce()
  })

  it('rejects an oversized photo during export and aborts the destination', async () => {
    const output = transaction()
    const photo = new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])
    await expect(exportProjectBundleToStream({
      meta: createEmptyMeta('示例家族'), family: familyWithPhotos('photo-1'),
      async readPhoto() { return photo },
    }, output.destination)).rejects.toThrow('条目过大')
    expect(output.abort).toHaveBeenCalledOnce()
    expect(output.close).not.toHaveBeenCalled()
  })

  it('reports write and commit failures instead of claiming a successful export', async () => {
    for (const destination of [
      new WritableStream<Uint8Array>({ write() { throw new Error('disk full') } }),
      new WritableStream<Uint8Array>({ close() { throw new Error('commit failed') } }),
    ]) {
      await expect(exportProjectBundleToStream({
        meta: createEmptyMeta('示例家族'), family: createEmptyFamily(), readPhoto: vi.fn(),
      }, destination)).rejects.toThrow(/disk full|commit failed/)
      expect(destination.locked).toBe(false)
    }
  })
})
