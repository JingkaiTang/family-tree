import type {
  FamilyUnit,
  LayoutMetrics,
  ParentageGroup,
  PlacedFamilyUnit,
  PlacedLayoutDomain,
  PlacedPersonCard,
  PlacedRow,
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
  placedDomains: PlacedLayoutDomain[]
  rows: PlacedRow[]
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
      rootDomains: [],
      bridgeDomains: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const units = clonePlacedUnits(input.placedUnits)
  const rows = materializeRows(input.rows, units)
  const cards = materializeCards(units, input.metrics)
  const hubs = materializeHubs(
    units,
    cards,
    input.parentageGroups,
    input.metrics,
  )
  const placedDomains = input.placedDomains.map(domain => ({
    ...domain,
    rootIds: [...domain.rootIds],
    signature: [...domain.signature],
    personIds: [...domain.personIds],
    unitIds: [...domain.unitIds],
    rect: { ...domain.rect },
  }))
  const right = Math.max(
    ...units.map(unit => unit.rect.x + unit.rect.width),
    ...placedDomains.map(domain => domain.rect.x + domain.rect.width),
  )
  const bottom = Math.max(
    ...units.map(unit => unit.rect.y + unit.rect.height),
    ...placedDomains.map(domain => domain.rect.y + domain.rect.height),
  )

  return {
    units,
    cards,
    hubs,
    rows,
    rootDomains: placedDomains.filter(domain => domain.kind === 'root'),
    bridgeDomains: placedDomains.filter(domain => domain.kind !== 'root'),
    bounds: { x: 0, y: 0, width: right, height: bottom },
  }
}

function clonePlacedUnits<T extends PlacedFamilyUnit>(units: T[]): T[] {
  return units.map(unit => ({
    ...unit,
    memberIds: [...unit.memberIds],
    rect: { ...unit.rect },
  }))
}

function materializeRows(
  inputRows: PlacedRow[],
  units: PlacedFamilyUnit[],
): PlacedRow[] {
  const placedUnitById = new Map(units.map(unit => [unit.id, unit]))
  return inputRows.map(row => {
    const originalOrder = new Map(
      row.unitIds.map((unitId, index) => [unitId, index]),
    )
    const unitIds = row.unitIds
      .filter(unitId => placedUnitById.has(unitId))
      .sort((leftId, rightId) => {
        const left = placedUnitById.get(leftId)!
        const right = placedUnitById.get(rightId)!
        return left.rect.x - right.rect.x
          || (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0)
          || leftId.localeCompare(rightId)
      })
    unitIds.forEach((unitId, order) => {
      placedUnitById.get(unitId)!.order = order
    })
    return { id: row.id, generation: row.generation, unitIds }
  })
}

function materializeCards(
  units: PlacedFamilyUnit[],
  metrics: LayoutMetrics,
): PlacedPersonCard[] {
  return units.flatMap(unit => unit.memberIds.map((personId, index) => ({
    id: personId,
    unitId: unit.id,
    generation: unit.generation,
    rect: {
      x: unit.rect.x + index * (metrics.cardWidth + metrics.spouseGap),
      y: unit.rect.y,
      width: metrics.cardWidth,
      height: metrics.cardHeight,
    },
  })))
}

function materializeHubs(
  units: PlacedFamilyUnit[],
  cards: PlacedPersonCard[],
  parentageGroups: ParentageGroup[],
  metrics: LayoutMetrics,
): PlacedUnionHub[] {
  const cardById = new Map(cards.map(card => [card.id, card]))
  const defaultParentageOwnerIds = new Set(
    parentageGroups
      .filter(group => group.sourceAnchorPersonId === undefined)
      .map(group => group.sourceUnitId),
  )
  const hubs: PlacedUnionHub[] = units
    .filter(unit => unit.kind === 'couple' || defaultParentageOwnerIds.has(unit.id))
    .map(unit => ({
      id: `hub:${unit.id}`,
      unitId: unit.id,
      point: {
        x: unit.kind === 'couple'
          ? unit.rect.x + metrics.cardWidth + metrics.spouseGap / 2
          : unit.rect.x + metrics.cardWidth / 2,
        y: unit.kind === 'couple'
          ? unit.rect.y + metrics.cardHeight / 2
          : unit.rect.y + metrics.cardHeight,
      },
    }))
  const anchoredGroupsByPersonId = new Map<string, ParentageGroup[]>()
  for (const group of parentageGroups) {
    if (group.sourceAnchorPersonId === undefined) continue
    const anchoredGroups = anchoredGroupsByPersonId.get(group.sourceAnchorPersonId) ?? []
    anchoredGroups.push(group)
    anchoredGroupsByPersonId.set(group.sourceAnchorPersonId, anchoredGroups)
  }
  for (const [personId, anchoredGroups] of [...anchoredGroupsByPersonId.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))) {
    const card = cardById.get(personId)
    if (card === undefined) continue
    const sortedGroups = anchoredGroups.sort((left, right) => (
      left.id.localeCompare(right.id)
    ))
    const portXs = anchoredPortXs(card, sortedGroups.length, metrics.routeSubgrid)
    sortedGroups.forEach((group, index) => hubs.push({
      id: group.sourceHubId ?? `hub:${group.id}`,
      unitId: group.sourceUnitId,
      point: {
        x: portXs[index],
        y: card.rect.y + card.rect.height,
      },
    }))
  }
  return hubs
}

function anchoredPortXs(
  card: PlacedPersonCard,
  count: number,
  routeSubgrid: number,
): number[] {
  const centerX = card.rect.x + card.rect.width / 2
  if (count === 1) return [centerX]
  const minX = card.rect.x + 12
  const maxX = card.rect.x + card.rect.width - 12
  const spacing = Math.min(routeSubgrid * 2, (maxX - minX) / (count - 1))
  return Array.from({ length: count }, (_, index) => (
    centerX + (index - (count - 1) / 2) * spacing
  ))
}
