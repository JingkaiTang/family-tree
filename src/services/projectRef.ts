import type { ProjectRef } from './storage/types'
export type { ProjectRef } from './storage/types'

export function isProjectRef(value: unknown): value is ProjectRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return 'providerId' in value && typeof value.providerId === 'string' && Boolean(value.providerId.trim())
    && 'id' in value && typeof value.id === 'string' && Boolean(value.id.trim())
    && 'displayName' in value && typeof value.displayName === 'string' && Boolean(value.displayName.trim())
}
