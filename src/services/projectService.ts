import { FamilyData, ProjectMeta, createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { migrate } from '@/core/migrate'
import * as api from './tauriApi'

export interface OpenResult {
  path: string
  meta: ProjectMeta
  family: FamilyData
}

/**
 * 在 dirPath 下创建一个新项目。
 * dirPath 应当是"项目根目录"（用户自选，比如 ~/Documents/MyFamily.family）。
 */
export async function createProject(dirPath: string, name: string): Promise<OpenResult> {
  const meta = await api.createProject(dirPath, name)
  const family = createEmptyFamily()
  // 初始空数据写盘一次
  await api.saveProject(dirPath, family)
  return { path: dirPath, meta, family }
}

/**
 * 打开一个已有项目。会做 schema 迁移 + Zod 校验。
 * 校验失败时抛出带中文说明的错误。
 */
export async function openProject(dirPath: string): Promise<OpenResult> {
  const loaded = await api.loadProject(dirPath)
  const migrated = migrate(loaded.family)
  const parsed = FamilyData.safeParse(migrated)
  if (!parsed.success) {
    throw new Error(
      '家族数据校验失败：' + parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const meta = ProjectMeta.safeParse(loaded.meta).success
    ? loaded.meta
    : createEmptyMeta(dirPath.split('/').pop() ?? '未命名家族')
  return { path: loaded.path, meta, family: parsed.data }
}

export async function saveProject(dirPath: string, family: FamilyData): Promise<void> {
  await api.saveProject(dirPath, family)
}
