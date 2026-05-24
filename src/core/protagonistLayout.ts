import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'
import type { ElkNode, ElkEdge, ElkGraph } from './elkLayout'
import { getElk } from './elkLayout'

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5

interface RelationshipInfo {
  distance: number
}

export function groupByDistance(
  distances: Map<string, { distance: number }>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const [id, { distance }] of distances) {
    if (!groups.has(distance)) groups.set(distance, [])
    groups.get(distance)!.push(id)
  }
  return groups
}

export async function layoutLayerWithElk(
  layerMembers: Member[],
  distances: Map<string, { distance: number }>,
): Promise<{ nodes: LaidOutNode[] }> {
  if (layerMembers.length === 0) return { nodes: [] }

  const byId = new Map(layerMembers.map(m => [m.id, m]))

  const couples = buildCouplesForLayer(layerMembers, byId)

  const elkNodes: ElkNode[] = couples.map(c => ({
    id: c.id,
    width: c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W,
    height: NODE_H,
  }))

  const elkGraph: ElkGraph = {
    id: 'layer',
    layoutOptions: {
      'elk.algorithm': 'force',
      'elk.spacing.nodeNode': String(UNIT_GAP),
    },
    children: elkNodes,
    edges: [],
  }

  const elk = await getElk()
  const layouted = await elk.layout(elkGraph)

  const nodes: LaidOutNode[] = []
  const coupleById = new Map(couples.map(c => [c.id, c]))

  for (const elkNode of layouted.children) {
    const couple = coupleById.get(elkNode.id)
    if (!couple) continue

    const elkX = elkNode.x || 0
    const elkY = elkNode.y || 0

    couple.cx = elkX + (couple.memberIds.length === 2 ? NODE_W + COUPLE_GAP / 2 : NODE_W / 2)

    couple.memberIds.forEach((id, idx) => {
      const offset = couple.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0

      nodes.push({
        id,
        cx: elkX + offset + NODE_W / 2,
        top: elkY,
        generation: distances.get(id)?.distance ?? 0,
      })
    })
  }

  return { nodes }
}

function buildCouplesForLayer(
  members: Member[],
  byId: Map<string, Member>,
): Array<{ id: string; memberIds: string[]; cx: number }> {
  const used = new Set<string>()
  const couples: Array<{ id: string; memberIds: string[]; cx: number }> = []

  for (const m of members) {
    if (used.has(m.id)) continue
    const spouse = m.spouses
      .map(s => byId.get(s.id))
      .find(sp => sp && !used.has(sp.id))

    if (spouse) {
      let pair = [m.id, spouse.id]
      if (m.gender === 'female' && spouse.gender === 'male') {
        pair = [spouse.id, m.id]
      }
      used.add(m.id)
      used.add(spouse.id)
      couples.push({
        id: pair.join('|'),
        memberIds: pair,
        cx: 0,
      })
    } else {
      used.add(m.id)
      couples.push({
        id: m.id,
        memberIds: [m.id],
        cx: 0,
      })
    }
  }

  return couples
}

export function calcRelationshipDistances(
  protagonistId: string,
  members: Member[],
): Map<string, RelationshipInfo> {
  const byId = new Map(members.map(m => [m.id, m]))
  const distances = new Map<string, RelationshipInfo>()

  const queue: Array<{ id: string; dist: number }> = [
    { id: protagonistId, dist: 0 },
  ]
  distances.set(protagonistId, { distance: 0 })

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!
    const m = byId.get(id)
    if (!m) continue

    const neighbors = [
      ...m.parents.map(r => r.id),
      ...m.children.map(r => r.id),
      ...m.spouses.map(r => r.id),
      ...m.godparents.map(r => r.id),
      ...m.godchildren.map(r => r.id),
    ]

    for (const nextId of neighbors) {
      if (!byId.has(nextId)) continue
      if (distances.has(nextId)) continue
      distances.set(nextId, { distance: dist + 1 })
      queue.push({ id: nextId, dist: dist + 1 })
    }
  }

  return distances
}

