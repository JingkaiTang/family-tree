import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { externalProjectRef } from './projectRef'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { projectRepository } from './projectRepository'

describe('Tauri project repository', () => {
  beforeEach(() => invoke.mockReset())

  it('passes external references through the unified command contract', async () => {
    const project = externalProjectRef('/tmp/test.family')
    invoke.mockResolvedValue({
      project,
      meta: createEmptyMeta('测试'),
      family: createEmptyFamily(),
    })

    const loaded = await projectRepository.load(project)

    expect(invoke).toHaveBeenCalledWith('load_project', { project })
    expect(loaded.project).toBe(project)
  })

  it('passes managed references without exposing an AppData path', async () => {
    const project = { kind: 'managed', id: 'local-id' } as const
    invoke.mockResolvedValue({
      project,
      meta: createEmptyMeta('测试'),
      family: createEmptyFamily(),
    })

    await expect(projectRepository.load(project)).resolves.toMatchObject({ project })
    expect(invoke).toHaveBeenCalledWith('load_project', { project })
  })

  it('lists managed projects through the AppData catalog command', async () => {
    invoke.mockResolvedValue([])

    await expect(projectRepository.listManaged()).resolves.toEqual([])
    expect(invoke).toHaveBeenCalledWith('list_managed_projects')
  })

  it('uses cache transfer tokens for bundle import and export', async () => {
    const project = externalProjectRef('/tmp/test.family')
    invoke
      .mockResolvedValueOnce({ transferName: 'token.familybundle', suggestedName: '测试.familybundle' })
      .mockResolvedValueOnce({ project: { kind: 'managed', id: 'managed-id' }, meta: createEmptyMeta('测试') })

    await projectRepository.exportBundle(project)
    await projectRepository.importBundle('token.familybundle')

    expect(invoke).toHaveBeenNthCalledWith(1, 'export_project_bundle', { project })
    expect(invoke).toHaveBeenNthCalledWith(2, 'import_project_bundle', {
      transferName: 'token.familybundle',
    })
  })
})
