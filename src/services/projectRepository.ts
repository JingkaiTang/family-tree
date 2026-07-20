import { invoke } from '@tauri-apps/api/core'
import type { FamilyData, ProjectMeta } from '@/core/schema'
import type { ExternalProjectRef, ProjectRef } from './projectRef'

export interface LoadedProject {
  project: ProjectRef
  meta: ProjectMeta
  family: FamilyData
}

export interface ProjectRepository {
  create(project: ProjectRef, name: string): Promise<ProjectMeta>
  load(project: ProjectRef): Promise<LoadedProject>
  save(project: ProjectRef, family: FamilyData): Promise<void>
  importPhoto(
    project: ProjectRef,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ photoId: string }>
  deletePhoto(project: ProjectRef, photoId: string): Promise<void>
  gcMedia(project: ProjectRef, usedIds: string[]): Promise<number>
  resolvePhotoUrl(project: ProjectRef, photoId: string, thumb?: boolean): Promise<string>
}

function requireExternalProject(project: ProjectRef): ExternalProjectRef {
  if (project.kind !== 'external') {
    throw new Error('当前版本尚未启用托管项目存储')
  }
  return project
}

export const projectRepository: ProjectRepository = {
  async create(project, name) {
    const { path } = requireExternalProject(project)
    return invoke<ProjectMeta>('create_project', { path, name })
  },

  async load(project) {
    const external = requireExternalProject(project)
    const { path } = external
    const loaded = await invoke<{ path: string; meta: ProjectMeta; family: FamilyData }>(
      'load_project',
      { path },
    )
    return { project: externalProjectFromLoadedPath(external, loaded.path), ...loaded }
  },

  async save(project, family) {
    const { path } = requireExternalProject(project)
    await invoke('save_project', { path, familyJson: JSON.stringify(family) })
  },

  async importPhoto(project, bytes, mime) {
    const { path: projectPath } = requireExternalProject(project)
    return invoke<{ photoId: string }>('import_photo', {
      projectPath,
      bytes: Array.from(bytes),
      mime,
    })
  },

  async deletePhoto(project, photoId) {
    const { path: projectPath } = requireExternalProject(project)
    await invoke('delete_photo', { projectPath, photoId })
  },

  async gcMedia(project, usedIds) {
    const { path: projectPath } = requireExternalProject(project)
    return invoke<number>('gc_media', { projectPath, usedIds })
  },

  async resolvePhotoUrl(project, photoId, thumb = false) {
    const { path: projectPath } = requireExternalProject(project)
    const bytes = await invoke<number[]>('load_photo', { projectPath, photoId, thumb })
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }))
  },
}

function externalProjectFromLoadedPath(
  requested: ExternalProjectRef,
  loadedPath: string,
): ExternalProjectRef {
  return loadedPath === requested.path ? requested : { kind: 'external', path: loadedPath }
}
