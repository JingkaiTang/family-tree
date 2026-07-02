import type { FamilyData, Member } from '@/core/schema'
import type { Couple, LaidOutNode, LayoutConnector, LayoutResult } from '../elkLayout'
import { buildGridFamilyModel, type GridChildGroup, type GridSlot } from './gridFamilyModel'

const NODE_W = 2
const NODE_H = 4
const SPOUSE_GAP = 0.2
const ROW_HEIGHT = 7
const COLUMN_WIDTH = 3.5
const MEMBER_STEP = NODE_W + SPOUSE_GAP
const SLOT_GAP = 1.5

interface Bounds {
  minX: number
  maxX: number
  maxY: number
}

export async function layoutGridFamilyTree(data: FamilyData): Promise<LayoutResult> {
  const model = buildGridFamilyModel(data)
  if (model.members.length === 0) {
    return {
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
      grid: { memberSlotIds: {}, slotPositions: {}, columnWidth: COLUMN_WIDTH },
    }
  }

  const slotById = new Map(model.slots.map((slot) => [slot.id, slot]))
  const nodes: LaidOutNode[] = []
  const slotPositions: Record<string, { generation: number; order: number; cx: number }> = {}

  for (const row of model.rows) {
    layoutRow(row.slotIds, row.generation, model.childGroups, model.memberSlotIds, slotById, slotPositions, nodes)
  }

  const bounds = measureNodes(nodes)
  const offsetX = -bounds.minX
  for (const node of nodes) node.cx += offsetX
  for (const position of Object.values(slotPositions)) position.cx += offsetX

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const couples = buildCouples(model.slots, nodeById)
  const connectors = buildConnectors(model.slots, model.childGroups, model.members, nodeById, slotPositions)
  const shiftedBounds = measureNodes(nodes)

  return {
    nodes: nodes.sort(compareNodes),
    couples,
    connectors,
    canvas: {
      width: shiftedBounds.maxX - shiftedBounds.minX,
      height: shiftedBounds.maxY,
    },
    orphanIds: [],
    offsetX,
    grid: {
      memberSlotIds: model.memberSlotIds,
      slotPositions,
      columnWidth: COLUMN_WIDTH,
    },
  }
}

function layoutRow(
  rowSlotIds: string[],
  generation: number,
  childGroups: GridChildGroup[],
  memberSlotIds: Record<string, string>,
  slotById: Map<string, GridSlot>,
  slotPositions: Record<string, { generation: number; order: number; cx: number }>,
  nodes: LaidOutNode[],
) {
  const rowSlotIdSet = new Set(rowSlotIds)
  const rowOrder = new Map(rowSlotIds.map((slotId, index) => [slotId, index]))
  const desiredCenters = new Map<string, number>()
  const orderedSlotIds: string[] = []
  const added = new Set<string>()

  const addSlotId = (slotId: string) => {
    if (!rowSlotIdSet.has(slotId) || added.has(slotId)) return
    orderedSlotIds.push(slotId)
    added.add(slotId)
  }

  const groupsForRow = childGroups
    .map((group) => {
      const parent = slotPositions[group.parentSlotId]
      if (!parent) return null
      const childSlotIds = uniqueSlotIds(
        group.childIds
          .map((childId) => memberSlotIds[childId])
          .filter((slotId): slotId is string => Boolean(slotId) && rowSlotIdSet.has(slotId)),
        rowOrder,
      )
      if (childSlotIds.length === 0) return null
      return { parentCx: parent.cx, parentSlotId: group.parentSlotId, childSlotIds }
    })
    .filter((group): group is { parentCx: number; parentSlotId: string; childSlotIds: string[] } => Boolean(group))
    .sort((left, right) => left.parentCx - right.parentCx || left.parentSlotId.localeCompare(right.parentSlotId))

  for (const group of groupsForRow) {
    const width = groupWidth(group.childSlotIds, slotById)
    let left = group.parentCx - width / 2
    for (const slotId of group.childSlotIds) {
      const slot = slotById.get(slotId)
      if (!slot) continue
      desiredCenters.set(slotId, left + slotWidth(slot) / 2)
      left += slotWidth(slot) + SLOT_GAP
      addSlotId(slotId)
    }
  }

  for (const slotId of rowSlotIds) addSlotId(slotId)

  let cursor: number | null = null
  for (const [order, slotId] of orderedSlotIds.entries()) {
    const slot = slotById.get(slotId)
    if (!slot) continue
    const desiredCenter = desiredCenters.get(slotId)
    let left: number = desiredCenter === undefined
      ? cursor === null ? 0 : cursor + SLOT_GAP
      : desiredCenter - slotWidth(slot) / 2
    if (cursor !== null && left < cursor + SLOT_GAP) {
      left = cursor + SLOT_GAP
    }

    const cx = left + slotWidth(slot) / 2
    slotPositions[slot.id] = { generation, order, cx }
    pushSlotNodes(nodes, slot, cx)
    cursor = left + slotWidth(slot)
  }
}

function pushSlotNodes(nodes: LaidOutNode[], slot: GridSlot, slotCx: number) {
  const left = slotCx - slotWidth(slot) / 2
  for (const [index, id] of slot.memberIds.entries()) {
    nodes.push({
      id,
      cx: left + NODE_W / 2 + index * MEMBER_STEP,
      top: slot.generation * ROW_HEIGHT,
      generation: slot.generation,
    })
  }
}

