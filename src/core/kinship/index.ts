import type { FamilyData, Member } from '@/core/schema'
import { findPreferredKinshipPath, normalizePath } from './pathFinder'
import { describeRelation } from './chineseTerms'

/**
 * 从 fromId 的视角看 toId 的中文称呼。
 * 规则：
 * 1. 若 overrides[fromId][toId] 存在 → 直接用
 * 2. 干亲（godparent/godchild）作为独立社会关系，优先于 BFS 直接命中：
 *    - 对方在我的 godparents → 干爹/干妈
 *    - 对方在我的 godchildren → 干儿子/干女儿
 *    不做嵌套链路（"干爹的妈妈"不走干亲再血缘，继续看有没有血缘连通）
 * 3. 否则按“谱系 → 单层姻亲 → 普通最短路”的语义优先级选路，规范化后翻译
 * 4. 找不到路径 → null
 */
export function getKinship(
  fromId: string,
  toId: string,
  members: Record<string, Member>,
  overrides: FamilyData['nicknameOverrides'] = {},
): string | null {
  if (!members[fromId] || !members[toId]) return null
  if (fromId === toId) return '本人'

  const override = overrides?.[fromId]?.[toId]
  if (override) return override

  const me = members[fromId]
  const target = members[toId]
  if (me.godparents.some((r) => r.id === toId)) {
    return target.gender === 'female' ? '干妈' : '干爹'
  }
  if (me.godchildren.some((r) => r.id === toId)) {
    return target.gender === 'female' ? '干女儿' : '干儿子'
  }

  const path = findPreferredKinshipPath(fromId, toId, members)
  if (!path) return null
  const normalized = normalizePath(path, members, fromId)
  return describeRelation(normalized, fromId, toId, members)
}

export * from './pathFinder'
export * from './chineseTerms'
