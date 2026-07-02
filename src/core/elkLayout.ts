import type { Member } from './schema'

export interface LaidOutNode {
  id: string
  cx: number
  top: number
  generation: number
}

export interface Couple {
  id: string
  memberIds: string[]
  generation: number
  cx: number
}

export interface LayoutConnector {
  points: Array<{ x: number; y: number }>
  kind: 'parent-child' | 'spouse' | 'godparent'
}

export interface GridLayoutMetadata {
  memberSlotIds: Record<string, string>
  slotPositions: Record<string, { generation: number; order: number; cx: number }>
  columnWidth: number
}

export interface LayoutResult {
  nodes: LaidOutNode[]
  couples: Couple[]
  connectors: LayoutConnector[]
  canvas: { width: number; height: number }
  orphanIds: string[]
  offsetX: number
  grid?: GridLayoutMetadata
}

let ELK: any = null

export async function getElk() {
  if (!ELK) {
    const elkModule = await import('elkjs')
    ELK = elkModule.default
  }
  return new ELK()
}

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5
const ROW_GAP = 3
const ROW_HEIGHT = NODE_H + ROW_GAP

function coupleWidth(memberCount: number): number {
  return memberCount * NODE_W + Math.max(0, memberCount - 1) * COUPLE_GAP
}

function memberCenterX(coupleLeft: number, memberIndex: number): number {
  return coupleLeft + NODE_W / 2 + memberIndex * (NODE_W + COUPLE_GAP)
}

export interface ElkNode {
  id: string
  width: number
  height: number
  x?: number
  y?: number
}

export interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
}

export interface ElkGraph {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}

export async function layoutWithElk(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
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

  const gen = assignGenerations(members, byId)

  const { elkGraph, couples, coupleOfMember } = buildElkGraph(members, byId, gen)

  const elk = await getElk()
  const layouted = await elk.layout(elkGraph)

  const result = convertElkResult(layouted, couples, coupleOfMember, gen, members)

  compressCoupleRows(result.nodes, couples)
  alignOnlyChildren(result.nodes, couples, byId, opts?.manualPositions)
  compactChildGroups(result.nodes, couples, byId)
  repackCoupleRows(result.nodes, couples)

  if (opts?.manualPositions) {
    for (const n of result.nodes) {
      const m = opts.manualPositions[n.id]
      if (m) {
        n.cx = m.cx
        n.top = m.top
      }
    }
  }

  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of result.nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }
  const dx = -minX
  for (const n of result.nodes) n.cx += dx
  for (const c of result.couples) c.cx += dx
  result.offsetX = dx
  result.canvas = { width: maxX - minX, height: maxY }

  result.connectors = buildConnectors(result.nodes, couples, byId)

  return result
}

function compressCoupleRows(nodes: LaidOutNode[], couples: Couple[]) {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const byGeneration = new Map<number, Couple[]>()
  for (const c of couples) {
    if (!byGeneration.has(c.generation)) byGeneration.set(c.generation, [])
    byGeneration.get(c.generation)!.push(c)
  }

  for (const row of byGeneration.values()) {
    const ordered = [...row].sort((a, b) => a.cx - b.cx)
    let left = 0
    for (const c of ordered) {
      setCoupleLeft(c, left, nodeById)
      left += coupleWidth(c.memberIds.length) + UNIT_GAP
    }
  }
}

function setCoupleLeft(
  c: Couple,
  left: number,
  nodeById: Map<string, LaidOutNode>,
) {
  c.cx = left + coupleWidth(c.memberIds.length) / 2
  c.memberIds.forEach((id, idx) => {
    const n = nodeById.get(id)
    if (n) n.cx = memberCenterX(left, idx)
  })
}

