import type { Member } from '@/core/schema'

/**
 * 关系边类型。每条边带上"对方的 gender"以便后续判定男女。
 */
export type EdgeKind = 'parent' | 'child' | 'spouse' | 'sibling'

/** 关系子类型，用于区分血亲/继/养/半亲等 */
export type RelType = 'blood' | 'adopted' | 'step' | 'half' | 'married' | 'divorced'

export interface PathStep {
  kind: EdgeKind
  /** 走到的目标成员 id */
  toId: string
  /** 目标成员的性别（方便推算表用） */
  toGender: 'male' | 'female' | 'other'
  /** 关系子类型（血缘/收养/半亲/已婚/离异） */
  relType?: RelType
}

/**
 * 从 fromId BFS 到 toId 的最短关系路径。
 * - 不走环路
 * - 找到即返回，不穷举所有路径
 * - 返回 null 表示不连通
 */
export function findShortestPath(
  fromId: string,
  toId: string,
  members: Record<string, Member>,
  maxDepth = 10,
): PathStep[] | null {
  return findPath(fromId, toId, members, maxDepth, true)
}

/**
 * 只沿亲子/兄弟姐妹边查找路径。
 *
 * 当两人同时存在谱系和姻亲路径时，称谓应优先使用谱系路径，
 * 即使它比经过配偶的路径更长。
 */
export function findShortestLineagePath(
  fromId: string,
  toId: string,
  members: Record<string, Member>,
  maxDepth = 10,
): PathStep[] | null {
  return findPath(fromId, toId, members, maxDepth, false)
}

/**
 * 按称谓语义选择路径：直系/旁系谱系优先，其次是“血亲的配偶”或
 * “配偶的血亲”，最后才使用不受约束的图最短路。
 *
 * 图最短路可能为了少一条边而在不同支系间上下折返，虽然拓扑可达，
 * 却不是人们推导亲属称谓时使用的关系链。
 */
export function findPreferredKinshipPath(
  fromId: string,
  toId: string,
  members: Record<string, Member>,
  maxDepth = 10,
): PathStep[] | null {
  const lineagePath = findShortestLineagePath(fromId, toId, members, maxDepth)
  if (lineagePath) return lineagePath

  const from = members[fromId]
  const target = members[toId]
  if (!from || !target) return null

  const affinityPaths: PathStep[][] = []

  // 目标是某位谱系亲属的配偶。
  for (const spouseRef of target.spouses) {
    const innerPath = findShortestLineagePath(fromId, spouseRef.id, members, maxDepth - 1)
    if (!innerPath || innerPath.length >= maxDepth) continue
    affinityPaths.push([
      ...innerPath,
      { kind: 'spouse', toId, toGender: target.gender, relType: spouseRef.type as RelType },
    ])
  }

  // 目标是本人配偶一侧的谱系亲属。
  for (const spouseRef of from.spouses) {
    const innerPath = findShortestLineagePath(spouseRef.id, toId, members, maxDepth - 1)
    if (!innerPath || innerPath.length >= maxDepth) continue
    const spouse = members[spouseRef.id]
    if (!spouse) continue
    affinityPaths.push([
      { kind: 'spouse', toId: spouse.id, toGender: spouse.gender, relType: spouseRef.type as RelType },
      ...innerPath,
    ])
  }

  affinityPaths.sort((a, b) => a.length - b.length)
  return affinityPaths[0] ?? findShortestPath(fromId, toId, members, maxDepth)
}

function findPath(
  fromId: string,
  toId: string,
  members: Record<string, Member>,
  maxDepth: number,
  includeSpouses: boolean,
): PathStep[] | null {
  if (fromId === toId) return []
  if (!members[fromId] || !members[toId]) return null

  interface QueueItem {
    id: string
    path: PathStep[]
    phase: 'up' | 'down'
  }
  const queue: QueueItem[] = [{ id: fromId, path: [], phase: 'up' }]
  const visited = new Set<string>([`${fromId}:up`])

  while (queue.length > 0) {
    const { id, path, phase } = queue.shift()!
    if (path.length >= maxDepth) continue
    const m = members[id]
    if (!m) continue

    const neighbors: Array<[EdgeKind, string, RelType]> = []
    // sibling 中的 id 集合：这些人不应该通过 child 边到达，
    // 因为 sibling 展开后保留更准确的代际信息
    const siblingIds = new Set(m.siblings.map((s) => s.id))
    if (includeSpouses || phase === 'up') {
      for (const r of m.parents) neighbors.push(['parent', r.id, r.type as RelType])
    }
    for (const r of m.children) {
      if (siblingIds.has(r.id)) continue
      neighbors.push(['child', r.id, r.type as RelType])
    }
    if (includeSpouses) {
      for (const r of m.spouses) neighbors.push(['spouse', r.id, r.type as RelType])
    }
    for (const r of m.siblings) neighbors.push(['sibling', r.id, r.type as RelType])

    for (const [kind, nid, relType] of neighbors) {
      const nextPhase = !includeSpouses && (phase === 'down' || kind === 'child' || kind === 'sibling')
        ? 'down'
        : phase
      const visitKey = includeSpouses ? nid : `${nid}:${nextPhase}`
      if (visited.has(visitKey)) continue
      const target = members[nid]
      if (!target) continue
      const step: PathStep = { kind, toId: nid, toGender: target.gender, relType }
      if (nid === toId) {
        return [...path, step]
      }
      visited.add(visitKey)
      queue.push({ id: nid, path: [...path, step], phase: nextPhase })
    }
  }
  return null
}

/**
 * 把 sibling 边展开为 parent + child（使用"某个父母"作中转）。
 * 这样路径就只有 parent/child/spouse 三种边，便于分类。
 * 若找不到共同父母，就保留原 sibling 边。
 *
 * 展开时保留 relType 信息：
 * - half 类型的 sibling → 展开后在 child 步标记 relType='half'
 * - blood 类型的 sibling → 展开后 child 步标记 relType='blood'
 */
export function normalizePath(
  path: PathStep[],
  members: Record<string, Member>,
  selfId: string,
): PathStep[] {
  const out: PathStep[] = []
  let currentId = selfId
  for (const step of path) {
    if (step.kind !== 'sibling') {
      out.push(step)
      currentId = step.toId
      continue
    }
    // 寻找 currentId 和 step.toId 的共同父母
    const me = members[currentId]
    const sib = members[step.toId]
    if (!me || !sib) {
      out.push(step)
      currentId = step.toId
      continue
    }
    const meParentIds = new Set(me.parents.map((p) => p.id))
    const commonParent = sib.parents.find((p) => meParentIds.has(p.id))
    if (!commonParent) {
      out.push(step)
      currentId = step.toId
      continue
    }
    const parentMember = members[commonParent.id]
    // 展开为 parent(父母) + child(兄弟姐妹)
    out.push({
      kind: 'parent',
      toId: commonParent.id,
      toGender: parentMember?.gender ?? 'other',
      relType: 'blood',
    })
    out.push({
      kind: 'child',
      toId: step.toId,
      toGender: sib.gender,
      relType: step.relType, // 保留 half/blood 信息
    })
    currentId = step.toId
  }
  return out
}
