/**
 * 用 localStorage 保存用户偏好：
 * - 最近打开的项目路径
 * - 其他未来可能加的 UI 偏好
 *
 * 这些数据不跟家族项目走（项目可带走到别的机器，偏好留在本机）。
 */

const LAST_PROJECT_KEY = 'family-tree:lastProjectPath'

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
