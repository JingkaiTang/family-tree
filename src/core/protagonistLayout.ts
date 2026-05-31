import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'
import type { ElkNode, ElkGraph } from './elkLayout'
import { getElk, layoutWithElk } from './elkLayout'

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5
const BASE_RADIUS = 10
const RING_GAP = 8
const MIN_RING_NODE_DISTANCE = 3.5

function radiusForLayer(distance: number, nodeCount: number): number {
  const baseRadius = BASE_RADIUS + Math.max(0, distance - 1) * RING_GAP
  if (nodeCount <= 1) return baseRadius
  const chordRadius = MIN_RING_NODE_DISTANCE / (2 * Math.sin(Math.PI / nodeCount))
  return Math.max(baseRadius, chordRadius)
}

function defaultAngle(index: number, count: number, distance: number): number {
  const angleStep = (2 * Math.PI) / count
  const startAngle = count === 2 && distance % 2 === 1 ? 0 : -Math.PI / 2
  return index * angleStep + startAngle
}

function anglesForLayer(
  layer: LaidOutNode[],
  distance: number,
  radius: number,
  angleHints?: Map<string, number>,
): number[] {
  if (!angleHints || !layer.some(n => angleHints.has(n.id))) {
    return layer.map((_, i) => defaultAngle(i, layer.length, distance))
  }

  const minAngleGap = 2 * Math.asin(Math.min(1, MIN_RING_NODE_DISTANCE / (2 * radius)))
  const maxSectorGap = Math.PI / 7
  const grouped = new Map<string, Array<{ index: number; node: LaidOutNode; baseAngle: number }>>()
  const entries = layer.map((node, index) => {
    const baseAngle = angleHints.get(node.id) ?? defaultAngle(index, layer.length, distance)
    return { index, node, baseAngle }
  })

  for (const entry of entries) {
    const key = entry.baseAngle.toFixed(6)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(entry)
  }

  const angles: number[] = []
  for (const group of grouped.values()) {
    const ordered = [...group].sort((a, b) => a.node.cx - b.node.cx || a.node.id.localeCompare(b.node.id))
    const gap = Math.min(maxSectorGap, minAngleGap)
    ordered.forEach((entry, groupIndex) => {
      const offset = (groupIndex - (ordered.length - 1) / 2) * gap
      angles[entry.index] = entry.baseAngle + offset
    })
  }

  return angles
}

export function calculateRingCoordinates(
  layerNodes: Map<number, LaidOutNode[]>,
  angleHints?: Map<string, number>,
): { nodes: LaidOutNode[] } {
  const nodes: LaidOutNode[] = []

  const sortedLayers = [...layerNodes.entries()].sort(([a], [b]) => a - b)
  for (const [dist, layer] of sortedLayers) {
    if (layer.length === 0) continue

    if (dist === 0) {
      let cxSum = 0, centerYSum = 0
      for (const n of layer) {
        cxSum += n.cx
        centerYSum += n.top + NODE_H / 2
      }
      const cxCenter = cxSum / layer.length
      const centerY = centerYSum / layer.length
      for (const n of layer) {
        nodes.push({
          ...n,
          cx: n.cx - cxCenter,
          top: n.top + NODE_H / 2 - centerY - NODE_H / 2,
        })
      }
      continue
    }

    const radius = radiusForLayer(dist, layer.length)
    const angles = anglesForLayer(layer, dist, radius, angleHints)

    for (let i = 0; i < layer.length; i++) {
      const angle = angles[i]
      nodes.push({
        ...layer[i],
        cx: radius * Math.cos(angle),
        top: radius * Math.sin(angle) - NODE_H / 2,
      })
    }
  }

  return { nodes }
}

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

interface AngleInfo {
  distance: number
  angle: number
  priority: number
}

interface AngleEdge {
  id: string
  cost: number
  angle: number
  priority: number
}

function relationshipAngleEdges(m: Member): AngleEdge[] {
  return [
    ...m.spouses.map(r => ({ id: r.id, cost: 1, angle: 0, priority: 0 })),
    ...m.parents.map(r => ({ id: r.id, cost: 1, angle: -Math.PI / 2, priority: 1 })),
    ...m.children.map(r => ({ id: r.id, cost: 1, angle: Math.PI / 2, priority: 1 })),
    ...m.godparents.map(r => ({ id: r.id, cost: 1, angle: -Math.PI / 2, priority: 2 })),
    ...m.godchildren.map(r => ({ id: r.id, cost: 1, angle: Math.PI / 2, priority: 2 })),
    ...m.siblings.map(r => ({ id: r.id, cost: 2, angle: Math.PI, priority: 3 })),
  ]
}

