import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const ROW_HEIGHT = 7

interface RelationshipInfo {
  distance: number
  path: string[]
}

function calcRelationshipDistances(
  protagonistId: string,
  members: Member[],
): Map<string, RelationshipInfo> {
  const byId = new Map(members.map(m => [m.id, m]))
  const distances = new Map<string, RelationshipInfo>()

  const queue: Array<{ id: string; dist: number; path: string[] }> = [
    { id: protagonistId, dist: 0, path: [protagonistId] },
  ]
  distances.set(protagonistId, { distance: 0, path: [protagonistId] })

  while (queue.length > 0) {
    const { id, dist, path } = queue.shift()!
    const m = byId.get(id)
    if (!m) continue

    const neighbors = [
      ...m.parents.map(r => r.id),
      ...m.children.map(r => r.id),
      ...m.spouses.map(r => r.id),
      ...m.siblings.map(r => r.id),
      ...m.godparents.map(r => r.id),
      ...m.godchildren.map(r => r.id),
    ]

    for (const nextId of neighbors) {
      if (!byId.has(nextId)) continue
      if (distances.has(nextId)) continue

      const newPath = [...path, nextId]
      distances.set(nextId, { distance: dist + 1, path: newPath })
      queue.push({ id: nextId, dist: dist + 1, path: newPath })
    }
  }

  return distances
}

function assignGenerations(
  members: Member[],
  byId: Map<string, Member>,
  protagonistId: string,
): Map<string, number> {
  const gen = new Map<string, number>()

  const bfs = (startId: string, startGen: number) => {
    const queue: string[] = [startId]
    gen.set(startId, startGen)
    while (queue.length > 0) {
      const id = queue.shift()!
      const g = gen.get(id)!
      const m = byId.get(id)
      if (!m) continue
      const push = (otherId: string, otherGen: number) => {
        if (!byId.has(otherId)) return
        if (gen.has(otherId)) return
        gen.set(otherId, otherGen)
        queue.push(otherId)
      }
      // Forward edges
      for (const p of m.parents) push(p.id, g - 1)
      for (const c of m.children) push(c.id, g + 1)
      for (const s of m.spouses) push(s.id, g)
      for (const s of m.siblings) push(s.id, g)
      for (const p of m.godparents) push(p.id, g - 1)
      for (const c of m.godchildren) push(c.id, g + 1)
      // Reverse edges (for incomplete data)
      for (const other of members) {
        if (other.id === id) continue
        if (other.children.some(c => c.id === id)) push(other.id, g - 1)
        if (other.parents.some(p => p.id === id)) push(other.id, g + 1)
        if (other.spouses.some(s => s.id === id)) push(other.id, g)
        if (other.siblings.some(s => s.id === id)) push(other.id, g)
        if (other.godchildren.some(gc => gc.id === id)) push(other.id, g - 1)
        if (other.godparents.some(gp => gp.id === id)) push(other.id, g + 1)
      }
    }
  }

  if (byId.has(protagonistId)) {
    bfs(protagonistId, 0)
  } else {
    const protagonist = members.find(m => !gen.has(m.id))
    if (protagonist) bfs(protagonist.id, 0)
  }

  return gen
}

