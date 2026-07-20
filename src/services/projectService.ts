import {
  FamilyData,
  ProjectMeta,
  SCHEMA_VERSION,
  createEmptyFamily,
  createEmptyMeta,
} from '@/core/schema'
import { migrate } from '@/core/migrate'
import { assertFamilyIntegrity } from '@/core/familyIntegrity'
import { projectRepository } from './projectRepository'
import { projectRefName, type ProjectRef } from './projectRef'

export interface OpenResult {
  project: ProjectRef
  meta: ProjectMeta
  family: FamilyData
}

/**
 * 通过统一项目引用创建项目。桌面端引用外部目录，移动端使用托管项目 ID。
 */
export async function createProject(project: ProjectRef, name: string): Promise<OpenResult> {
  const meta = await projectRepository.create(project, name)
  const family = createEmptyFamily()
  // 初始空数据写盘一次
  await projectRepository.save(project, family)
  return { project, meta, family }
}

/**
 * 打开一个已有项目。会做 schema 迁移 + Zod 校验。
 * 校验失败时抛出带中文说明的错误。
 */
export async function openProject(project: ProjectRef): Promise<OpenResult> {
  const loaded = await projectRepository.load(project)
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
    : createEmptyMeta(projectRefName(project) || '未命名家族')
  return { project: loaded.project, meta, family: parsed.data }
}

export async function saveProject(project: ProjectRef, family: FamilyData): Promise<void> {
  const parsed = FamilyData.safeParse(family)
  if (!parsed.success) {
    throw new Error(
      '家族数据校验失败：' + parsed.error.issues.map(issue => issue.message).join('; '),
    )
  }
  assertFamilyIntegrity(parsed.data)
  await projectRepository.save(project, parsed.data)
}