function compactChildGroups(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
) {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const coupleByMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const id of c.memberIds) coupleByMember.set(id, c)
  }

  const generations = [...new Set(couples.map(c => c.generation))].sort((a, b) => a - b)
  for (const generation of generations.slice(1)) {
    const rowCouples = couples.filter(c => c.generation === generation)
    const assigned = new Set<string>()
    const groups: Array<{
      anchorX: number
      children: Array<{ couple: Couple; childId?: string }>
    }> = []

    const parentCouples = couples
      .filter(c => c.generation < generation)
      .sort((a, b) => a.cx - b.cx)

    for (const parentCouple of parentCouples) {
      const childCouples: Array<{ couple: Couple; childId: string }> = []
      for (const mid of parentCouple.memberIds) {
        const member = byId.get(mid)
        if (!member) continue
        for (const child of member.children) {
          const childCouple = coupleByMember.get(child.id)
          if (!childCouple || childCouple.generation !== generation) continue
          if (assigned.has(childCouple.id)) continue
          assigned.add(childCouple.id)
          childCouples.push({ couple: childCouple, childId: child.id })
        }
      }
      if (childCouples.length > 0) {
        groups.push({
          anchorX: parentCouple.cx,
          children: childCouples.sort((a, b) => a.couple.cx - b.couple.cx),
        })
      }
    }

    for (const c of rowCouples.sort((a, b) => a.cx - b.cx)) {
      if (assigned.has(c.id)) continue
      groups.push({ anchorX: c.cx, children: [{ couple: c }] })
    }

    const boundsForGroup = (group: { children: Array<{ couple: Couple }> }) => {
      const memberNodes = group.children.flatMap(({ couple }) =>
        couple.memberIds.map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]
      )
      const left = Math.min(...memberNodes.map(n => n.cx - NODE_W / 2))
      const right = Math.max(...memberNodes.map(n => n.cx + NODE_W / 2))
      return { memberNodes, left, right }
    }

    for (const group of groups) {
      if (group.children.length === 1 && group.children[0].childId) {
        const { couple, childId } = group.children[0]
        const childIndex = Math.max(0, couple.memberIds.indexOf(childId))
        const childOffset = NODE_W / 2 + childIndex * (NODE_W + COUPLE_GAP)
        setCoupleLeft(couple, group.anchorX - childOffset, nodeById)
        continue
      }

      const totalWidth = group.children.reduce(
        (sum, { couple }) => sum + coupleWidth(couple.memberIds.length),
        0,
      ) + Math.max(0, group.children.length - 1) * UNIT_GAP
      let left = group.anchorX - totalWidth / 2
      for (const { couple } of group.children) {
        setCoupleLeft(couple, left, nodeById)
        left += coupleWidth(couple.memberIds.length) + UNIT_GAP
      }
    }

    const orderedGroups = groups.sort((a, b) => boundsForGroup(a).left - boundsForGroup(b).left)
    let cursor: number | null = null
    for (const group of orderedGroups) {
      const bounds = boundsForGroup(group)
      if (cursor !== null && bounds.left < cursor + UNIT_GAP) {
        const delta = cursor + UNIT_GAP - bounds.left
        for (const n of bounds.memberNodes) n.cx += delta
        for (const { couple } of group.children) couple.cx += delta
        bounds.left += delta
        bounds.right += delta
      }
      cursor = bounds.right
    }
  }
}

function repackCoupleRows(nodes: LaidOutNode[], couples: Couple[]) {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const byGeneration = new Map<number, Couple[]>()
  for (const c of couples) {
    if (!byGeneration.has(c.generation)) byGeneration.set(c.generation, [])
    byGeneration.get(c.generation)!.push(c)
  }

  const boundsFor = (c: Couple) => {
    const memberNodes = c.memberIds
      .map(id => nodeById.get(id))
      .filter(Boolean) as LaidOutNode[]
    const left = Math.min(...memberNodes.map(n => n.cx - NODE_W / 2))
    const right = Math.max(...memberNodes.map(n => n.cx + NODE_W / 2))
    return { memberNodes, left, right }
  }

  for (const row of byGeneration.values()) {
    const ordered = [...row].sort((a, b) => boundsFor(a).left - boundsFor(b).left)
    let cursor: number | null = null
    for (const c of ordered) {
      const bounds = boundsFor(c)
      if (cursor !== null && bounds.left < cursor + UNIT_GAP) {
        const delta = cursor + UNIT_GAP - bounds.left
        for (const n of bounds.memberNodes) n.cx += delta
        c.cx += delta
        bounds.left += delta
        bounds.right += delta
      }
      cursor = bounds.right
    }
  }
}

function alignOnlyChildren(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
  manualPositions?: Record<string, { cx: number; top: number }>,
) {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const coupleByMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const id of c.memberIds) coupleByMember.set(id, c)
  }

  for (const c of couples) {
    const childSet = new Set<string>()
    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue
      for (const ch of m.children) childSet.add(ch.id)
    }
    if (childSet.size !== 1) continue
    const onlyChildId = [...childSet][0]
    if (manualPositions?.[onlyChildId]) continue
    const child = byId.get(onlyChildId)
    const childNode = nodeById.get(onlyChildId)
    if (!child || !childNode) continue
    const parentIds = new Set(c.memberIds)
    const allParentsMatchCouple = child.parents.every(p => parentIds.has(p.id))
    if (!allParentsMatchCouple) continue
    const childCouple = coupleByMember.get(onlyChildId)
    const shiftedMemberIds = childCouple?.memberIds ?? [onlyChildId]
    if (shiftedMemberIds.some(id => manualPositions?.[id])) continue
    const parentNodes = c.memberIds.map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]
    if (parentNodes.length > 0) {
      const parentX = parentNodes.length === 2
        ? (parentNodes[0].cx + parentNodes[1].cx) / 2
        : parentNodes[0].cx
      const delta = parentX - childNode.cx
      for (const id of shiftedMemberIds) {
        const n = nodeById.get(id)
        if (n) n.cx += delta
      }
      if (childCouple) childCouple.cx += delta
    }
  }
}

