import {
  FamilyData,
  ProjectMeta,
  createEmptyFamily,
} from '@/core/schema'
import { assertFamilyIntegrity } from '@/core/familyIntegrity'
import { validateLoadedProject } from './projectValidation'
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
  return validateLoadedProject(loaded)
}

/** Copy a complete snapshot through the common IO boundary, preserving the source on failure. */
export async function copyProject(
  source: ProjectRef,
  target: ProjectRef,
  snapshot: { meta: ProjectMeta; family: FamilyData },
): Promise<OpenResult> {
  const validated = validateLoadedProject({ ref: source, ...snapshot })
  const family = FamilyData.parse(JSON.parse(JSON.stringify(validated.family)))
  const name = target.displayName || `${validated.meta.name}（副本）`
  const created = await api.createProject(target, name)
  try {
    const ids = new Map<string, string>()
    for (const member of Object.values(family.members)) {
      if (!member.photoId) continue
      let replacement = ids.get(member.photoId)
      if (!replacement) {
        const photo = await api.readPhoto(source, member.photoId, false)
        if (photo.size > 25 * 1024 * 1024) throw new Error('照片超过 25 MiB 限制')
        replacement = (await api.importPhoto(created.ref, new Uint8Array(await photo.arrayBuffer()), photo.type)).photoId
        ids.set(member.photoId, replacement)
      }
      member.photoId = replacement
    }
    await saveProject(created.ref, family)
    return { project: created.ref, meta: created.meta, family }
  } catch (cause) {
    throw new Error(`另存失败，原项目未改变；目标「${name}」可能留有未完成的副本。${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
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