function buildCouples(
  members: Member[],
  byId: Map<string, Member>,
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []

  for (const m of members) {
    if (used.has(m.id)) continue
    const spouse = m.spouses
      .map(s => byId.get(s.id))
      .find(sp => sp && !used.has(sp.id))

    if (spouse) {
      let pair = [m.id, spouse.id]
      if (m.gender === 'female' && spouse.gender === 'male') {
        pair = [spouse.id, m.id]
      }
      used.add(m.id)
      used.add(spouse.id)
      couples.push({
        id: pair.join('|'),
        memberIds: pair,
        generation: 0,
        cx: 0,
      })
    } else {
      used.add(m.id)
      couples.push({
        id: m.id,
        memberIds: [m.id],
        generation: 0,
        cx: 0,
      })
    }
  }

  return couples
}

/**
 * 找到每个 couple 的"锚点"：距离主角最近的那个环上的祖先/亲属
 * 用于让有亲缘关系的节点聚在一起
 */
function findAnchors(
  couples: Couple[],
  protagonistId: string,
  byId: Map<string, Member>,
  distances: Map<string, RelationshipInfo>,
): Map<string, string | null> {
  const anchors = new Map<string, string | null>()
  const coupleOfMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const mid of c.memberIds) coupleOfMember.set(mid, c)
  }

  anchors.set('protagonist', null)

  for (const c of couples) {
    if (c.memberIds.includes(protagonistId)) continue

    // 找距离主角最近的父母/配偶的 couple
    let bestAnchor: string | null = null
    let bestDist = Infinity

    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue

      // 检查父母
      for (const p of m.parents) {
        const pc = coupleOfMember.get(p.id)
        if (pc) {
          const d = distances.get(p.id)?.distance ?? Infinity
          if (d < bestDist) {
            bestDist = d
            bestAnchor = pc.id
          }
        }
      }

      // 检查配偶（如果配偶在更近的环）
      for (const s of m.spouses) {
        const sc = coupleOfMember.get(s.id)
        if (sc && sc.id !== c.id) {
          const d = distances.get(s.id)?.distance ?? Infinity
          if (d < bestDist) {
            bestDist = d
            bestAnchor = sc.id
          }
        }
      }

      // 检查兄弟姐妹
      for (const s of m.siblings) {
        const sc = coupleOfMember.get(s.id)
        if (sc && sc.id !== c.id) {
          const d = distances.get(s.id)?.distance ?? Infinity
          if (d < bestDist) {
            bestDist = d
            bestAnchor = sc.id
          }
        }
      }
    }

    anchors.set(c.id, bestAnchor)
  }

  return anchors
}

/**
 * 环形放射状布局：主角在中心，按关系距离一圈圈环绕
 * 关系近的节点聚在一起
 */