function assignGenerations(
  members: Member[],
  byId: Map<string, Member>,
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
      for (const p of m.parents) push(p.id, g - 1)
      for (const c of m.children) push(c.id, g + 1)
      for (const s of m.spouses) push(s.id, g)
      for (const s of m.siblings) push(s.id, g)
      for (const p of m.godparents) push(p.id, g - 1)
      for (const c of m.godchildren) push(c.id, g + 1)
    }
  }

  for (const m of members) {
    if (gen.has(m.id)) continue
    const componentSeed = findTopInComponent(m.id, byId) ?? m.id
    bfs(componentSeed, 0)
  }

  return gen
}

function findTopInComponent(
  seedId: string,
  byId: Map<string, Member>,
): string | null {
  const seen = new Set<string>([seedId])
  const queue: string[] = [seedId]
  let best: string | null = null
  while (queue.length > 0) {
    const id = queue.shift()!
    const m = byId.get(id)
    if (!m) continue
    if (m.parents.length === 0) {
      if (best === null || id < best) best = id
    }
    for (const r of [...m.parents, ...m.children, ...m.spouses, ...m.siblings, ...m.godparents, ...m.godchildren]) {
      if (!seen.has(r.id) && byId.has(r.id)) {
        seen.add(r.id)
        queue.push(r.id)
      }
    }
  }
  return best
}

function buildElkGraph(
  members: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>,
): { elkGraph: ElkGraph; couples: Couple[]; coupleOfMember: Map<string, Couple> } {
  const couples = buildCouples(members, byId, gen)
  const coupleOfMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const mid of c.memberIds) {
      coupleOfMember.set(mid, c)
    }
  }

  const elkNodes: ElkNode[] = couples.map(c => ({
    id: c.id,
    width: coupleWidth(c.memberIds.length),
    height: NODE_H,
  }))

  const edges: ElkEdge[] = []
  const edgeSet = new Set<string>()

  for (const c of couples) {
    const childIds = new Set<string>()
    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue
      for (const ch of m.children) childIds.add(ch.id)
    }

    for (const childId of childIds) {
      const childCouple = coupleOfMember.get(childId)
      if (!childCouple || childCouple.id === c.id) continue
      const edgeKey = `${c.id}->${childCouple.id}`
      if (edgeSet.has(edgeKey)) continue
      edgeSet.add(edgeKey)
      edges.push({
        id: edgeKey,
        sources: [c.id],
        targets: [childCouple.id],
      })
    }
  }

  const elkGraph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': String(UNIT_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(ROW_GAP),
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: elkNodes,
    edges,
  }

  return { elkGraph, couples, coupleOfMember }
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
    const g = gen.get(m.id)!
    if (!gens.has(g)) gens.set(g, [])
    gens.get(g)!.push(m)
  }

  for (const [g, membersInGen] of gens) {
    const sorted = [...membersInGen].sort((a, b) => b.children.length - a.children.length)

    for (const m of sorted) {
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

function convertElkResult(
  layouted: any,
  couples: Couple[],
  _coupleOfMember: Map<string, Couple>,
  gen: Map<string, number>,
  _members: Member[],
): LayoutResult {
  const nodes: LaidOutNode[] = []
  const coupleById = new Map(couples.map(c => [c.id, c]))
  const minGen = Math.min(...gen.values())

  for (const elkNode of layouted.children) {
    const couple = coupleById.get(elkNode.id)
    if (!couple) continue

    const elkX = elkNode.x || 0
    couple.cx = elkX + coupleWidth(couple.memberIds.length) / 2

    couple.memberIds.forEach((id, idx) => {
      nodes.push({
        id,
        cx: memberCenterX(elkX, idx),
        top: (couple.generation - minGen) * ROW_HEIGHT,
        generation: couple.generation,
      })
    })
  }

  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }

  return {
    nodes,
    couples,
    connectors: [],
    canvas: { width: maxX - minX, height: maxY },
    orphanIds: [],
    offsetX: -minX,
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
      if (parentX < childMin - 0.1) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: parentX, y: midY },
            { x: childMin, y: midY },
          ],
        })
      } else if (parentX > childMax + 0.1) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: childMax, y: midY },
            { x: parentX, y: midY },
          ],
        })
      }
    } else if (Math.abs(childNodes[0].cx - parentX) > 0.1) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: Math.min(parentX, childNodes[0].cx), y: midY },
          { x: Math.max(parentX, childNodes[0].cx), y: midY },
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
