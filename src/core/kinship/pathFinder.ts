import type { Member } from '@/core/schema'

/**
 * 关系边类型。每条边带上"对方的 gender"以便后续判定男女。
 */
export type EdgeKind = 'parent' | 'child' | 'spouse' | 'sibling'

export interface PathStep {
  kind: EdgeKind
  /** 走到的目标成员 id */
  toId: string
  /** 目标成员的性别（方便推算表用） */
  toGender: 'male' | 'female' | 'other'
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
  if (fromId === toId) return []
  if (!members[fromId] || !members[toId]) return null

  interface QueueItem {
    id: string
    path: PathStep[]
  }
  const queue: QueueItem[] = [{ id: fromId, path: [] }]
  const visited = new Set<string>([fromId])

  while (queue.length > 0) {
    const { id, path } = queue.shift()!
    if (path.length >= maxDepth) continue
    const m = members[id]
    if (!m) continue

    const neighbors: Array<[EdgeKind, string]> = []
    for (const r of m.parents) neighbors.push(['parent', r.id])
    for (const r of m.children) neighbors.push(['child', r.id])
    for (const r of m.spouses) neighbors.push(['spouse', r.id])
    for (const r of m.siblings) neighbors.push(['sibling', r.id])

    for (const [kind, nid] of neighbors) {
      if (visited.has(nid)) continue
      const target = members[nid]
      if (!target) continue
      const step: PathStep = { kind, toId: nid, toGender: target.gender }
      if (nid === toId) {
        return [...path, step]
      }
      visited.add(nid)
      queue.push({ id: nid, path: [...path, step] })
    }
  }
  return null
}

/**
 * 把 sibling 边展开为 parent + child（使用"某个父母"作中转）。
 * 这样路径就只有 parent/child/spouse 三种边，便于分类。
 * 若找不到共同父母，就保留原 sibling 边。
 *
 * 展开时我们不关心具体是父系还是母系，只关心"上一代 + 下一代"组合。
 * 但对中文称呼，父系/母系区别很重要（叔叔 vs 舅舅）→ 下游的 chineseTerms 会处理。
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
    })
    out.push({
      kind: 'child',
      toId: step.toId,
      toGender: sib.gender,
    })
    currentId = step.toId
  }
  return out
}