export async function layoutProtagonist(
  members: Member[],
  protagonistId: string,
): Promise<LayoutResult> {
  if (members.length === 0) {
    return {
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
    }
  }

  const byId = new Map(members.map(m => [m.id, m]))
  const distances = calcRelationshipDistances(protagonistId, members)
  const couples = buildCouples(members, byId)
  const anchors = findAnchors(couples, protagonistId, byId, distances)

  // 按关系距离分组
  const rings = new Map<number, Couple[]>()
  for (const c of couples) {
    const dist = Math.min(...c.memberIds.map(id => distances.get(id)?.distance ?? 999))
    if (!rings.has(dist)) rings.set(dist, [])
    rings.get(dist)!.push(c)
  }

  const maxDist = Math.max(...rings.keys())
  const nodes: LaidOutNode[] = []

  // 环形参数 - 紧凑一些
  const BASE_RADIUS = 5
  const RING_GAP = 4

  // 第 0 圈：主角在中心
  const ring0 = rings.get(0) ?? []
  for (const c of ring0) {
    c.cx = 0
    c.generation = 0
    c.memberIds.forEach((id, idx) => {
      const offset = c.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0
      nodes.push({ id, cx: offset, top: 0, generation: 0 })
    })
  }

  // 记录每个 couple 的实际位置（用于锚定下一圈）
  const couplePositions = new Map<string, { cx: number; top: number }>()
  for (const c of ring0) {
    couplePositions.set(c.id, { cx: c.cx, top: 0 })
  }

  // 第 1..N 圈：按锚点聚簇
  for (let dist = 1; dist <= maxDist; dist++) {
    const ringCouples = rings.get(dist)
    if (!ringCouples || ringCouples.length === 0) continue

    const radius = BASE_RADIUS + (dist - 1) * RING_GAP

    // 按锚点分组
    const groups = new Map<string | null, Couple[]>()
    for (const c of ringCouples) {
      const anchor = anchors.get(c.id) ?? null
      // 如果锚点在当前圈或更远，用主角作为锚点
      const anchorDist = anchor ? (distances.get(
        ringCouples.find(rc => rc.id === anchor)?.memberIds[0] ?? ''
      )?.distance ?? dist) : dist
      const effectiveAnchor = (anchor && anchorDist < dist) ? anchor : null

      if (!groups.has(effectiveAnchor)) groups.set(effectiveAnchor, [])
      groups.get(effectiveAnchor)!.push(c)
    }

    // 计算每个锚点的角度位置
    const anchorAngles = new Map<string | null, number>()
    for (const [anchorId] of groups) {
      if (anchorId === null) {
        anchorAngles.set(null, Math.PI / 2) // 默认在底部
      } else {
        const pos = couplePositions.get(anchorId)
        if (pos) {
          anchorAngles.set(anchorId, Math.atan2(pos.top, pos.cx))
        } else {
          anchorAngles.set(null, Math.PI / 2)
        }
      }
    }

    // 按锚点角度排序组
    const sortedGroups = [...groups.entries()].sort((a, b) => {
      const angleA = anchorAngles.get(a[0]) ?? 0
      const angleB = anchorAngles.get(b[0]) ?? 0
      return angleA - angleB
    })

    // 分配角度，每组内的节点紧挨着
    const totalCouples = ringCouples.length
    let currentAngle = -Math.PI / 2 // 从顶部开始

    for (const [anchorId, groupCouples] of sortedGroups) {
      // 每组占据的角度 = 组内节点数 * 每节点角度
      const nodeAngle = 0.3 // 每个节点占据的弧度（紧凑）
      const groupAngle = groupCouples.length * nodeAngle

      // 组内第一个节点的角度 = 当前角度
      for (let i = 0; i < groupCouples.length; i++) {
        const c = groupCouples[i]
        const angle = currentAngle + i * nodeAngle + nodeAngle / 2

        const cx = radius * Math.cos(angle)
        const top = radius * Math.sin(angle)

        c.cx = cx
        c.generation = dist

        c.memberIds.forEach((id, idx) => {
          const offset = c.memberIds.length === 2
            ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
            : 0
          nodes.push({ id, cx: cx + offset, top, generation: dist })
        })

        couplePositions.set(c.id, { cx, top })
      }

      currentAngle += groupAngle + 0.2 // 组间小间隔
    }
  }

  // 计算画布尺寸
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    minY = Math.min(minY, n.top - NODE_H / 2)
    maxY = Math.max(maxY, n.top + NODE_H / 2)
  }

  // 平移到正坐标，主角在画布中心
  const width = maxX - minX + NODE_W * 2
  const height = maxY - minY + NODE_H * 2
  const dx = width / 2
  const dy = height / 2
  for (const n of nodes) {
    n.cx += dx
    n.top += dy
  }
  for (const c of couples) c.cx += dx

  const connectors = buildConnectors(nodes, couples, byId)

  return {
    nodes,
    couples,
    connectors,
    canvas: { width, height },
    orphanIds: [],
    offsetX: dx,
  }
}

/**
 * 简化连线：只连配偶和父母→子女
 */
function buildConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 配偶连线
  for (const c of couples) {
    if (c.memberIds.length === 2) {
      const a = nodeById.get(c.memberIds[0])!
      const b = nodeById.get(c.memberIds[1])!
      lines.push({
        kind: 'spouse',
        points: [
          { x: a.cx, y: a.top },
          { x: b.cx, y: b.top },
        ],
      })
    }
  }

  // 父母→子女连线
  for (const c of couples) {
    const childIds = new Set<string>()
    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue
      for (const ch of m.children) childIds.add(ch.id)
    }
    if (childIds.size === 0) continue

    const parentNodes = c.memberIds.map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]
    const childNodes = [...childIds].map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]

    if (parentNodes.length === 0 || childNodes.length === 0) continue

    const parentX = parentNodes.length === 2
      ? (parentNodes[0].cx + parentNodes[1].cx) / 2
      : parentNodes[0].cx
    const parentY = parentNodes.length === 2
      ? (parentNodes[0].top + parentNodes[1].top) / 2
      : parentNodes[0].top

    for (const cn of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: parentX, y: parentY },
          { x: cn.cx, y: cn.top },
        ],
      })
    }
  }

  return lines
}