function buildCouples(slots: GridSlot[], nodeById: Map<string, LaidOutNode>): Couple[] {
  return slots
    .filter((slot) => slot.kind === 'couple')
    .map((slot) => {
      const memberNodes = slot.memberIds
        .map((id) => nodeById.get(id))
        .filter((node): node is LaidOutNode => Boolean(node))
      return {
        id: slot.id,
        memberIds: slot.memberIds,
        generation: slot.generation,
        cx: average(memberNodes.map((node) => node.cx)),
      }
    })
    .sort((left, right) => left.generation - right.generation || left.cx - right.cx || left.id.localeCompare(right.id))
}

function buildConnectors(
  slots: GridSlot[],
  childGroups: GridChildGroup[],
  members: Member[],
  nodeById: Map<string, LaidOutNode>,
  slotPositions: Record<string, { cx: number }>,
): LayoutConnector[] {
  return [
    ...buildSpouseConnectors(slots, nodeById),
    ...buildParentChildConnectors(childGroups, nodeById, slotPositions),
    ...buildGodparentConnectors(members, nodeById),
  ]
}

function buildSpouseConnectors(slots: GridSlot[], nodeById: Map<string, LaidOutNode>): LayoutConnector[] {
  const connectors: LayoutConnector[] = []
  for (const slot of slots) {
    if (slot.kind !== 'couple') continue
    const memberNodes = slot.memberIds
      .map((id) => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
      .sort((left, right) => left.cx - right.cx)
    for (let i = 0; i < memberNodes.length - 1; i++) {
      const left = memberNodes[i]
      const right = memberNodes[i + 1]
      connectors.push({
        kind: 'spouse',
        points: [
          { x: left.cx, y: left.top + NODE_H / 2 },
          { x: right.cx, y: right.top + NODE_H / 2 },
        ],
      })
    }
  }
  return connectors
}

function buildParentChildConnectors(
  childGroups: GridChildGroup[],
  nodeById: Map<string, LaidOutNode>,
  slotPositions: Record<string, { cx: number }>,
): LayoutConnector[] {
  const connectors: LayoutConnector[] = []

  for (const group of childGroups) {
    const parent = slotPositions[group.parentSlotId]
    const childNodes = group.childIds
      .map((id) => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
    if (!parent || childNodes.length === 0) continue

    const parentY = Math.min(...childNodes.map((node) => node.top)) - (ROW_HEIGHT - NODE_H) / 2
    const childTop = Math.min(...childNodes.map((node) => node.top))
    const midY = (parentY + childTop) / 2
    connectors.push({
      kind: 'parent-child',
      points: [
        { x: parent.cx, y: parentY },
        { x: parent.cx, y: midY },
      ],
    })

    const childXs = childNodes.map((node) => node.cx)
    const minChildX = Math.min(...childXs)
    const maxChildX = Math.max(...childXs)
    if (childNodes.length > 1) {
      connectors.push({
        kind: 'parent-child',
        points: [
          { x: minChildX, y: midY },
          { x: maxChildX, y: midY },
        ],
      })
    }

    for (const child of childNodes) {
      connectors.push({
        kind: 'parent-child',
        points: [
          { x: child.cx, y: midY },
          { x: child.cx, y: child.top },
        ],
      })
    }
  }

  return connectors
}

function buildGodparentConnectors(members: Member[], nodeById: Map<string, LaidOutNode>): LayoutConnector[] {
  const connectors: LayoutConnector[] = []
  const emitted = new Set<string>()

  const addConnector = (godparentId: string, godchildId: string) => {
    if (godparentId === godchildId) return
    const key = `${godparentId}>${godchildId}`
    if (emitted.has(key)) return
    emitted.add(key)

    const godparent = nodeById.get(godparentId)
    const godchild = nodeById.get(godchildId)
    if (!godparent || !godchild) return
    connectors.push({
      kind: 'godparent',
      points: [
        { x: godparent.cx, y: godparent.top + NODE_H },
        { x: godchild.cx, y: godchild.top },
      ],
    })
  }

  for (const member of members) {
    for (const godchild of member.godchildren) addConnector(member.id, godchild.id)
    for (const godparent of member.godparents) addConnector(godparent.id, member.id)
  }

  return connectors
}

function slotWidth(slot: GridSlot): number {
  return slot.memberIds.length * NODE_W + Math.max(0, slot.memberIds.length - 1) * SPOUSE_GAP
}

function groupWidth(slotIds: string[], slotById: Map<string, GridSlot>): number {
  const widths = slotIds
    .map((slotId) => slotById.get(slotId))
    .filter((slot): slot is GridSlot => Boolean(slot))
    .map(slotWidth)
  return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * SLOT_GAP
}

function uniqueSlotIds(slotIds: string[], rowOrder: Map<string, number>): string[] {
  return [...new Set(slotIds)].sort((left, right) => (rowOrder.get(left) ?? 0) - (rowOrder.get(right) ?? 0))
}

function measureNodes(nodes: LaidOutNode[]): Bounds {
  if (nodes.length === 0) return { minX: 0, maxX: 0, maxY: 0 }
  return {
    minX: Math.min(...nodes.map((node) => node.cx - NODE_W / 2)),
    maxX: Math.max(...nodes.map((node) => node.cx + NODE_W / 2)),
    maxY: Math.max(...nodes.map((node) => node.top + NODE_H)),
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function compareNodes(left: LaidOutNode, right: LaidOutNode): number {
  return left.generation - right.generation || left.cx - right.cx || left.id.localeCompare(right.id)
}