function buildRelationAngleHints(
  protagonistId: string,
  members: Member[],
): Map<string, number> {
  const byId = new Map(members.map(m => [m.id, m]))
  const info = new Map<string, AngleInfo>()
  if (!byId.has(protagonistId)) return new Map()

  const queue: Array<{ id: string; distance: number; angle: number; priority: number }> = [
    { id: protagonistId, distance: 0, angle: 0, priority: 0 },
  ]
  info.set(protagonistId, { distance: 0, angle: 0, priority: 0 })

  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance || a.priority - b.priority)
    const current = queue.shift()!
    const knownCurrent = info.get(current.id)
    if (!knownCurrent) continue
    if (
      knownCurrent.distance < current.distance ||
      (knownCurrent.distance === current.distance && knownCurrent.priority < current.priority)
    ) {
      continue
    }

    const m = byId.get(current.id)
    if (!m) continue

    for (const edge of relationshipAngleEdges(m)) {
      if (!byId.has(edge.id)) continue
      const nextDistance = current.distance + edge.cost
      const nextPriority = current.id === protagonistId
        ? edge.priority
        : current.priority + 10 + edge.priority
      const nextAngle = current.id === protagonistId ? edge.angle : current.angle
      const known = info.get(edge.id)
      if (
        known &&
        (known.distance < nextDistance ||
          (known.distance === nextDistance && known.priority <= nextPriority))
      ) {
        continue
      }
      info.set(edge.id, {
        distance: nextDistance,
        angle: nextAngle,
        priority: nextPriority,
      })
      queue.push({
        id: edge.id,
        distance: nextDistance,
        angle: nextAngle,
        priority: nextPriority,
      })
    }
  }

  const angles = new Map<string, number>()
  for (const [id, item] of info) {
    if (id !== protagonistId) angles.set(id, item.angle)
  }
  return angles
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

function syncCoupleCenters(couples: Couple[], nodes: LaidOutNode[]) {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  for (const c of couples) {
    const memberNodes = c.memberIds
      .map(id => nodeById.get(id))
      .filter(Boolean) as LaidOutNode[]
    if (memberNodes.length === 0) continue
    c.cx = memberNodes.reduce((sum, n) => sum + n.cx, 0) / memberNodes.length
  }
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
  const angleHints = buildRelationAngleHints(protagonistId, members)

  const layerNodes = new Map<number, LaidOutNode[]>()
  for (const [dist, ids] of layerGroups) {
    const layerMembers = ids.map(id => byId.get(id)).filter(Boolean) as Member[]
    const { nodes } = await layoutLayerWithElk(layerMembers, distances)
    layerNodes.set(dist, nodes)
  }

  const { nodes } = calculateRingCoordinates(layerNodes, angleHints)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    minY = Math.min(minY, n.top)
    maxY = Math.max(maxY, n.top + NODE_H)
  }

  const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX)) + NODE_W
  const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY)) + NODE_H
  const width = halfWidth * 2
  const height = halfHeight * 2
  const dx = halfWidth
  const dy = halfHeight
  for (const n of nodes) {
    n.cx += dx
    n.top += dy
  }

  const couples = buildCouples(members, byId)
  syncCoupleCenters(couples, nodes)
  const connectors = buildProtagonistConnectors(nodes, couples, byId)

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
            { x: a.cx, y: a.top + NODE_H / 2 },
            { x: b.cx, y: b.top + NODE_H / 2 },
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

    for (const childId of childIds) {
      const childNode = nodeById.get(childId)
      const child = byId.get(childId)
      if (!childNode || !child) continue

      const parentNodes = c.memberIds
        .filter(parentId => {
          const parent = byId.get(parentId)
          return parent?.children.some(ch => ch.id === childId) ||
            child.parents.some(p => p.id === parentId)
        })
        .map(id => nodeById.get(id))
        .filter(Boolean) as LaidOutNode[]

      if (parentNodes.length === 0) continue

      const parentX = parentNodes.reduce((sum, n) => sum + n.cx, 0) / parentNodes.length
      const parentCenterY = parentNodes.reduce((sum, n) => sum + n.top + NODE_H / 2, 0) / parentNodes.length
      const childCenterY = childNode.top + NODE_H / 2
      const childBelowParents = childCenterY >= parentCenterY
      const parentY = childBelowParents
        ? Math.max(...parentNodes.map(n => n.top + NODE_H))
        : Math.min(...parentNodes.map(n => n.top))
      const childY = childBelowParents ? childNode.top : childNode.top + NODE_H
      const midY = (parentY + childY) / 2

      lines.push({
        kind: 'parent-child',
        points: [
          { x: parentX, y: parentY },
          { x: parentX, y: midY },
        ],
      })
      if (Math.abs(parentX - childNode.cx) > 0.1) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: Math.min(parentX, childNode.cx), y: midY },
            { x: Math.max(parentX, childNode.cx), y: midY },
          ],
        })
      }
      lines.push({
        kind: 'parent-child',
        points: [
          { x: childNode.cx, y: midY },
          { x: childNode.cx, y: childY },
        ],
      })
    }
  }

  const emittedGod = new Set<string>()
  for (const n of nodes) {
    const m = byId.get(n.id)
    if (!m) continue
    for (const gc of m.godchildren) {
      const key = `${n.id}>${gc.id}`
      if (emittedGod.has(key)) continue
      emittedGod.add(key)
      const target = nodeById.get(gc.id)
      if (!target) continue
      lines.push({
        kind: 'godparent',
        points: [
          { x: n.cx, y: n.top + NODE_H },
          { x: target.cx, y: target.top },
        ],
      })
    }
  }

  return lines
}
