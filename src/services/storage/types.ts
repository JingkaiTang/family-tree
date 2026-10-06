import type { FamilyData, ProjectMeta } from '@/core/schema'

/** 可持久化的位置引用。id 只由对应提供商解释，不能假定是路径。 */
export interface ProjectRef {
  readonly providerId: string
  readonly id: string
  readonly displayName: string
}

/** 磁盘或远端读入的内容尚未通过项目格式校验。 */
export interface StoredProject {
  id: string
  displayName: string
  meta: unknown
  family: unknown
}

export interface CreatedProject {
  id: string
  displayName: string
  meta: ProjectMeta
}

export interface RenamedProject extends CreatedProject {
  /** The title is durable, but a secondary display name could not be synchronized. */
  warning?: string
}

export function normalizeProjectName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || [...trimmed].length > 100) throw new Error('家族名称须为 1 到 100 个字符')
  return trimmed
}

/**
 * 一个提供商实例绑定一个存储连接（云盘实现还应绑定账号）。
 * 成功保存必须表示内容已持久化，不能仅表示加入内存上传队列。
 * 此接口不承诺跨设备事务、条件写入或自动冲突合并。
 */
export interface ProjectStorageProvider {
  readonly id: string
  /** targetId 是创建位置；返回的 id 才是新项目标识，二者可以不同。 */
  createProject(targetId: string, name: string): Promise<CreatedProject>
  loadProject(projectId: string): Promise<StoredProject>
  saveProject(projectId: string, family: FamilyData): Promise<void>
  renameProject?(projectId: string, name: string): Promise<RenamedProject>
  importPhoto(projectId: string, bytes: Uint8Array, mime: string): Promise<{ photoId: string }>
  /** 返回私有文件内容，不能要求调用者使用公开图片 URL。 */
  readPhoto(projectId: string, photoId: string, thumb: boolean): Promise<Blob>
  deletePhoto(projectId: string, photoId: string): Promise<void>
  /** 仅当实现能够安全判断并回收未引用媒体时提供此能力。 */
  gcMedia?(projectId: string, usedIds: string[]): Promise<number>
}

/** 用户交互与后台 IO 分离；普通读取和自动保存不得自行弹出授权窗口。 */
export interface ProjectPicker {
  readonly providerId: string
  /** create 返回创建位置，open 返回已有项目；取消返回 null。 */
  pickProject(mode: 'create' | 'open'): Promise<{ id: string; displayName: string } | null>
  /** 仅由用户点击触发；恢复已有连接所需授权，不由后台保存调用。 */
  authorizeProject?(projectId: string): Promise<void>
}
