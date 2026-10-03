import { describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta, type FamilyData } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { createStorage } from './storage'
import type { ProjectRef, ProjectStorageProvider, StoredProject } from './types'

function memoryProvider(id: string) {
  const projects = new Map<string, StoredProject>()
  const photos = new Map<string, Blob>()
  const provider: ProjectStorageProvider = {
    id,
    async createProject(target, name) {
      const projectId = `new:${target}`
      const meta = createEmptyMeta(name)
      projects.set(projectId, { id: projectId, displayName: name, meta, family: createEmptyFamily() })
      return { id: projectId, displayName: name, meta }
    },
    async loadProject(projectId) {
      const project = projects.get(projectId)
      if (!project) throw new Error('not found')
      return structuredClone(project)
    },
    async saveProject(projectId, family) {
      const project = projects.get(projectId)
      if (!project) throw new Error('not found')
      project.family = structuredClone(family)
    },
    async importPhoto(projectId, bytes, mime) {
      const photoId = 'same-photo-id'
      photos.set(`${projectId}:${photoId}`, new Blob([new Uint8Array(bytes)], { type: mime }))
      return { photoId }
    },
    async readPhoto(projectId, photoId) {
      const blob = photos.get(`${projectId}:${photoId}`)
      if (!blob) throw new Error('photo not found')
      return blob
    },
    async deletePhoto(projectId, photoId) {
      photos.delete(`${projectId}:${photoId}`)
    },
  }
  return provider
}

function target(providerId: string): ProjectRef {
  return { providerId, id: 'opaque-parent-id', displayName: '创建位置' }
}

describe('storage routing contract', () => {
  it('隔离不同提供商的同名项目和媒体，支持非路径 ID', async () => {
    const storage = createStorage([memoryProvider('account-a'), memoryProvider('account-b')])
    const a = await storage.createProject(target('account-a'), '家族 A')
    const b = await storage.createProject(target('account-b'), '家族 B')
    expect(a.ref.id).toBe(b.ref.id)

    const edited: FamilyData = { ...createEmptyFamily(), members: { a: mk('a') } }
    await storage.saveProject(a.ref, edited)
    expect((await storage.loadProject(a.ref)).family).toEqual(edited)
    expect((await storage.loadProject(b.ref)).family).toEqual(createEmptyFamily())

    await storage.importPhoto(a.ref, new Uint8Array([1, 2]), 'image/webp')
    await storage.importPhoto(b.ref, new Uint8Array([3, 4]), 'image/webp')
    const photoA = await storage.readPhoto(a.ref, 'same-photo-id')
    const photoB = await storage.readPhoto(b.ref, 'same-photo-id')
    expect(new Uint8Array(await photoA.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
    expect(new Uint8Array(await photoB.arrayBuffer())).toEqual(new Uint8Array([3, 4]))

    await storage.deletePhoto(a.ref, 'same-photo-id')
    await expect(storage.readPhoto(a.ref, 'same-photo-id')).rejects.toThrow('photo not found')
    expect(await storage.readPhoto(b.ref, 'same-photo-id')).toBe(photoB)
  })

  it('拒绝未连接的提供商及重复注册，不回退到其他存储', async () => {
    const local = memoryProvider('local')
    const save = vi.spyOn(local, 'saveProject')
    const storage = createStorage([local])
    expect(storage.hasProvider('local')).toBe(true)
    expect(storage.hasProvider('missing')).toBe(false)
    storage.registerProvider(memoryProvider('new-connection'))
    expect(storage.hasProvider('new-connection')).toBe(true)
    await expect(storage.saveProject(target('missing'), createEmptyFamily())).rejects.toThrow('尚未连接')
    expect(save).not.toHaveBeenCalled()
    expect(() => storage.registerProvider(memoryProvider('local'))).toThrow('重复')
  })

  it('选择器与 IO 分开，取消不产生项目，也不隐式请求权限', async () => {
    const provider = memoryProvider('local')
    const create = vi.spyOn(provider, 'createProject')
    const pick = vi.fn(async () => null)
    const storage = createStorage([provider], [{ providerId: 'local', pickProject: pick }])
    expect(await storage.pickProject('local', 'create')).toBeNull()
    expect(create).not.toHaveBeenCalled()
    await expect(storage.loadProject(target('local'))).rejects.toThrow('not found')
    expect(pick).toHaveBeenCalledOnce()
  })

  it('清理是可选能力，不为缺少安全实现的提供商执行 GC', async () => {
    const provider = memoryProvider('remote')
    const remove = vi.spyOn(provider, 'deletePhoto')
    const storage = createStorage([provider])
    expect(storage.supportsMediaGc(target('remote'))).toBe(false)
    await expect(storage.gcMedia(target('remote'), [])).rejects.toThrow('不支持安全清理')
    expect(remove).not.toHaveBeenCalled()
  })

  it('授权只通过显式交互入口转发，不由读写隐式触发', async () => {
    const authorizeProject = vi.fn(async () => undefined)
    const storage = createStorage([memoryProvider('local')], [{
      providerId: 'local', pickProject: async () => null, authorizeProject,
    }])
    const created = await storage.createProject(target('local'), '测试')
    await storage.loadProject(created.ref)
    await storage.saveProject(created.ref, createEmptyFamily())
    expect(authorizeProject).not.toHaveBeenCalled()
    await storage.authorizeProject(created.ref)
    expect(authorizeProject).toHaveBeenCalledExactlyOnceWith(created.ref.id)
    await expect(storage.authorizeProject(target('unknown'))).rejects.toThrow('尚未连接')
  })

  it('保存 Promise 只有在提供商持久化完成后才成功，失败原样传递', async () => {
    let finish: (() => void) | undefined
    const provider = memoryProvider('slow')
    provider.saveProject = () => new Promise<void>(resolve => { finish = resolve })
    const storage = createStorage([provider])
    let saved = false
    const pending = storage.saveProject(target('slow'), createEmptyFamily()).then(() => { saved = true })
    await Promise.resolve()
    expect(saved).toBe(false)
    finish?.()
    await pending
    expect(saved).toBe(true)

    provider.saveProject = async () => { throw new Error('quota exceeded') }
    await expect(storage.saveProject(target('slow'), createEmptyFamily())).rejects.toThrow('quota exceeded')
  })
})