function buildCouples(
  members: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>,
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []
  const gens = new Map<number, Member[]>()

  for (const m of members) {
    const g = gen.get(m.id) ?? 0
    if (!gens.has(g)) gens.set(g, [])
    gens.get(g)!.push(m)
  }

  for (const [g, membersInGen] of gens) {
    for (const m of membersInGen) {
      if (used.has(m.id)) continue
      const spouseInGen = m.spouses
        .map(s => byId.get(s.id))
        .find(sp => sp && !used.has(sp.id) && gen.get(sp.id) === g)

      if (spouseInGen) {
        let pair = [m.id, spouseInGen.id]
        if (m.gender === 'female' && spouseInGen.gender === 'male') {
          pair = [spouseInGen.id, m.id]
        }
        used.add(m.id)
        used.add(spouseInGen.id)
        couples.push({
          id: pair.join('|'),
          memberIds: pair,
          generation: g,
          cx: 0,
        })
      } else {
        used.add(m.id)
        couples.push({
          id: m.id,
          memberIds: [m.id],
          generation: g,
          cx: 0,
        })
      }
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

  const distances = calcRelationshipDistances(protagonistId, members)

  const gen = assignGenerations(members, byId, protagonistId)
  const minGen = Math.min(...gen.values())

  const couples = buildCouples(members, byId, gen)
  const coupleOfMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const mid of c.memberIds) {
      coupleOfMember.set(mid, c)
    }
  }

  // Sort couples by relationship distance (closest first)
  couples.sort((a, b) => {
    const aIsProtagonist = a.memberIds.includes(protagonistId)
    const bIsProtagonist = b.memberIds.includes(protagonistId)
    if (aIsProtagonist) return -1
    if (bIsProtagonist) return 1

    const aDist = Math.min(...a.memberIds.map(id => distances.get(id)?.distance ?? Infinity))
    const bDist = Math.min(...b.memberIds.map(id => distances.get(id)?.distance ?? Infinity))

    return aDist - bDist
  })

  // Place couples alternating left and right of protagonist
  const nodes: LaidOutNode[] = []
  const protagonistCouple = couples.find(c => c.memberIds.includes(protagonistId))
  const otherCouples = couples.filter(c => !c.memberIds.includes(protagonistId))

  // Place protagonist at center
  if (protagonistCouple) {
    const w = protagonistCouple.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W
    protagonistCouple.cx = 0

    protagonistCouple.memberIds.forEach((id, idx) => {
      const offset = protagonistCouple.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0

      nodes.push({
        id,
        cx: protagonistCouple.cx + offset,
        top: (protagonistCouple.generation - minGen) * ROW_HEIGHT,
        generation: protagonistCouple.generation,
      })
    })
  }

  // Place other couples alternating left and right
  let leftX = -(NODE_W + 1.5)
  let rightX = NODE_W + 1.5
  let useLeft = true

  for (const c of otherCouples) {
    const w = c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W

    if (useLeft) {
      c.cx = leftX - w / 2
      leftX = c.cx - w / 2 - 1.5
    } else {
      c.cx = rightX + w / 2
      rightX = c.cx + w / 2 + 1.5
    }

    c.memberIds.forEach((id, idx) => {
      const offset = c.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0

      nodes.push({
        id,
        cx: c.cx + offset,
        top: (c.generation - minGen) * ROW_HEIGHT,
        generation: c.generation,
      })
    })

    useLeft = !useLeft
  }

  // Calculate canvas bounds and normalize
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }

  const offsetX = -minX
  for (const n of nodes) n.cx += offsetX
  for (const c of couples) c.cx += offsetX

  // Now center protagonist at canvas midpoint
  const canvasMidX = (maxX - minX) / 2
  const protagonistNode = nodes.find(n => n.id === protagonistId)
  if (protagonistNode) {
    const dx = canvasMidX - protagonistNode.cx
    for (const n of nodes) n.cx += dx
    for (const c of couples) c.cx += dx
  }

  // Recalculate bounds after centering
  minX = Infinity
  maxX = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
  }

  const connectors = buildConnectors(nodes, couples, byId)

  return {
    nodes,
    couples,
    connectors,
    canvas: { width: maxX - minX, height: maxY },
    orphanIds: [],
    offsetX: offsetX,
  }
}

function buildConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  for (const c of couples) {
    if (c.memberIds.length === 2) {
      const a = nodeById.get(c.memberIds[0])!
      const b = nodeById.get(c.memberIds[1])!
      const y = a.top + NODE_H / 2
      lines.push({
        kind: 'spouse',
        points: [
          { x: a.cx, y },
          { x: b.cx, y },
        ],
      })
    }
  }

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

    const parentY = parentNodes[0].top + NODE_H
    const parentX = parentNodes.length === 2
      ? (parentNodes[0].cx + parentNodes[1].cx) / 2
      : parentNodes[0].cx
    const childTop = childNodes[0].top
    const midY = (parentY + childTop) / 2

    lines.push({
      kind: 'parent-child',
      points: [
        { x: parentX, y: parentY },
        { x: parentX, y: midY },
      ],
    })

    const childXs = childNodes.map(n => n.cx)
    const childMin = Math.min(...childXs)
    const childMax = Math.max(...childXs)

    if (childNodes.length >= 2) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: childMin, y: midY },
          { x: childMax, y: midY },
        ],
      })
    }

    for (const cn of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: cn.cx, y: midY },
          { x: cn.cx, y: cn.top },
        ],
      })
    }
  }

  return lines
}
