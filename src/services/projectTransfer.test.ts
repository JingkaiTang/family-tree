import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'

const { pickProject, readPhoto, importBrowserProjectBundle, exportProjectBundleToStream } = vi.hoisted(() => ({
  pickProject: vi.fn(), readPhoto: vi.fn(), importBrowserProjectBundle: vi.fn(), exportProjectBundleToStream: vi.fn(),
}))
vi.mock('./storage', () => ({ pickProject, readPhoto }))
vi.mock('./storage/browserDirectory', () => ({ importBrowserProjectBundle }))
vi.mock('./storage/projectBundle', () => ({ exportProjectBundleToStream }))

import { DOWNLOAD_BUNDLE_MAX_BYTES, importProjectBundle, prepareProjectBundleExport } from './projectTransfer'

describe('browser project bundle transfers', () => {
  const project = { providerId: 'browser-directory', id: 'opaque-id', displayName: '家族' }
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('selects the export destination immediately but writes only the supplied saved snapshot', async () => {
    const output = new WritableStream<Uint8Array>()
    const createWritable = vi.fn(async () => output)
    const picker = vi.fn(async () => ({ name: '家族.familybundle', createWritable }))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    const pending = prepareProjectBundleExport(project)
    expect(picker).toHaveBeenCalledOnce()
    const runExport = await pending
    expect(createWritable).not.toHaveBeenCalled()
    const snapshot = { meta: createEmptyMeta('家族'), family: createEmptyFamily() }
    await expect(runExport!(snapshot)).resolves.toEqual({ kind: 'saved' })
    expect(exportProjectBundleToStream).toHaveBeenCalledWith(expect.objectContaining(snapshot), output)
    await expect(runExport!(snapshot)).rejects.toThrow('重新选择')
  })

  it('keeps export cancellation and invalid extensions from opening a writer', async () => {
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('cancel', 'AbortError'))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    await expect(prepareProjectBundleExport(project)).resolves.toBeNull()
    const createWritable = vi.fn()
    picker.mockResolvedValueOnce({ name: 'family.json', createWritable })
    await expect(prepareProjectBundleExport(project)).rejects.toThrow('.familybundle')
    expect(createWritable).not.toHaveBeenCalled()
  })

  it('requires an explicit snapshot without reopening the project or resetting its conflict baseline', async () => {
    const createWritable = vi.fn()
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn(async () => ({ name: 'x.familybundle', createWritable })) })
    const runExport = await prepareProjectBundleExport(project)
    await expect(runExport!()).rejects.toThrow('项目快照')
    expect(createWritable).not.toHaveBeenCalled()
  })

  it.each(['open', 'write'] as const)('preserves an export %s failure and requires a new destination before retrying', async phase => {
    const failure = new Error(phase === 'open' ? 'permission revoked' : 'disk full')
    const output = new WritableStream<Uint8Array>()
    const createWritable = vi.fn(async () => output)
    if (phase === 'open') createWritable.mockRejectedValueOnce(failure)
    else exportProjectBundleToStream.mockRejectedValueOnce(failure)
    const picker = vi.fn(async () => ({ name: '家族.familybundle', createWritable }))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    const snapshot = { meta: createEmptyMeta('家族'), family: createEmptyFamily() }
    const runExport = await prepareProjectBundleExport(project)

    await expect(runExport!(snapshot)).rejects.toBe(failure)
    await expect(runExport!(snapshot)).rejects.toThrow('重新选择')
    expect(picker).toHaveBeenCalledOnce()
    expect(createWritable).toHaveBeenCalledOnce()
    expect(exportProjectBundleToStream).toHaveBeenCalledTimes(phase === 'open' ? 0 : 1)
  })

  it('selects an empty import directory in the click chain and preserves its opaque reference', async () => {
    const file = new File(['zip'], '迁移.familybundle')
    const meta = createEmptyMeta('迁移')
    pickProject.mockResolvedValue(project)
    importBrowserProjectBundle.mockResolvedValue({ id: project.id, displayName: project.displayName, meta })
    const pending = importProjectBundle(file)
    expect(pickProject).toHaveBeenCalledWith('browser-directory', 'create')
    await expect(pending).resolves.toEqual({ project, meta })
    expect(importBrowserProjectBundle).toHaveBeenCalledWith(project.id, file)
  })

  it('does not read or extract an archive after directory selection cancellation', async () => {
    pickProject.mockResolvedValue(null)
    await expect(importProjectBundle(new File([], 'x.familybundle'))).resolves.toBeNull()
    expect(importBrowserProjectBundle).not.toHaveBeenCalled()
  })

  it('preserves archive validation and directory write failures', async () => {
    const file = new File(['zip'], '家族.familybundle')
    pickProject.mockResolvedValue(project)
    for (const message of ['备份包超过 512 MiB 限制', '目录写入失败', 'invalid bundle']) {
      const error = new Error(message)
      importBrowserProjectBundle.mockRejectedValueOnce(error)
      await expect(importProjectBundle(file)).rejects.toBe(error)
    }
  })

  it('streams a cloud project through the same photo IO and destination picker', async () => {
    const output = new WritableStream<Uint8Array>()
    const picker = vi.fn(async () => ({ name: 'cloud.familybundle', createWritable: async () => output }))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    const cloudProject = { ...project, providerId: 'google-drive:account' }
    const photo = new Blob(['private image'])
    readPhoto.mockResolvedValue(photo)
    exportProjectBundleToStream.mockImplementationOnce(async source => {
      expect(await source.readPhoto('image-id', false)).toBe(photo)
      expect(await source.readPhoto('image-id', true)).toBe(photo)
    })

    const runExport = await prepareProjectBundleExport(cloudProject)
    await expect(runExport!({ meta: createEmptyMeta('家族'), family: createEmptyFamily() }))
      .resolves.toEqual({ kind: 'saved' })
    expect(readPhoto).toHaveBeenNthCalledWith(1, cloudProject, 'image-id', false)
    expect(readPhoto).toHaveBeenNthCalledWith(2, cloudProject, 'image-id', true)
  })

  it('prepares a downloadable archive without a picker and snapshots reused chunks', async () => {
    vi.stubGlobal('window', {})
    exportProjectBundleToStream.mockImplementationOnce(async (_, output: WritableStream<Uint8Array>) => {
      const writer = output.getWriter()
      const chunk = new Uint8Array([1, 2, 3])
      await writer.write(chunk)
      chunk.fill(9)
      await writer.write(new Uint8Array([4]))
      await writer.close()
      writer.releaseLock()
    })
    const runExport = await prepareProjectBundleExport({ ...project, displayName: '家族/备份' })
    const result = await runExport!({ meta: createEmptyMeta('家族'), family: createEmptyFamily() })
    expect(result.kind).toBe('download')
    if (result.kind !== 'download') throw new Error('Expected download')
    expect(result.filename).toBe('家族_备份.familybundle')
    expect(result.blob.type).toBe('application/zip')
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('rejects a download archive exceeding 128 MiB before retaining the oversized chunk', async () => {
    vi.stubGlobal('window', {})
    exportProjectBundleToStream.mockImplementationOnce(async (_, output: WritableStream<Uint8Array>) => {
      const writer = output.getWriter()
      try {
        await writer.write(new Uint8Array(DOWNLOAD_BUNDLE_MAX_BYTES + 1))
      } finally {
        writer.releaseLock()
      }
    })
    const runExport = await prepareProjectBundleExport(project)
    await expect(runExport!({ meta: createEmptyMeta('家族'), family: createEmptyFamily() }))
      .rejects.toThrow('128 MiB')
  })

  it.each(['Network request failed', '授权已过期'])('does not offer an incomplete backup when photos fail: %s', async message => {
    vi.stubGlobal('window', {})
    readPhoto.mockRejectedValueOnce(new Error(message))
    exportProjectBundleToStream.mockImplementationOnce(async source => source.readPhoto('missing', false))
    const runExport = await prepareProjectBundleExport({ ...project, providerId: 'google-drive:account' })
    await expect(runExport!({ meta: createEmptyMeta('家族'), family: createEmptyFamily() }))
      .rejects.toThrow(`未生成完整备份。请检查网络及存储授权后重试：${message}`)
  })
})
