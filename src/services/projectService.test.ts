import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta, SCHEMA_VERSION, type Member } from '@/core/schema'
import { openProject, saveProject } from './projectService'
import { externalProjectRef } from './projectRef'

const repository = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
}))

vi.mock('./projectRepository', () => ({ projectRepository: repository }))

function member(id: string): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  }
}

describe('projectService format boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('打开时迁移 family 并把旧 meta 版本归一到当前版本', async () => {
    const family = createEmptyFamily()
    repository.load.mockResolvedValue({
      project: externalProjectRef('/project'),
      family,
      meta: { ...createEmptyMeta('测试'), schemaVersion: 1 },
    })

    const opened = await openProject(externalProjectRef('/project'))

    expect(opened.meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(opened.family.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('拒绝比应用更新的项目元数据版本', async () => {
    repository.load.mockResolvedValue({
      project: externalProjectRef('/project'),
      family: createEmptyFamily(),
      meta: { ...createEmptyMeta('测试'), schemaVersion: SCHEMA_VERSION + 1 },
    })

    await expect(openProject(externalProjectRef('/project'))).rejects.toThrow('项目元数据版本过新')
  })

  it('打开时拒绝悬空的成员关系', async () => {
    const family = createEmptyFamily()
    const a = member('a')
    a.parents.push({ id: 'missing', type: 'blood' })
    family.members.a = a
    repository.load.mockResolvedValue({
      project: externalProjectRef('/project'),
      family,
      meta: createEmptyMeta('测试'),
    })

    await expect(openProject(externalProjectRef('/project'))).rejects.toThrow('不存在的成员 missing')
  })

  it('保存前拒绝不一致数据且不调用底层写盘', async () => {
    const family = createEmptyFamily()
    family.members.a = member('a')
    family.rootMemberId = 'missing'

    await expect(saveProject(externalProjectRef('/project'), family)).rejects.toThrow('rootMemberId')
    expect(repository.save).not.toHaveBeenCalled()
  })
})
