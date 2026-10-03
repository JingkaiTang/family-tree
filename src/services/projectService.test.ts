import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta, SCHEMA_VERSION, type Member } from '@/core/schema'
import { createProject, openProject, saveProject } from './projectService'
import type { ProjectRef } from './storage'

const api = vi.hoisted(() => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  createProject: vi.fn(),
}))

vi.mock('./storage', () => api)

const project: ProjectRef = { providerId: 'test-storage', id: 'opaque-id', displayName: '测试项目' }

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
    vi.resetAllMocks()
  })

  it('打开时迁移 family 并把旧 meta 版本归一到当前版本', async () => {
    const family = createEmptyFamily()
    api.loadProject.mockResolvedValue({
      ref: project,
      family,
      meta: { ...createEmptyMeta('测试'), schemaVersion: 1 },
    })

    const opened = await openProject(project)

    expect(opened.meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(opened.family.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('拒绝比应用更新的项目元数据版本', async () => {
    api.loadProject.mockResolvedValue({
      ref: project,
      family: createEmptyFamily(),
      meta: { ...createEmptyMeta('测试'), schemaVersion: SCHEMA_VERSION + 1 },
    })

    await expect(openProject(project)).rejects.toThrow('项目元数据版本过新')
  })

  it('打开时拒绝悬空的成员关系', async () => {
    const family = createEmptyFamily()
    const a = member('a')
    a.parents.push({ id: 'missing', type: 'blood' })
    family.members.a = a
    api.loadProject.mockResolvedValue({
      ref: project,
      family,
      meta: createEmptyMeta('测试'),
    })

    await expect(openProject(project)).rejects.toThrow('不存在的成员 missing')
  })

  it('保存前拒绝不一致数据且不调用底层写盘', async () => {
    const family = createEmptyFamily()
    family.members.a = member('a')
    family.rootMemberId = 'missing'

    await expect(saveProject(project, family)).rejects.toThrow('rootMemberId')
    expect(api.saveProject).not.toHaveBeenCalled()
  })

  it('创建后保存到提供商返回的新项目，而不是创建目标', async () => {
    const target = { ...project, id: 'parent-folder-id' }
    api.createProject.mockResolvedValue({ ref: project, meta: createEmptyMeta('新家族') })

    const created = await createProject(target, '新家族')

    expect(api.createProject).toHaveBeenCalledWith(target, '新家族')
    expect(api.saveProject).toHaveBeenCalledWith(project, createEmptyFamily())
    expect(created.project).toEqual(project)
  })

  it('元数据损坏时使用提供商的显示名称，不解析不透明 ID', async () => {
    api.loadProject.mockResolvedValue({ ref: project, meta: null, family: createEmptyFamily() })

    const opened = await openProject(project)

    expect(opened.meta.name).toBe('测试项目')
  })

  it('持久化失败时不返回创建成功', async () => {
    api.createProject.mockResolvedValue({ ref: project, meta: createEmptyMeta('新家族') })
    api.saveProject.mockRejectedValue(new Error('storage unavailable'))

    await expect(createProject(project, '新家族')).rejects.toThrow('storage unavailable')
  })

})
