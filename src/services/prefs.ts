import type { LayoutModePreference } from '@/core/layoutMode'
import type { ProjectRef } from '@/services/storage/types'
import { hasProvider } from './storage'
import { isProjectRef } from './projectRef'
import { isGoogleDriveProvider } from './googleDriveConnection'

/**
 * 用户偏好只保存在本机；项目引用仅保存定位字段，不包含连接凭证。
 */
const LAST_PROJECT_REF_KEY = 'family-tree:lastProjectRef'
const PREVIOUS_PROJECT_KEY = 'family-tree:lastProject'
const LEGACY_PROJECT_PATH_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'

function viewpointKey(project: ProjectRef): string {
  return `family-tree:viewpoint:${JSON.stringify([project.providerId, project.id])}`
}

/** undefined means no local preference; null explicitly clears the project default. */
export function getProjectViewpoint(project: ProjectRef): string | null | undefined {
  try {
    const raw = localStorage.getItem(viewpointKey(project))
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value === 'string') return value
  } catch { /* Preferences are optional. */ }
  return undefined
}

export function setProjectViewpoint(project: ProjectRef, memberId: string | null): void {
  try { localStorage.setItem(viewpointKey(project), JSON.stringify(memberId)) }
  catch { /* Keep the current page's browsing state when storage is unavailable. */ }
}

function parseProjectRef(value: unknown): ProjectRef | null {
  if (!isProjectRef(value)) return null
  return { providerId: value.providerId, id: value.id, displayName: value.displayName }
}

export function getLastProjectRef(): ProjectRef | null {
  try {
    // 已有的新格式记录即使损坏，也不能回落到另一个陈旧项目。
    for (const key of [LAST_PROJECT_REF_KEY, PREVIOUS_PROJECT_KEY]) {
      const stored = localStorage.getItem(key)
      if (stored === null) continue
      const project = parseProjectRef(JSON.parse(stored))
      // Drive references survive reload, but restoration still requires an explicit account connection.
      if (!project || (!hasProvider(project.providerId) && !isGoogleDriveProvider(project.providerId))) return null
      setLastProjectRef(project)
      return project
    }

    return null
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
