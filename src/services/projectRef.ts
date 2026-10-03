import type { ProjectRef } from './storage/types'
export type { ProjectRef } from './storage/types'

export function externalProjectRef(path: string): ProjectRef {
  const displayName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  return { providerId: 'tauri-local', id: path, displayName }
}

export function managedProjectRef(id: string, displayName = id): ProjectRef {
  return { providerId: 'tauri-managed', id, displayName }
}

export function isProjectRef(value: unknown): value is ProjectRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return 'providerId' in value && typeof value.providerId === 'string' && Boolean(value.providerId.trim())
    && 'id' in value && typeof value.id === 'string' && Boolean(value.id.trim())
    && 'displayName' in value && typeof value.displayName === 'string' && Boolean(value.displayName.trim())
}

export function projectRefLocation(project: ProjectRef): string | null {
  return project.providerId === 'tauri-local' ? project.id : null
}

export function projectRefName(project: ProjectRef): string {
  return project.displayName
}
