export interface ExternalProjectRef {
  kind: 'external'
  path: string
}

export interface ManagedProjectRef {
  kind: 'managed'
  id: string
}

export type ProjectRef = ExternalProjectRef | ManagedProjectRef

export function externalProjectRef(path: string): ExternalProjectRef {
  return { kind: 'external', path }
}

export function isProjectRef(value: unknown): value is ProjectRef {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === 'external'
    ? typeof candidate.path === 'string' && candidate.path.length > 0
    : candidate.kind === 'managed'
      && typeof candidate.id === 'string'
      && candidate.id.length > 0
}

export function projectRefLocation(project: ProjectRef): string | null {
  return project.kind === 'external' ? project.path : null
}

export function projectRefName(project: ProjectRef): string {
  if (project.kind === 'managed') return project.id
  const segments = project.path.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? project.path
}
