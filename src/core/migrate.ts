import { type FamilyData, SCHEMA_VERSION } from './schema'

/**
 * 数据迁移器。当前只有一个版本，但预留迁移链路。
 * 输入可能是任意 JSON（旧版本、损坏的数据），尽量兼容性地升级到 SCHEMA_VERSION。
 */
export function migrate(raw: unknown): FamilyData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('家族数据格式无效（根节点不是对象）')
  }
  const data = raw as Record<string, unknown>
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0

  let current = { ...data, schemaVersion: version }

  // 后续版本迁移示例：
  // if ((current.schemaVersion as number) < 2) {
  //   current = migrateV1ToV2(current)
  // }

  current.schemaVersion = SCHEMA_VERSION
  return current as unknown as FamilyData
}
