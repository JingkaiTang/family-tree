import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { externalProjectRef, managedProjectRef } from './projectRef'

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
const { pickProject, readPhoto, importBrowserProjectBundle, exportProjectBundleToStream } = vi.hoisted(() => ({
  pickProject: vi.fn(), readPhoto: vi.fn(), importBrowserProjectBundle: vi.fn(), exportProjectBundleToStream: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))
vi.mock('./storage', () => ({ pickProject, readPhoto }))
vi.mock('./storage/browserDirectory', () => ({ importBrowserProjectBundle }))
vi.mock('./storage/projectBundle', () => ({ exportProjectBundleToStream }))

import { exportProjectBundle, importProjectBundle, prepareProjectBundleExport } from './projectTransfer'

describe('native project bundle transfers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    isTauri.mockReturnValue(true)
  })

  it('imports the selected bundle through native IO and maps the managed project', async () => {
    const meta = createEmptyMeta('手机家族')
    invoke.mockResolvedValue({ project: { kind: 'managed', id: 'managed-id' }, meta })
    await expect(importProjectBundle()).resolves.toEqual({ project: managedProjectRef('managed-id', '手机家族'), meta })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('import_project_bundle_from_picker')
  })

  it('does not open a project when the native picker is cancelled', async () => {
    invoke.mockResolvedValue(null)
    await expect(importProjectBundle()).resolves.toBeNull()
  })

  it.each([
    { project: externalProjectRef('/tmp/test.family'), wire: { kind: 'external', path: '/tmp/test.family' } },
    { project: managedProjectRef('managed-id'), wire: { kind: 'managed', id: 'managed-id' } },
  ])('exports $wire.kind through the bounded native transfer', async ({ project, wire }) => {
    invoke.mockResolvedValue(true)
    await expect(exportProjectBundle(project)).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('export_project_bundle_to_picker', { project: wire })
  })

  it('preserves native cancellation, IO failures and archive limits', async () => {
    invoke.mockResolvedValueOnce(false)
    await expect(exportProjectBundle(externalProjectRef('/tmp/test.family'))).resolves.toBe(false)
    for (const message of ['备份包超过 512 MiB 限制', 'read failed', 'write failed', 'flush failed', 'invalid bundle']) {
      const error = new Error(message)
      invoke.mockRejectedValueOnce(error)
      await expect(importProjectBundle()).rejects.toBe(error)
    }
  })

  it('rejects other providers without granting a native file operation', async () => {
    await expect(exportProjectBundle({ providerId: 'drive', id: 'id', displayName: '远端家族' }))
      .rejects.toThrow('不支持原生项目传输')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not call native IO from a browser', async () => {
    isTauri.mockReturnValue(false)
    await expect(importProjectBundle()).rejects.toThrow('先选择家族备份')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('browser project bundle transfers', () => {
  const project = { providerId: 'browser-directory', id: 'opaque-id', displayName: '家族' }
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    isTauri.mockReturnValue(false)
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
    await expect(runExport!(snapshot)).resolves.toBe(true)
    expect(exportProjectBundleToStream).toHaveBeenCalledWith(expect.objectContaining(snapshot), output)
    expect(invoke).not.toHaveBeenCalled()
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
    await expect(exportProjectBundle(project)).rejects.toThrow('已保存的项目快照')
    expect(createWritable).not.toHaveBeenCalled()
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
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not read or extract an archive after directory selection cancellation', async () => {
    pickProject.mockResolvedValue(null)
    await expect(importProjectBundle(new File([], 'x.familybundle'))).resolves.toBeNull()
    expect(importBrowserProjectBundle).not.toHaveBeenCalled()
  })
})
