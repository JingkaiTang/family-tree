import type { FamilyData } from '@/core/schema'
import type { Couple, LaidOutNode, LayoutConnector, LayoutResult } from '../elkLayout'
import { buildGridFamilyModel, type GridChildGroup, type GridSlot } from './gridFamilyModel'

const NODE_W = 2
const NODE_H = 4
const SPOUSE_GAP = 0.2
const ROW_HEIGHT = 7
const COLUMN_WIDTH = 3.5
const MEMBER_STEP = NODE_W + SPOUSE_GAP
const PADDING_COLUMNS = 0

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
    row.slotIds.forEach((slotId, order) => {
      const slot = slotById.get(slotId)
      if (!slot) return

      const cx = PADDING_COLUMNS + order * COLUMN_WIDTH + slotWidth(slot) / 2
      slotPositions[slot.id] = { generation: row.generation, order, cx }
      pushSlotNodes(nodes, slot, cx)
    })
  }

  const bounds = measureNodes(nodes)
  const offsetX = -bounds.minX
  for (const node of nodes) node.cx += offsetX
  for (const position of Object.values(slotPositions)) position.cx += offsetX

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const couples = buildCouples(model.slots, nodeById)
  const connectors = buildConnectors(model.slots, model.childGroups, nodeById, slotPositions)
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
  nodeById: Map<string, LaidOutNode>,
  slotPositions: Record<string, { cx: number }>,
): LayoutConnector[] {
  return [
    ...buildSpouseConnectors(slots, nodeById),
    ...buildParentChildConnectors(childGroups, nodeById, slotPositions),
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

function slotWidth(slot: GridSlot): number {
  return slot.memberIds.length * NODE_W + Math.max(0, slot.memberIds.length - 1) * SPOUSE_GAP
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
