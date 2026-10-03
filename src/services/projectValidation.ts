import { FamilyData, ProjectMeta, SCHEMA_VERSION, createEmptyMeta } from '@/core/schema'
import { migrate } from '@/core/migrate'
import { assertFamilyIntegrity } from '@/core/familyIntegrity'
import type { ProjectRef } from './storage/types'
import type { OpenResult } from './projectService'

export function validateLoadedProject(loaded: { ref: ProjectRef; meta: unknown; family: unknown }): OpenResult {
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
