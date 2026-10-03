import { invoke } from '@tauri-apps/api/core'
import type { ProjectMeta } from '@/core/schema'
import type { ProjectRef } from './projectRef'
import { fromNativeProject, requireNativeStorage, type NativeProjectRef } from './storage/tauri'

export interface ManagedProjectSummary {
  project: ProjectRef
  meta: ProjectMeta
}

/** 原生托管目录扩展；普通项目/媒体 IO 统一经过 storage。 */
export const projectRepository = {
  async listManaged(): Promise<ManagedProjectSummary[]> {
    requireNativeStorage()
    const items = await invoke<Array<{ project: NativeProjectRef; meta: ProjectMeta }>>('list_managed_projects')
    return items.map(item => ({ project: fromNativeProject(item.project, item.meta.name), meta: item.meta }))
  },
}
