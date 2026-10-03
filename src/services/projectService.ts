import {
  FamilyData,
  ProjectMeta,
  SCHEMA_VERSION,
  createEmptyFamily,
  createEmptyMeta,
} from '@/core/schema'
import { migrate } from '@/core/migrate'
import { assertFamilyIntegrity } from '@/core/familyIntegrity'
import * as api from './storage'
import type { ProjectRef } from './storage'

export interface OpenResult {
  project: ProjectRef
  meta: ProjectMeta
  family: FamilyData
}

/**
 * 在提供商选择的位置创建新项目。返回的位置可能不同于创建目标。
 */
export async function createProject(target: ProjectRef, name: string): Promise<OpenResult> {
  const { ref, meta } = await api.createProject(target, name)
  const family = createEmptyFamily()
  // 初始空数据写盘一次
  await api.saveProject(ref, family)
  return { project: ref, meta, family }
}

/**
 * 打开一个已有项目。会做 schema 迁移 + Zod 校验。
 * 校验失败时抛出带中文说明的错误。
 */
export async function openProject(ref: ProjectRef): Promise<OpenResult> {
  const loaded = await api.loadProject(ref)
  const migrated = migrate(loaded.family)
  const parsed = FamilyData.safeParse(migrated)
  if (!parsed.success) {
    throw new Error(
      '家族数据校验失败：' + parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  assertFamilyIntegrity(parsed.data)

  const parsedMeta = ProjectMeta.safeParse(loaded.meta)
  if (parsedMeta.success && parsedMeta.data.schemaVersion > SCHEMA_VERSION) {
    throw new Error('项目元数据版本过新，当前版本不支持')
  }
  const meta = parsedMeta.success
    ? { ...parsedMeta.data, schemaVersion: parsed.data.schemaVersion }
    : createEmptyMeta(loaded.ref.displayName || '未命名家族')
  return { project: loaded.ref, meta, family: parsed.data }
}

export async function saveProject(ref: ProjectRef, family: FamilyData): Promise<void> {
  const parsed = FamilyData.safeParse(family)
  if (!parsed.success) {
    throw new Error(
      '家族数据校验失败：' + parsed.error.issues.map(issue => issue.message).join('; '),
    )
  }
  assertFamilyIntegrity(parsed.data)
  await api.saveProject(ref, parsed.data)
}
