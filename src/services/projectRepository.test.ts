import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { externalProjectRef, managedProjectRef } from './projectRef'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }))

import { projectRepository } from './projectRepository'
import { loadProject } from './storage'

describe('Tauri project repository', () => {
  beforeEach(() => invoke.mockReset())

  it('passes external references through the unified command contract', async () => {
    const project = externalProjectRef('/tmp/test.family')
    invoke.mockResolvedValue({
      project: { kind: 'external', path: project.id },
      meta: createEmptyMeta('测试'),
      family: createEmptyFamily(),
    })

    const loaded = await loadProject(project)

    expect(invoke).toHaveBeenCalledWith('load_project', { project: { kind: 'external', path: project.id } })
    expect(loaded.ref).toEqual(project)
  })

  it('passes managed references without exposing an AppData path', async () => {
    const project = managedProjectRef('local-id', '测试')
    invoke.mockResolvedValue({
      project: { kind: 'managed', id: project.id },
      meta: createEmptyMeta('测试'),
      family: createEmptyFamily(),
    })

    await expect(loadProject(project)).resolves.toMatchObject({ ref: project })
    expect(invoke).toHaveBeenCalledWith('load_project', { project: { kind: 'managed', id: project.id } })
  })

  it('lists managed projects through the AppData catalog command', async () => {
    const meta = createEmptyMeta('手机项目')
    invoke.mockResolvedValue([{ project: { kind: 'managed', id: 'local-id' }, meta }])

    await expect(projectRepository.listManaged()).resolves.toEqual([
      { project: managedProjectRef('local-id', '手机项目'), meta },
    ])
    expect(invoke).toHaveBeenCalledWith('list_managed_projects')
  })

})
