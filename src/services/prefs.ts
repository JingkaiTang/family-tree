import type { LayoutModePreference } from '@/core/layoutMode'
import type { ProjectRef } from '@/services/storage/types'
import { externalProjectRef, managedProjectRef } from './projectRef'

/**
 * 用户偏好只保存在本机；项目引用仅保存定位字段，不包含连接凭证。
 */
const LAST_PROJECT_REF_KEY = 'family-tree:lastProjectRef'
const PREVIOUS_PROJECT_KEY = 'family-tree:lastProject'
const LEGACY_PROJECT_PATH_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'

function parseProjectRef(value: unknown): ProjectRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  if ('providerId' in value) {
    if (
      typeof value.providerId !== 'string' || !value.providerId.trim()
      || !('id' in value) || typeof value.id !== 'string' || !value.id.trim()
      || !('displayName' in value) || typeof value.displayName !== 'string' || !value.displayName.trim()
    ) return null
    return { providerId: value.providerId, id: value.id, displayName: value.displayName }
  }

  // 移动端支持最初以 kind 区分外部目录和应用托管项目。
  if (
    'kind' in value && value.kind === 'external'
    && 'path' in value && typeof value.path === 'string' && value.path.trim()
  ) return externalProjectRef(value.path)
  if (
    'kind' in value && value.kind === 'managed'
    && 'id' in value && typeof value.id === 'string' && value.id.trim()
  ) return managedProjectRef(value.id)
  return null
}

export function getLastProjectRef(): ProjectRef | null {
  try {
    // 已有的新格式记录即使损坏，也不能回落到另一个陈旧项目。
    for (const key of [LAST_PROJECT_REF_KEY, PREVIOUS_PROJECT_KEY]) {
      const stored = localStorage.getItem(key)
      if (stored === null) continue
      const project = parseProjectRef(JSON.parse(stored))
      if (!project) return null
      setLastProjectRef(project)
      return project
    }

    const path = localStorage.getItem(LEGACY_PROJECT_PATH_KEY)
    if (!path?.trim()) return null
    const project = externalProjectRef(path)
    setLastProjectRef(project)
    return project
  } catch {
    return null
  }
}

export function setLastProjectRef(project: ProjectRef | null): void {
  try {
    if (project) {
      const reference = parseProjectRef(project)
      if (!reference) return
      localStorage.setItem(LAST_PROJECT_REF_KEY, JSON.stringify(reference))
    } else {
      localStorage.removeItem(LAST_PROJECT_REF_KEY)
    }
    // 新记录写入成功后才清理旧键，存储配额错误时仍能重试迁移。
    localStorage.removeItem(PREVIOUS_PROJECT_KEY)
    localStorage.removeItem(LEGACY_PROJECT_PATH_KEY)
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function getLayoutModePreference(): LayoutModePreference {
  try {
    const value = localStorage.getItem(LAYOUT_MODE_KEY)
    if (value === 'family-grid' || value === 'focus-flow') return value
  } catch {
    /* ignore unavailable storage */
  }
  return 'auto'
}

export function setLayoutModePreference(preference: LayoutModePreference): void {
  try {
    if (preference === 'auto') {
      localStorage.removeItem(LAYOUT_MODE_KEY)
    } else {
      localStorage.setItem(LAYOUT_MODE_KEY, preference)
    }
  } catch {
    /* ignore quota / privacy mode */
  }
}
