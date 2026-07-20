import { invoke } from '@tauri-apps/api/core'
import type { FamilyData, ProjectMeta } from '@/core/schema'
import type { ProjectRef } from './projectRef'

export interface LoadedProject {
  project: ProjectRef
  meta: ProjectMeta
  family: FamilyData
}

export interface ManagedProjectSummary {
  project: Extract<ProjectRef, { kind: 'managed' }>
  meta: ProjectMeta
}

export interface BundleExport {
  transferName: string
  suggestedName: string
}

export interface ProjectRepository {
  create(project: ProjectRef, name: string): Promise<ProjectMeta>
  listManaged(): Promise<ManagedProjectSummary[]>
  exportBundle(project: ProjectRef): Promise<BundleExport>
  importBundle(transferName: string): Promise<ManagedProjectSummary>
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

export const projectRepository: ProjectRepository = {
  async create(project, name) {
    return invoke<ProjectMeta>('create_project', { project, name })
  },

  async listManaged() {
    return invoke<ManagedProjectSummary[]>('list_managed_projects')
  },

  async exportBundle(project) {
    return invoke<BundleExport>('export_project_bundle', { project })
  },

  async importBundle(transferName) {
    return invoke<ManagedProjectSummary>('import_project_bundle', { transferName })
  },

  async load(project) {
    return invoke<LoadedProject>('load_project', { project })
  },

  async save(project, family) {
    await invoke('save_project', { project, familyJson: JSON.stringify(family) })
  },

  async importPhoto(project, bytes, mime) {
    return invoke<{ photoId: string }>('import_photo', {
      project,
      bytes: Array.from(bytes),
      mime,
    })
  },

  async deletePhoto(project, photoId) {
    await invoke('delete_photo', { project, photoId })
  },

  async gcMedia(project, usedIds) {
    return invoke<number>('gc_media', { project, usedIds })
  },

  async resolvePhotoUrl(project, photoId, thumb = false) {
    const bytes = await invoke<number[]>('load_photo', { project, photoId, thumb })
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }))
  },
}
