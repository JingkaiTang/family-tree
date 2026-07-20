import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { externalProjectRef } from './projectRef'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { projectRepository } from './projectRepository'

describe('Tauri project repository', () => {
  beforeEach(() => invoke.mockReset())

  it('maps external references to the existing desktop command contract', async () => {
    const project = externalProjectRef('/tmp/test.family')
    invoke.mockResolvedValue({
      path: project.path,
      meta: createEmptyMeta('测试'),
      family: createEmptyFamily(),
    })

    const loaded = await projectRepository.load(project)

    expect(invoke).toHaveBeenCalledWith('load_project', { path: project.path })
    expect(loaded.project).toBe(project)
  })

  it('rejects managed projects until the managed backend is enabled', async () => {
    const project = { kind: 'managed', id: 'local-id' } as const

    await expect(projectRepository.load(project)).rejects.toThrow('尚未启用托管项目存储')
    expect(invoke).not.toHaveBeenCalled()
  })
})
