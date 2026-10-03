import type { LayoutModePreference } from '@/core/layoutMode'
import type { ProjectRef } from '@/services/storage/types'
import { hasProvider } from './storage'
import { isProjectRef } from './projectRef'

/**
 * 用户偏好只保存在本机；项目引用仅保存定位字段，不包含连接凭证。
 */
const LAST_PROJECT_REF_KEY = 'family-tree:lastProjectRef'
const PREVIOUS_PROJECT_KEY = 'family-tree:lastProject'
const LEGACY_PROJECT_PATH_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'

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
      // 不恢复已移除或尚未连接的提供商，也不把旧目录路径解释为浏览器句柄。
      if (!project || !hasProvider(project.providerId)) return null
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
