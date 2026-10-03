import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { createStorage } from './storage'
import { tauriManagedStorage, tauriProjectPicker, tauriStorage } from './tauri'
import { managedProjectRef } from '../projectRef'

const { invoke, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))

const ref = { providerId: 'tauri-local', id: '/project.family', displayName: 'project.family' }
const native = { kind: 'external', path: ref.id }

describe('Tauri storage adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    isTauri.mockReturnValue(true)
  })

  it('保留 Rust 项目命令和 canonical path，格式校验留给 projectService', async () => {
    const meta = createEmptyMeta('家族')
    invoke.mockResolvedValueOnce(meta).mockResolvedValueOnce({
      project: { kind: 'external', path: '/canonical/project.family' }, meta, family: { legacy: true },
    })
    const storage = createStorage([tauriStorage])
    expect((await storage.createProject(ref, '家族')).ref.id).toBe(ref.id)
    expect(invoke).toHaveBeenNthCalledWith(1, 'create_project', { project: native, name: '家族' })
    expect(await storage.loadProject(ref)).toEqual({
      ref: { ...ref, id: '/canonical/project.family' }, meta, family: { legacy: true },
    })
    const family = createEmptyFamily()
    await storage.saveProject(ref, family)
    expect(invoke).toHaveBeenLastCalledWith('save_project', { project: native, familyJson: JSON.stringify(family) })
  })

  it('通过字节读取私有照片，并保留 Rust 导入与回收命令参数', async () => {
    const storage = createStorage([tauriStorage])
    invoke.mockResolvedValueOnce({ photoId: 'p1' }).mockResolvedValueOnce([1, 2, 3])
    await storage.importPhoto(ref, new Uint8Array([5, 6]), 'image/png')
    expect(invoke).toHaveBeenLastCalledWith('import_photo', {
      project: native, bytes: [5, 6], mime: 'image/png',
    })
    const blob = await storage.readPhoto(ref, 'p1', true)
    expect(blob.type).toBe('image/webp')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(invoke).toHaveBeenLastCalledWith('load_photo', { project: native, photoId: 'p1', thumb: true })
    await storage.deletePhoto(ref, 'p1')
    expect(invoke).toHaveBeenLastCalledWith('delete_photo', { project: native, photoId: 'p1' })
    expect(storage.supportsMediaGc(ref)).toBe(true)
    await storage.gcMedia(ref, ['keep'])
    expect(invoke).toHaveBeenLastCalledWith('gc_media', { project: native, usedIds: ['keep'] })
  })

  it('托管项目使用 ID 完成项目和媒体读写，不暴露 AppData 路径', async () => {
    const storage = createStorage([tauriStorage, tauriManagedStorage])
    const project = managedProjectRef('00000000-0000-0000-0000-000000000001', '手机家族')
    const wire = { kind: 'managed', id: project.id }
    const meta = createEmptyMeta('手机家族')
    const family = createEmptyFamily()
    invoke.mockResolvedValueOnce(meta).mockResolvedValueOnce({ project: wire, meta, family })
    const created = await storage.createProject(project, '手机家族')
    expect(created.ref).toEqual(project)
    expect(await storage.loadProject(created.ref)).toEqual({ ref: project, meta, family })
    await storage.saveProject(project, family)
    expect(invoke).toHaveBeenLastCalledWith('save_project', { project: wire, familyJson: JSON.stringify(family) })
    invoke.mockResolvedValueOnce({ photoId: 'p1' }).mockResolvedValueOnce([1])
    await storage.importPhoto(project, new Uint8Array([2]), 'image/png')
    expect(invoke).toHaveBeenLastCalledWith('import_photo', { project: wire, bytes: [2], mime: 'image/png' })
    await storage.readPhoto(project, 'p1', true)
    expect(invoke).toHaveBeenLastCalledWith('load_photo', { project: wire, photoId: 'p1', thumb: true })
    await storage.deletePhoto(project, 'p1')
    expect(invoke).toHaveBeenLastCalledWith('delete_photo', { project: wire, photoId: 'p1' })
    await storage.gcMedia(project, [])
    expect(invoke).toHaveBeenLastCalledWith('gc_media', { project: wire, usedIds: [] })
  })

  it('在适配器内处理 Windows 路径名称和取消选择', async () => {
    const storage = createStorage([tauriStorage], [tauriProjectPicker])
    invoke.mockResolvedValueOnce({ kind: 'external', path: 'C:\\Users\\Family.family' }).mockResolvedValueOnce(null)
    expect(await storage.pickProject('tauri-local', 'open')).toEqual({
      providerId: 'tauri-local', id: 'C:\\Users\\Family.family', displayName: 'Family.family',
    })
    expect(invoke).toHaveBeenLastCalledWith('pick_project_directory', { title: '选择要打开的家族项目文件夹' })
    expect(await storage.pickProject('tauri-local', 'create')).toBeNull()
  })

  it('普通浏览器明确报告尚未接入存储，不尝试桌面 IPC', async () => {
    isTauri.mockReturnValue(false)
    await expect(tauriStorage.loadProject(ref.id)).rejects.toThrow('浏览器目录存储尚未接入')
    expect(invoke).not.toHaveBeenCalled()
  })
})
