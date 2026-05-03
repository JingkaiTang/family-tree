import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { FamilyData, ProjectMeta } from '@/core/schema'

// ---------------- Rust commands ----------------

export interface LoadedProject {
  path: string
  meta: ProjectMeta
  family: FamilyData
}

/** 在指定目录创建新项目文件夹结构（family.json、meta.json、media/ 等） */
export async function createProject(path: string, name: string): Promise<ProjectMeta> {
  return invoke<ProjectMeta>('create_project', { path, name })
}

/** 读入整个项目（family.json + meta.json） */
export async function loadProject(path: string): Promise<LoadedProject> {
  return invoke<LoadedProject>('load_project', { path })
}

/** 原子写入 family.json（临时文件 + rename + .bak 轮转） */
export async function saveProject(path: string, family: FamilyData): Promise<void> {
  await invoke('save_project', { path, familyJson: JSON.stringify(family) })
}

/** 保存一张图片：Rust 转 webp + 生成缩略图，返回 photoId。 */
export async function importPhoto(
  projectPath: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ photoId: string }> {
  return invoke<{ photoId: string }>('import_photo', {
    projectPath,
    bytes: Array.from(bytes),
    mime,
  })
}

export async function deletePhoto(projectPath: string, photoId: string): Promise<void> {
  await invoke('delete_photo', { projectPath, photoId })
}

export async function gcMedia(projectPath: string, usedIds: string[]): Promise<number> {
  return invoke<number>('gc_media', { projectPath, usedIds })
}

/** 把项目内 media/photos/{id}.webp 解析成前端 <img> 可直接显示的 URL */
export async function resolvePhotoUrl(
  projectPath: string,
  photoId: string,
  thumb = false,
): Promise<string> {
  const absPath = await invoke<string>('resolve_photo_path', {
    projectPath,
    photoId,
    thumb,
  })
  return convertFileSrc(absPath)
}

// ---------------- Dialog helpers ----------------

/** 让用户选择一个文件夹（新建/打开项目均用此） */
export async function pickDirectory(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title })
  if (!result) return null
  return typeof result === 'string' ? result : null
}
