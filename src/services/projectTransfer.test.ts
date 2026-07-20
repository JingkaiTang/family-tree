import { beforeEach, describe, expect, it, vi } from 'vitest'
import { externalProjectRef } from './projectRef'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
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

describe('project bundle transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.copyFile.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
  })

  it('stages a picked document in AppCache before importing it', async () => {
    const imported = {
      project: { kind: 'managed', id: 'managed-id' },
      meta: { name: '测试', schemaVersion: 4, createdAt: 'now', updatedAt: 'now' },
    }
    mocks.open.mockResolvedValue('content://picked-bundle')
    mocks.importBundle.mockResolvedValue(imported)

    await expect(importProjectBundle()).resolves.toEqual(imported)

    expect(mocks.copyFile).toHaveBeenCalledWith(
      'content://picked-bundle',
      'transfers/00000000-0000-0000-0000-000000000001.familybundle',
      { toPathBaseDir: 16 },
    )
    expect(mocks.importBundle).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001.familybundle',
    )
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('copies an exported cache file to the selected destination', async () => {
    const project = externalProjectRef('/tmp/test.family')
    mocks.exportBundle.mockResolvedValue({
      transferName: 'generated.familybundle',
      suggestedName: '测试.familybundle',
    })
    mocks.save.mockResolvedValue('content://export-target')

    await expect(exportProjectBundle(project)).resolves.toBe(true)

    expect(mocks.copyFile).toHaveBeenCalledWith(
      'transfers/generated.familybundle',
      'content://export-target',
      { fromPathBaseDir: 16 },
    )
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('cleans the generated cache file when export is cancelled', async () => {
    mocks.exportBundle.mockResolvedValue({
      transferName: 'generated.familybundle',
      suggestedName: '测试.familybundle',
    })
    mocks.save.mockResolvedValue(null)

    await expect(exportProjectBundle(externalProjectRef('/tmp/test.family'))).resolves.toBe(false)

    expect(mocks.copyFile).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
