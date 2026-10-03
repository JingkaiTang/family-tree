import { beforeEach, describe, expect, it, vi } from 'vitest'
import { externalProjectRef } from './projectRef'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  openFile: vi.fn(),
  save: vi.fn(),
  mkdir: vi.fn(),
  copyFile: vi.fn(),
  remove: vi.fn(),
  importBundle: vi.fn(),
  exportBundle: vi.fn(),
  uuid: vi.fn(() => '00000000-0000-0000-0000-000000000001'),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppCache: 16 },
  mkdir: mocks.mkdir,
  open: mocks.openFile,
  copyFile: mocks.copyFile,
  remove: mocks.remove,
}))
vi.mock('uuid', () => ({ v4: mocks.uuid }))
vi.mock('./projectRepository', () => ({
  projectRepository: {
    importBundle: mocks.importBundle,
    exportBundle: mocks.exportBundle,
  },
}))

import { exportProjectBundle, importProjectBundle } from './projectTransfer'

const transferName = '00000000-0000-0000-0000-000000000001.familybundle'
const imported = {
  project: { kind: 'managed', id: 'managed-id' },
  meta: { name: '测试', schemaVersion: 4, createdAt: 'now', updatedAt: 'now' },
}

function readableFile(bytes: Uint8Array, maxRead = bytes.length) {
  let offset = 0
  return {
    read: vi.fn(async (buffer: Uint8Array) => {
      if (offset === bytes.length) return null
      const count = Math.min(buffer.length, maxRead, bytes.length - offset)
      buffer.set(bytes.subarray(offset, offset + count))
      offset += count
      return count
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function writableFile(maxWrite = Infinity) {
  const received: number[] = []
  return {
    received,
    write: vi.fn(async (bytes: Uint8Array) => {
      const count = Math.min(maxWrite, bytes.length)
      received.push(...bytes.subarray(0, count))
      return count
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('project bundle transfers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.uuid.mockReturnValue('00000000-0000-0000-0000-000000000001')
    mocks.mkdir.mockResolvedValue(undefined)
    // Native copyFile resolves filesystem paths and rejects Android content URIs.
    mocks.copyFile.mockRejectedValue(new Error('invalid path URL'))
    mocks.remove.mockResolvedValue(undefined)
    mocks.open.mockResolvedValue('content://picked-bundle')
    mocks.save.mockResolvedValue('content://export-target')
    mocks.importBundle.mockResolvedValue(imported)
    mocks.exportBundle.mockResolvedValue({
      transferName: 'generated.familybundle',
      suggestedName: '测试.familybundle',
    })
  })

  it('streams a picked content URI to AppCache with bounded reads and complete short writes', async () => {
    const bytes = Uint8Array.from({ length: 150_003 }, (_, index) => index % 251)
    const source = readableFile(bytes, 20_003)
    const destination = writableFile(4_097)
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)
    mocks.importBundle.mockImplementation(async () => {
      expect(source.close).toHaveBeenCalledOnce()
      expect(destination.close).toHaveBeenCalledOnce()
      expect(Uint8Array.from(destination.received)).toEqual(bytes)
      return imported
    })

    await expect(importProjectBundle()).resolves.toEqual(imported)

    expect(mocks.openFile).toHaveBeenNthCalledWith(1, 'content://picked-bundle', { read: true })
    expect(mocks.openFile).toHaveBeenNthCalledWith(2, `transfers/${transferName}`, {
      write: true, create: true, truncate: true, baseDir: 16,
    })
    expect(source.read.mock.calls.length).toBeGreaterThan(2)
    const buffers = source.read.mock.calls.map(([buffer]) => buffer)
    expect(new Set(buffers).size).toBe(1)
    expect(buffers[0].byteLength).toBe(64 * 1024)
    expect(mocks.copyFile).not.toHaveBeenCalled()
    expect(mocks.importBundle).toHaveBeenCalledWith(transferName)
    expect(mocks.remove).toHaveBeenCalledWith(
      `transfers/${transferName}`, { baseDir: 16 },
    )
  })

  it('streams an exported cache file into the selected content URI', async () => {
    const project = externalProjectRef('/tmp/test.family')
    const bytes = new Uint8Array([0, 255, 17, 42, 128])
    const source = readableFile(bytes)
    const destination = writableFile(2)
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)

    await expect(exportProjectBundle(project)).resolves.toBe(true)

    expect(mocks.openFile).toHaveBeenNthCalledWith(1, 'transfers/generated.familybundle', {
      read: true, baseDir: 16,
    })
    expect(mocks.openFile).toHaveBeenNthCalledWith(2, 'content://export-target', {
      write: true, create: true, truncate: true,
    })
    expect(Uint8Array.from(destination.received)).toEqual(bytes)
    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.copyFile).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith(
      'transfers/generated.familybundle', { baseDir: 16 },
    )
  })

  it('closes the source and cleans staging if opening the destination fails', async () => {
    const source = readableFile(new Uint8Array([1]))
    const error = new Error('destination unavailable')
    mocks.openFile.mockResolvedValueOnce(source).mockRejectedValueOnce(error)

    await expect(importProjectBundle()).rejects.toBe(error)

    expect(source.close).toHaveBeenCalledOnce()
    expect(mocks.importBundle).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('closes both handles and removes the exported cache when reading fails', async () => {
    const source = readableFile(new Uint8Array([1]))
    const destination = writableFile()
    const error = new Error('read failed')
    source.read.mockRejectedValueOnce(error)
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)

    await expect(exportProjectBundle(externalProjectRef('/tmp/test.family'))).rejects.toBe(error)

    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('preserves a write failure while attempting both closes and cleaning staging', async () => {
    const source = readableFile(new Uint8Array([1]))
    const destination = writableFile()
    const error = new Error('write failed')
    destination.write.mockRejectedValueOnce(error)
    source.close.mockRejectedValueOnce(new Error('close failed'))
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)

    await expect(importProjectBundle()).rejects.toBe(error)

    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.importBundle).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('rejects a zero-byte write instead of retrying indefinitely', async () => {
    const source = readableFile(new Uint8Array([1]))
    const destination = writableFile(0)
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)

    await expect(importProjectBundle()).rejects.toThrow('备份文件写入未取得进展')

    expect(destination.write).toHaveBeenCalledOnce()
    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.importBundle).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('reports a close failure, still closes the other handle, and removes staging', async () => {
    const source = readableFile(new Uint8Array([1]))
    const destination = writableFile()
    const error = new Error('close failed')
    source.close.mockRejectedValueOnce(error)
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)

    await expect(importProjectBundle()).rejects.toBe(error)

    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.importBundle).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('cleans staging when the completed bundle is rejected by the repository', async () => {
    const source = readableFile(new Uint8Array([1]))
    const destination = writableFile()
    const error = new Error('invalid bundle')
    mocks.openFile.mockResolvedValueOnce(source).mockResolvedValueOnce(destination)
    mocks.importBundle.mockRejectedValueOnce(error)

    await expect(importProjectBundle()).rejects.toBe(error)

    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.close).toHaveBeenCalledOnce()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('cleans the generated cache file when export is cancelled', async () => {
    mocks.save.mockResolvedValue(null)

    await expect(exportProjectBundle(externalProjectRef('/tmp/test.family'))).resolves.toBe(false)

    expect(mocks.openFile).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('does not stage anything when import is cancelled', async () => {
    mocks.open.mockResolvedValue(null)

    await expect(importProjectBundle()).resolves.toBeNull()

    expect(mocks.openFile).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
