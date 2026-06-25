import type { Member } from '@/core/schema'
import type {
  Couple,
  LaidOutNode,
  LayoutConnector,
  LayoutResult,
} from '../elkLayout'
import {
  buildFamilyGraphModel,
  type FamilyComponent,
  type FamilyUnionNode,
} from './familyGraphModel'

const NODE_W = 2
const NODE_H = 4
const SPOUSE_GAP = 0.2
const SIBLING_GAP = 1.5
const COMPONENT_GAP = 4
const ROW_HEIGHT = 7
const EPSILON = 1e-6

interface RowUnit {
  id: string
  memberIds: string[]
  generation: number
  width: number
  cx: number
}

interface ComponentLayout {
  nodes: LaidOutNode[]
  units: RowUnit[]
}

interface Bounds {
  minX: number
  maxX: number
  maxY: number
}

export async function layoutConstraintFamilyTree(
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

  const model = buildFamilyGraphModel(members)
  const memberById = new Map(model.people.map(person => [person.id, person.member]))
  const unionById = new Map(model.unions.map(union => [union.id, union]))
  const allNodes: LaidOutNode[] = []
  const allUnits: RowUnit[] = []
  let componentCursor = 0

  for (const component of model.components) {
    const componentLayout = layoutComponent(component, unionById)
    const bounds = measureNodes(componentLayout.nodes)
    const dx = componentCursor - bounds.minX
    shiftLayout(componentLayout, dx)

    allNodes.push(...componentLayout.nodes)
    allUnits.push(...componentLayout.units)
    componentCursor += bounds.maxX - bounds.minX + COMPONENT_GAP
  }

  if (opts?.manualPositions) {
    for (const node of allNodes) {
      const manual = opts.manualPositions[node.id]
      if (!manual) continue
      node.cx = manual.cx
      node.top = manual.top
    }
  }

  const preOffsetBounds = measureNodes(allNodes)
  const offsetX = -preOffsetBounds.minX
  for (const node of allNodes) node.cx += offsetX
  for (const unit of allUnits) unit.cx += offsetX

  const nodes = allNodes.sort(compareNodes)
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const couples = buildCouples(allUnits, nodeById)
  const connectors = buildConnectors(model.unions, nodes, memberById)
  const bounds = measureNodes(nodes)

  return {
    nodes,
    couples,
    connectors,
    canvas: {
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY,
    },
    orphanIds: [],
    offsetX,
  }
}

function layoutComponent(
  component: FamilyComponent,
  unionById: Map<string, FamilyUnionNode>,
): ComponentLayout {
  const unions = component.unionIds
    .map(id => unionById.get(id))
    .filter((union): union is FamilyUnionNode => Boolean(union))
  const generationById = assignGenerations(component.personIds, unions)
  const rows = buildRows(component.personIds, unions, generationById)
  const nodeById = new Map<string, LaidOutNode>()

  for (const generation of [...rows.keys()].sort((a, b) => a - b)) {
    const rowUnits = rows.get(generation)!
    positionRow(rowUnits, generation, unions, generationById, nodeById)

    for (const unit of rowUnits) {
      const left = unit.cx - unit.width / 2
      for (const [index, id] of unit.memberIds.entries()) {
        nodeById.set(id, {
          id,
          cx: left + NODE_W / 2 + index * (NODE_W + SPOUSE_GAP),
          top: generation * ROW_HEIGHT,
          generation,
        })
      }
    }
  }

  return {
    nodes: [...nodeById.values()],
    units: [...rows.values()].flat(),
  }
}

