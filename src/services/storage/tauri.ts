import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ProjectMeta } from '@/core/schema'
import { externalProjectRef, managedProjectRef } from '../projectRef'
import type { ProjectPicker, ProjectRef, ProjectStorageProvider } from './types'

/** Rust IPC 的类型仅在原生适配层使用，不泄漏为公共存储标识。 */
export type NativeProjectRef = { kind: 'external'; path: string } | { kind: 'managed'; id: string }

export function toNativeProject(project: ProjectRef): NativeProjectRef {
  if (project.providerId === 'tauri-local') return { kind: 'external', path: project.id }
  if (project.providerId === 'tauri-managed') return { kind: 'managed', id: project.id }
  throw new Error('此存储不支持原生项目传输')
}

export function fromNativeProject(project: NativeProjectRef, name?: string): ProjectRef {
  return project.kind === 'external'
    ? externalProjectRef(project.path)
    : managedProjectRef(project.id, name || project.id)
}

function displayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function requireNativeStorage() {
  if (!isTauri()) throw new Error('此存储需要原生客户端；浏览器目录存储尚未接入')
}

/** 保留现有 Rust 校验、备份、图片转换与回收能力，不扩大文件系统权限。 */
function nativeProvider(providerId: 'tauri-local' | 'tauri-managed'): ProjectStorageProvider {
  const nativeRef = (id: string) => toNativeProject({ providerId, id, displayName: id })
  return {
    id: providerId,
    async createProject(id, name) {
      requireNativeStorage()
      const meta = await invoke<ProjectMeta>('create_project', { project: nativeRef(id), name })
      return { id, displayName: providerId === 'tauri-local' ? displayName(id) : name, meta }
    },
    async loadProject(id) {
      requireNativeStorage()
      const loaded = await invoke<{ project: NativeProjectRef; meta: unknown; family: unknown }>(
        'load_project', { project: nativeRef(id) },
      )
      const name = typeof loaded.meta === 'object' && loaded.meta !== null && 'name' in loaded.meta
        && typeof loaded.meta.name === 'string' ? loaded.meta.name : undefined
      const project = fromNativeProject(loaded.project, name)
      if (project.providerId !== providerId) throw new Error('原生项目返回了不同的存储类型')
      return { id: project.id, displayName: project.displayName, meta: loaded.meta, family: loaded.family }
    },
    async saveProject(id, family) {
      requireNativeStorage()
      await invoke('save_project', { project: nativeRef(id), familyJson: JSON.stringify(family) })
    },
    async importPhoto(id, bytes, mime) {
      requireNativeStorage()
      return invoke<{ photoId: string }>('import_photo', { project: nativeRef(id), bytes: Array.from(bytes), mime })
    },
    async readPhoto(id, photoId, thumb) {
      requireNativeStorage()
      const bytes = await invoke<number[]>('load_photo', { project: nativeRef(id), photoId, thumb })
      return new Blob([new Uint8Array(bytes)], { type: 'image/webp' })
    },
    async deletePhoto(id, photoId) {
      requireNativeStorage()
      await invoke('delete_photo', { project: nativeRef(id), photoId })
    },
    async gcMedia(id, usedIds) {
      requireNativeStorage()
      return invoke<number>('gc_media', { project: nativeRef(id), usedIds })
    },
  }
}

export const tauriStorage = nativeProvider('tauri-local')
export const tauriManagedStorage = nativeProvider('tauri-managed')

export const tauriProjectPicker: ProjectPicker = {
  providerId: 'tauri-local',
  async pickProject(mode) {
    requireNativeStorage()
    const selected = await invoke<NativeProjectRef | null>('pick_project_directory', {
      title: mode === 'create' ? '选择一个文件夹作为家族项目根目录' : '选择要打开的家族项目文件夹',
    })
    if (!selected) return null
    const project = fromNativeProject(selected)
    if (project.providerId !== 'tauri-local') throw new Error('目录选择器返回了不同的存储类型')
    return { id: project.id, displayName: project.displayName }
  },
}
