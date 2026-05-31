import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'
import type { ElkNode, ElkEdge, ElkGraph } from './elkLayout'
import { getElk, layoutWithElk } from './elkLayout'

export function calculateRingCoordinates(
  layerNodes: Map<number, LaidOutNode[]>,
): { nodes: LaidOutNode[] } {
  const BASE_RADIUS = 10
  const RING_GAP = 8
  const nodes: LaidOutNode[] = []

  const sortedLayers = [...layerNodes.entries()].sort(([a], [b]) => a - b)
  for (const [dist, layer] of sortedLayers) {
    if (layer.length === 0) continue

    if (dist === 0) {
      let cxSum = 0, topSum = 0
      for (const n of layer) { cxSum += n.cx; topSum += n.top }
      const cxCenter = cxSum / layer.length
      const topCenter = topSum / layer.length
      for (const n of layer) {
        nodes.push({ ...n, cx: n.cx - cxCenter, top: n.top - topCenter })
      }
      continue
    }

    const radius = BASE_RADIUS + (dist - 1) * RING_GAP
    const angleStep = (2 * Math.PI) / layer.length
    const startAngle = layer.length === 2 && dist % 2 === 1 ? 0 : -Math.PI / 2

    for (let i = 0; i < layer.length; i++) {
      const angle = i * angleStep + startAngle
      nodes.push({
        ...layer[i],
        cx: radius * Math.cos(angle),
        top: radius * Math.sin(angle),
      })
    }
  }

  return { nodes }
}

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5

function coupleWidth(memberCount: number): number {
  return memberCount * NODE_W + Math.max(0, memberCount - 1) * COUPLE_GAP
}

function memberCenterX(coupleLeft: number, memberIndex: number): number {
  return coupleLeft + NODE_W / 2 + memberIndex * (NODE_W + COUPLE_GAP)
}

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
    width: coupleWidth(c.memberIds.length),
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

    couple.cx = elkX + coupleWidth(couple.memberIds.length) / 2

    couple.memberIds.forEach((id, idx) => {
      nodes.push({
        id,
        cx: memberCenterX(elkX, idx),
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
  if (!byId.has(protagonistId)) return distances

  const queue: Array<{ id: string; dist: number }> = [
    { id: protagonistId, dist: 0 },
  ]
  distances.set(protagonistId, { distance: 0 })

  while (queue.length > 0) {
    queue.sort((a, b) => a.dist - b.dist)
    const { id, dist } = queue.shift()!
    if ((distances.get(id)?.distance ?? Infinity) < dist) continue
    const m = byId.get(id)
    if (!m) continue

    const neighbors: Array<{ id: string; cost: number }> = [
      ...m.parents.map(r => ({ id: r.id, cost: 1 })),
      ...m.children.map(r => ({ id: r.id, cost: 1 })),
      ...m.spouses.map(r => ({ id: r.id, cost: 1 })),
      ...m.godparents.map(r => ({ id: r.id, cost: 1 })),
      ...m.godchildren.map(r => ({ id: r.id, cost: 1 })),
      // 兄弟姐妹没有父母节点时也要可达；语义上仍按两步关系计算。
      ...m.siblings.map(r => ({ id: r.id, cost: 2 })),
    ]

    for (const { id: nextId, cost } of neighbors) {
      if (!byId.has(nextId)) continue
      const nextDist = dist + cost
      const known = distances.get(nextId)
      if (known && known.distance <= nextDist) continue
      distances.set(nextId, { distance: nextDist })
      queue.push({ id: nextId, dist: nextDist })
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
  if (!byId.has(protagonistId)) {
    return layoutWithElk(members)
  }

  const distances = calcRelationshipDistances(protagonistId, members)
  const orphanIds = members
    .filter(m => !distances.has(m.id))
    .map(m => m.id)

  if (orphanIds.length > 0) {
    const maxDistance = Math.max(...[...distances.values()].map(info => info.distance), 0)
    for (const id of orphanIds) {
      distances.set(id, { distance: maxDistance + 1 })
    }
  }

  const layerGroups = groupByDistance(distances)

  const layerNodes = new Map<number, LaidOutNode[]>()
  for (const [dist, ids] of layerGroups) {
    const layerMembers = ids.map(id => byId.get(id)).filter(Boolean) as Member[]
    const { nodes } = await layoutLayerWithElk(layerMembers, distances)
    layerNodes.set(dist, nodes)
  }

  const { nodes } = calculateRingCoordinates(layerNodes)

  const couples = buildCouples(members, byId)
  const connectors = buildProtagonistConnectors(nodes, couples, byId)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    minY = Math.min(minY, n.top - NODE_H / 2)
    maxY = Math.max(maxY, n.top + NODE_H / 2)
  }

  const width = maxX - minX + NODE_W * 2
  const height = maxY - minY + NODE_H * 2
  const dx = width / 2
  const dy = height / 2
  for (const n of nodes) {
    n.cx += dx
    n.top += dy
  }
  for (const c of couples) c.cx += dx

  return {
    nodes,
    couples,
    connectors,
    canvas: { width, height },
    orphanIds,
    offsetX: dx,
  }
}

export function buildProtagonistConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
): LayoutConnector[] {
  return buildConnectors(nodes, couples, byId)
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
      const a = nodeById.get(c.memberIds[0])
      const b = nodeById.get(c.memberIds[1])
      if (a && b) {
        lines.push({
          kind: 'spouse',
          points: [
            { x: a.cx, y: a.top },
            { x: b.cx, y: b.top },
          ],
        })
      }
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