function assignGenerations(
  personIds: string[],
  unions: FamilyUnionNode[],
): Map<string, number> {
  const generations = new Map(personIds.map(id => [id, 0]))
  const maxIterations = Math.max(1, personIds.length * Math.max(1, unions.length))

  for (let i = 0; i < maxIterations; i++) {
    let changed = false

    for (const union of unions) {
      const partnerGenerations = union.partnerIds
        .map(id => generations.get(id))
        .filter((generation): generation is number => generation !== undefined)
      if (partnerGenerations.length === 0) continue

      const partnerGeneration = Math.max(...partnerGenerations)
      for (const partnerId of union.partnerIds) {
        if ((generations.get(partnerId) ?? partnerGeneration) < partnerGeneration) {
          generations.set(partnerId, partnerGeneration)
          changed = true
        }
      }

      for (const childId of union.childIds) {
        const nextGeneration = partnerGeneration + 1
        if ((generations.get(childId) ?? 0) < nextGeneration) {
          generations.set(childId, nextGeneration)
          changed = true
        }
      }
    }

    if (!changed) break
  }

  const minGeneration = Math.min(...generations.values())
  for (const [id, generation] of generations) {
    generations.set(id, generation - minGeneration)
  }

  return generations
}

function buildRows(
  personIds: string[],
  unions: FamilyUnionNode[],
  generationById: Map<string, number>,
): Map<number, RowUnit[]> {
  const idsByGeneration = new Map<number, string[]>()
  for (const id of personIds) {
    const generation = generationById.get(id) ?? 0
    const row = idsByGeneration.get(generation) ?? []
    row.push(id)
    idsByGeneration.set(generation, row)
  }

  const rows = new Map<number, RowUnit[]>()
  for (const [generation, ids] of idsByGeneration) {
    rows.set(generation, buildPartnerUnits(ids.sort(compareIds), unions, generationById))
  }
  return rows
}

function buildPartnerUnits(
  rowIds: string[],
  unions: FamilyUnionNode[],
  generationById: Map<string, number>,
): RowUnit[] {
  const rowIdSet = new Set(rowIds)
  const adjacency = new Map(rowIds.map(id => [id, new Set<string>()]))

  for (const union of unions) {
    const partnerIds = union.partnerIds.filter(id => rowIdSet.has(id))
    if (partnerIds.length < 2) continue
    const sameGeneration = partnerIds.every(
      id => generationById.get(id) === generationById.get(partnerIds[0]),
    )
    if (!sameGeneration) continue

    for (let i = 0; i < partnerIds.length; i++) {
      for (let j = i + 1; j < partnerIds.length; j++) {
        adjacency.get(partnerIds[i])?.add(partnerIds[j])
        adjacency.get(partnerIds[j])?.add(partnerIds[i])
      }
    }
  }

  const visited = new Set<string>()
  const units: RowUnit[] = []

  for (const id of rowIds) {
    if (visited.has(id)) continue

    const cluster = collectCluster(id, adjacency, visited)
    const memberIds = orderPartnerCluster(cluster, adjacency)
    units.push({
      id: `unit:${memberIds.join('+')}`,
      memberIds,
      generation: generationById.get(id) ?? 0,
      width: unitWidth(memberIds.length),
      cx: 0,
    })
  }

  return units.sort(compareUnits)
}

function collectCluster(
  startId: string,
  adjacency: Map<string, Set<string>>,
  visited: Set<string>,
): string[] {
  const cluster: string[] = []
  const pending = [startId]
  visited.add(startId)

  while (pending.length > 0) {
    const id = pending.shift()!
    cluster.push(id)

    for (const nextId of [...(adjacency.get(id) ?? [])].sort(compareIds)) {
      if (visited.has(nextId)) continue
      visited.add(nextId)
      pending.push(nextId)
    }
  }

  return cluster.sort(compareIds)
}

function orderPartnerCluster(
  cluster: string[],
  adjacency: Map<string, Set<string>>,
): string[] {
  if (cluster.length <= 2) return [...cluster].sort(compareIds)

  const center = [...cluster].sort((a, b) => {
    const degreeDiff = (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0)
    return degreeDiff || compareIds(a, b)
  })[0]
  const neighbors = [...(adjacency.get(center) ?? [])]
    .filter(id => cluster.includes(id))
    .sort(compareIds)
  const middle = Math.ceil(neighbors.length / 2)
  const before = neighbors.slice(0, middle)
  const after = neighbors.slice(middle)
  const remaining = cluster
    .filter(id => id !== center && !neighbors.includes(id))
    .sort(compareIds)

  return [...before, center, ...after, ...remaining]
}

