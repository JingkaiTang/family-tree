import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta, SCHEMA_VERSION, type Member } from '@/core/schema'
import { openProject, saveProject } from './projectService'

const api = vi.hoisted(() => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  createProject: vi.fn(),
}))

vi.mock('./tauriApi', () => api)

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
    api.loadProject.mockResolvedValue({
      path: '/project',
      family,
      meta: { ...createEmptyMeta('测试'), schemaVersion: 1 },
    })

    const opened = await openProject('/project')

    expect(opened.meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(opened.family.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('拒绝比应用更新的项目元数据版本', async () => {
    api.loadProject.mockResolvedValue({
      path: '/project',
      family: createEmptyFamily(),
      meta: { ...createEmptyMeta('测试'), schemaVersion: SCHEMA_VERSION + 1 },
    })

    await expect(openProject('/project')).rejects.toThrow('项目元数据版本过新')
  })

  it('打开时拒绝悬空的成员关系', async () => {
    const family = createEmptyFamily()
    const a = member('a')
    a.parents.push({ id: 'missing', type: 'blood' })
    family.members.a = a
    api.loadProject.mockResolvedValue({
      path: '/project',
      family,
      meta: createEmptyMeta('测试'),
    })

    await expect(openProject('/project')).rejects.toThrow('不存在的成员 missing')
  })

  it('保存前拒绝不一致数据且不调用底层写盘', async () => {
    const family = createEmptyFamily()
    family.members.a = member('a')
    family.rootMemberId = 'missing'

    await expect(saveProject('/project', family)).rejects.toThrow('rootMemberId')
    expect(api.saveProject).not.toHaveBeenCalled()
  })
})
