/**
 * 用 localStorage 保存用户偏好：
 * - 最近打开的项目路径
 * - 其他未来可能加的 UI 偏好
 *
 * 这些数据不跟家族项目走（项目可带走到别的机器，偏好留在本机）。
 */

import type { LayoutModePreference } from '@/core/layoutMode'

const LAST_PROJECT_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'

export function getLastProjectPath(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function setLastProjectPath(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(LAST_PROJECT_KEY, path)
    } else {
      localStorage.removeItem(LAST_PROJECT_KEY)
    }
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