function positionRow(
  rowUnits: RowUnit[],
  generation: number,
  unions: FamilyUnionNode[],
  generationById: Map<string, number>,
  nodeById: Map<string, LaidOutNode>,
) {
  const unitByPersonId = new Map<string, RowUnit>()
  for (const unit of rowUnits) {
    for (const memberId of unit.memberIds) unitByPersonId.set(memberId, unit)
  }

  const orderedUnits: RowUnit[] = []
  const orderedUnitIds = new Set<string>()
  const desiredCenters = new Map<string, number>()
  const childGroups = unions
    .map(union => buildChildGroup(union, generation, generationById, unitByPersonId, nodeById))
    .filter((group): group is { parentCenter: number; unionId: string; units: RowUnit[] } =>
      Boolean(group),
    )
    .sort((a, b) => a.parentCenter - b.parentCenter || compareIds(a.unionId, b.unionId))

  for (const group of childGroups) {
    let left = group.parentCenter - groupWidth(group.units) / 2
    for (const unit of group.units) {
      if (!desiredCenters.has(unit.id)) {
        desiredCenters.set(unit.id, left + unit.width / 2)
      }
      left += unit.width + SIBLING_GAP

      if (orderedUnitIds.has(unit.id)) continue
      orderedUnitIds.add(unit.id)
      orderedUnits.push(unit)
    }
  }

  for (const unit of rowUnits.sort(compareUnits)) {
    if (orderedUnitIds.has(unit.id)) continue
    orderedUnitIds.add(unit.id)
    orderedUnits.push(unit)
  }

  let cursor: number | null = null
  for (const unit of orderedUnits) {
    const desiredCenter = desiredCenters.get(unit.id)
    let left: number = desiredCenter === undefined
      ? cursor === null ? 0 : cursor + SIBLING_GAP
      : desiredCenter - unit.width / 2

    if (cursor !== null && left < cursor + SIBLING_GAP) {
      left = cursor + SIBLING_GAP
    }

    unit.cx = left + unit.width / 2
    cursor = left + unit.width
  }
}

function buildChildGroup(
  union: FamilyUnionNode,
  generation: number,
  generationById: Map<string, number>,
  unitByPersonId: Map<string, RowUnit>,
  nodeById: Map<string, LaidOutNode>,
): { parentCenter: number; unionId: string; units: RowUnit[] } | null {
  const units: RowUnit[] = []
  const seenUnits = new Set<string>()

  for (const childId of union.childIds) {
    if (generationById.get(childId) !== generation) continue
    const unit = unitByPersonId.get(childId)
    if (!unit || seenUnits.has(unit.id)) continue
    seenUnits.add(unit.id)
    units.push(unit)
  }

  if (units.length === 0) return null

  const parentNodes = union.partnerIds
    .map(id => nodeById.get(id))
    .filter((node): node is LaidOutNode => Boolean(node))
  if (parentNodes.length === 0) return null

  return {
    parentCenter: average(parentNodes.map(node => node.cx)),
    unionId: union.id,
    units,
  }
}

function buildCouples(
  units: RowUnit[],
  nodeById: Map<string, LaidOutNode>,
): Couple[] {
  return units
    .map(unit => {
      const nodes = unit.memberIds
        .map(id => nodeById.get(id))
        .filter((node): node is LaidOutNode => Boolean(node))
      return {
        id: unit.id,
        memberIds: unit.memberIds,
        generation: unit.generation,
        cx: average(nodes.map(node => node.cx)),
      }
    })
    .sort((a, b) => a.generation - b.generation || a.cx - b.cx || compareIds(a.id, b.id))
}

