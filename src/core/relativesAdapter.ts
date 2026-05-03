import calcTree from 'relatives-tree'
import type { ExtNode, Connector, Size } from 'relatives-tree/lib/types'
import type { Member } from './schema'

/**
 * `relatives-tree` 的 Node 输入结构（见 node_modules/relatives-tree/lib/types.d.ts）
 * - gender: 'male' | 'female'（不支持 other，other 统一回退为 male 并在 UI 上标记）
 * - parents/children/siblings/spouses: readonly Relation[], { id, type }
 * - type 取值见库内 RelType：blood / married / divorced / adopted / half
 */
export interface RTNode {
  id: string
  gender: 'male' | 'female'
  parents: ReadonlyArray<{ id: string; type: string }>
  children: ReadonlyArray<{ id: string; type: string }>
  siblings: ReadonlyArray<{ id: string; type: string }>
  spouses: ReadonlyArray<{ id: string; type: string }>
}

/**
 * 把 Member 数组转为 relatives-tree 接受的 Node 数组。
 * 单向转换：每次重算都从 Member 重新生成，不做增量。
 *
 * 注意：
 * - 'other' 性别不被库支持，回退为 'male'。UI 层可根据 Member.gender 做覆盖显示。
 * - 库要求关系双向一致（A 在 B.parents 中 → B 必须在 A.children 中）。family store 已保证。
 * - 只保留"成员集合中存在"的关系 id，防止脏引用导致布局崩溃。
 */
export function toRelativesTreeNodes(members: Member[]): RTNode[] {
  const validIds = new Set(members.map((m) => m.id))

  return members.map<RTNode>((m) => ({
    id: m.id,
    gender: m.gender === 'female' ? 'female' : 'male',
    parents: m.parents
      .filter((r) => validIds.has(r.id))
      .map((r) => ({ id: r.id, type: r.type })),
    children: m.children
      .filter((r) => validIds.has(r.id))
      .map((r) => ({ id: r.id, type: r.type })),
    siblings: m.siblings
      .filter((r) => validIds.has(r.id))
      .map((r) => ({ id: r.id, type: r.type })),
    spouses: m.spouses
      .filter((r) => validIds.has(r.id))
      .map((r) => ({ id: r.id, type: r.type })),
  }))
}

/** 单次 calcTree 的安全包装；失败返回 null */
function safeCalc(nodes: RTNode[], rootId: string) {
  try {
    return calcTree(nodes as never, { rootId })
  } catch {
    return null
  }
}

/**
 * 挑选单次 calcTree 能覆盖节点最多的 root。
 * 候选 = 所有无 parents 的成员（家族顶层祖辈）；没有就退化为所有成员。
 * 并列时优先 preferId，否则 id 字典序最小。
 */
export function pickBestRootId(
  members: Member[],
  preferId?: string,
): string | undefined {
  if (members.length === 0) return undefined
  const nodes = toRelativesTreeNodes(members)
  const idSet = new Set(nodes.map((n) => n.id))

  const topLevel = members.filter((m) => m.parents.length === 0).map((m) => m.id)
  const candidates = topLevel.length > 0 ? topLevel : members.map((m) => m.id)

  let bestId: string | undefined
  let bestCount = -1

  for (const id of candidates) {
    if (!idSet.has(id)) continue
    const result = safeCalc(nodes, id)
    const count = result?.nodes.length ?? 0
    if (
      count > bestCount ||
      (count === bestCount && id === preferId) ||
      (count === bestCount && id !== preferId && bestId !== preferId && id < (bestId ?? '~'))
    ) {
      bestCount = count
      bestId = id
    }
  }
  return bestId
}

/** 向后兼容别名 */
export function pickDefaultRootId(members: Member[]): string | undefined {
  return pickBestRootId(members)
}

// ============================================================
// 多棵子树拼接（relatives-tree 不支持多 root + 跨婚姻连通，所以手动分块）
// ============================================================

export interface CombinedTree {
  /** 合并后画布总尺寸（单位：cell） */
  canvas: Size
  /** 所有子树的节点（已平移到全局坐标） */
  nodes: ExtNode[]
  /** 所有子树的连接线（已平移） */
  connectors: Connector[]
  /** 未被任何子树覆盖的成员 id（理论上应为 0） */
  orphanIds: string[]
  /** 每棵子树的 root id（用于调试/统计） */
  rootIds: string[]
}

/**
 * 算多棵子树：
 * 1. 不断挑 "覆盖最多未绘制成员" 的 root 调 calcTree
 * 2. 把结果在画布上水平并列（x 方向偏移），上沿对齐
 * 3. 重复到所有成员被覆盖或候选耗尽
 */
export function calcCombinedTree(
  members: Member[],
  preferRootId?: string,
  gapBetweenForests = 4, // 子树间隔（单位：cell）
): CombinedTree {
  const nodes = toRelativesTreeNodes(members)
  if (nodes.length === 0) {
    return { canvas: { width: 0, height: 0 }, nodes: [], connectors: [], orphanIds: [], rootIds: [] }
  }

  const allIds = new Set(nodes.map((n) => n.id))
  const remaining = new Set(allIds)

  const combinedNodes: ExtNode[] = []
  const combinedConnectors: Connector[] = []
  const rootIds: string[] = []
  let totalWidth = 0
  let maxHeight = 0

  while (remaining.size > 0) {
    // 候选：还未覆盖的成员中，优先"无 parents"的（祖辈更可能覆盖更多）
    const pool = members.filter((m) => remaining.has(m.id))
    const topLevel = pool.filter((m) => m.parents.length === 0)
    const candidates = (topLevel.length > 0 ? topLevel : pool).map((m) => m.id)

    let bestRoot: string | undefined
    let bestResult: ReturnType<typeof calcTree> | null = null
    let bestNewCoverage = -1

    for (const id of candidates) {
      const result = safeCalc(nodes, id)
      if (!result) continue
      const newCoverage = result.nodes.filter((n) => remaining.has(n.id)).length
      const isPreferred = id === preferRootId && preferRootId && remaining.has(preferRootId)
      if (
        newCoverage > bestNewCoverage ||
        (newCoverage === bestNewCoverage && isPreferred) ||
        (newCoverage === bestNewCoverage &&
          !isPreferred &&
          bestRoot !== preferRootId &&
          id < (bestRoot ?? '~'))
      ) {
        bestRoot = id
        bestResult = result
        bestNewCoverage = newCoverage
      }
    }

    if (!bestRoot || !bestResult || bestNewCoverage === 0) break

    // 把这棵子树整体向右平移 totalWidth + gap（第一棵不加 gap）
    const offsetX = totalWidth === 0 ? 0 : totalWidth + gapBetweenForests
    for (const n of bestResult.nodes) {
      if (!remaining.has(n.id)) continue // 已被前一棵子树绘制过，跳过避免重叠
      combinedNodes.push({ ...n, left: n.left + offsetX })
      remaining.delete(n.id)
    }
    for (const [x1, y1, x2, y2] of bestResult.connectors) {
      combinedConnectors.push([x1 + offsetX, y1, x2 + offsetX, y2])
    }

    totalWidth = offsetX + bestResult.canvas.width
    maxHeight = Math.max(maxHeight, bestResult.canvas.height)
    rootIds.push(bestRoot)

    // 只处理偏好 root 一次
    if (preferRootId === bestRoot) preferRootId = undefined
  }

  return {
    canvas: { width: totalWidth, height: maxHeight },
    nodes: combinedNodes,
    connectors: combinedConnectors,
    orphanIds: Array.from(remaining),
    rootIds,
  }
}
