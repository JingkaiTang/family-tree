import type {
  FamilyUnit,
  LayoutMetrics,
  OrderedGeneration,
  ParentageGroup,
  PlacedFamilyUnit,
  PlacedPersonCard,
  PlacedUnionHub,
  SceneGeometry,
} from './types'

export function familyUnitWidth(unit: FamilyUnit, metrics: LayoutMetrics): number {
  return unit.kind === 'couple'
    ? metrics.cardWidth * 2 + metrics.spouseGap
    : metrics.cardWidth
}

export interface MaterializeSceneGeometryInput {
  placedUnits: PlacedFamilyUnit[]
  rows: OrderedGeneration[]
  parentageGroups: ParentageGroup[]
  metrics: LayoutMetrics
}

export function materializeSceneGeometry(
  input: MaterializeSceneGeometryInput,
): SceneGeometry {
  if (input.placedUnits.length === 0) {
    return {
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const units = input.placedUnits.map(unit => ({
    ...unit,
    rect: { ...unit.rect },
  }))
  const placedUnitById = new Map(units.map(unit => [unit.id, unit]))
  const rows = input.rows.map(row => {
    const originalOrder = new Map(row.unitIds.map((unitId, index) => [unitId, index]))
    const unitIds = row.unitIds
      .filter(unitId => placedUnitById.has(unitId))
      .sort((leftId, rightId) => {
        const left = placedUnitById.get(leftId)!
        const right = placedUnitById.get(rightId)!
        return left.rect.x - right.rect.x
          || (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0)
          || leftId.localeCompare(rightId)
      })
    unitIds.forEach((unitId, order) => { placedUnitById.get(unitId)!.order = order })
    return { id: `row:${row.generation}`, generation: row.generation, unitIds }
  })
  const cards: PlacedPersonCard[] = units.flatMap(unit => (
    unit.memberIds.map((personId, index) => ({
      id: personId,
      unitId: unit.id,
      generation: unit.generation,
      rect: {
        x: unit.rect.x + index * (input.metrics.cardWidth + input.metrics.spouseGap),
        y: unit.rect.y,
        width: input.metrics.cardWidth,
        height: input.metrics.cardHeight,
      },
    }))
  ))
  const parentageOwnerIds = new Set(
    input.parentageGroups.map(group => group.sourceUnitId),
  )
  const hubs: PlacedUnionHub[] = units
    .filter(unit => unit.kind === 'couple' || parentageOwnerIds.has(unit.id))
    .map(unit => ({
      id: `hub:${unit.id}`,
      unitId: unit.id,
      point: {
        x: unit.kind === 'couple'
          ? unit.rect.x + input.metrics.cardWidth + input.metrics.spouseGap / 2
          : unit.rect.x + input.metrics.cardWidth / 2,
        y: unit.kind === 'couple'
          ? unit.rect.y + input.metrics.cardHeight / 2
          : unit.rect.y + input.metrics.cardHeight,
      },
    }))
  for (const group of input.parentageGroups) {
    if (group.sourceAnchorPersonId === undefined) continue
    const card = cards.find(value => value.id === group.sourceAnchorPersonId)
    if (card === undefined) continue
    hubs.push({
      id: `hub:${group.id}`,
      unitId: group.sourceUnitId,
      point: {
        x: card.rect.x + card.rect.width / 2,
        y: card.rect.y + card.rect.height,
      },
    })
  }
  const right = Math.max(...units.map(unit => unit.rect.x + unit.rect.width))
  const bottom = Math.max(...units.map(unit => unit.rect.y + unit.rect.height))

  return {
    units,
    cards,
    hubs,
    rows,
    bounds: { x: 0, y: 0, width: right, height: bottom },
  }
}