function buildConnectors(
  unions: FamilyUnionNode[],
  nodes: LaidOutNode[],
  memberById: Map<string, Member>,
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(node => [node.id, node]))

  for (const union of unions) {
    const partnerNodes = union.partnerIds
      .map(id => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
      .sort((a, b) => a.cx - b.cx || compareIds(a.id, b.id))
    if (partnerNodes.length < 2) continue

    for (let i = 0; i < partnerNodes.length - 1; i++) {
      const a = partnerNodes[i]
      const b = partnerNodes[i + 1]
      lines.push({
        kind: 'spouse',
        points: [
          { x: a.cx, y: a.top + NODE_H / 2 },
          { x: b.cx, y: b.top + NODE_H / 2 },
        ],
      })
    }
  }

  for (const union of unions) {
    const parentNodes = union.partnerIds
      .map(id => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
    const childNodes = union.childIds
      .map(id => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
    if (parentNodes.length === 0 || childNodes.length === 0) continue

    const parentX = average(parentNodes.map(node => node.cx))
    const parentY = Math.max(...parentNodes.map(node => node.top + NODE_H))
    const childTop = Math.min(...childNodes.map(node => node.top))
    const midY = (parentY + childTop) / 2

    lines.push({
      kind: 'parent-child',
      points: [
        { x: parentX, y: parentY },
        { x: parentX, y: midY },
      ],
    })

    const childXs = childNodes.map(node => node.cx)
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
      if (parentX < childMin - EPSILON) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: parentX, y: midY },
            { x: childMin, y: midY },
          ],
        })
      } else if (parentX > childMax + EPSILON) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: childMax, y: midY },
            { x: parentX, y: midY },
          ],
        })
      }
    } else if (Math.abs(childNodes[0].cx - parentX) > EPSILON) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: Math.min(parentX, childNodes[0].cx), y: midY },
          { x: Math.max(parentX, childNodes[0].cx), y: midY },
        ],
      })
    }

    for (const childNode of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: childNode.cx, y: midY },
          { x: childNode.cx, y: childNode.top },
        ],
      })
    }
  }

  const emittedGodparentConnectors = new Set<string>()
  for (const node of nodes) {
    const member = memberById.get(node.id)
    if (!member) continue
    for (const godchild of member.godchildren) {
      const key = `${node.id}>${godchild.id}`
      if (emittedGodparentConnectors.has(key)) continue
      emittedGodparentConnectors.add(key)
      const target = nodeById.get(godchild.id)
      if (!target) continue
      lines.push({
        kind: 'godparent',
        points: [
          { x: node.cx, y: node.top + NODE_H },
          { x: target.cx, y: target.top },
        ],
      })
    }
  }

  return lines
}

function shiftLayout(layout: ComponentLayout, dx: number) {
  for (const node of layout.nodes) node.cx += dx
  for (const unit of layout.units) unit.cx += dx
}

function measureNodes(nodes: LaidOutNode[]): Bounds {
  if (nodes.length === 0) return { minX: 0, maxX: 0, maxY: 0 }

  let minX = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.cx - NODE_W / 2)
    maxX = Math.max(maxX, node.cx + NODE_W / 2)
    maxY = Math.max(maxY, node.top + NODE_H)
  }

  return { minX, maxX, maxY }
}

function unitWidth(memberCount: number): number {
  return memberCount * NODE_W + Math.max(0, memberCount - 1) * SPOUSE_GAP
}

function groupWidth(units: RowUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.width, 0)
    + Math.max(0, units.length - 1) * SIBLING_GAP
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function compareUnits(a: RowUnit, b: RowUnit): number {
  return compareIds(a.memberIds[0] ?? '', b.memberIds[0] ?? '')
}

function compareNodes(a: LaidOutNode, b: LaidOutNode): number {
  return a.generation - b.generation || a.cx - b.cx || compareIds(a.id, b.id)
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}
