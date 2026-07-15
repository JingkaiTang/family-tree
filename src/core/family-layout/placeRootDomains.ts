import {
  familyUnitWidth,
  materializeRootSceneGeometry,
} from './materializeSceneGeometry'
import type {
  LayoutDomain,
  ParentageGroup,
  PlaceRootDomainsInput,
  PlacedLayoutDomain,
  PlacedRootedFamilyUnit,
  PlacedRow,
  RootedFamilyUnit,
  RootSceneGeometry,
} from './types'

interface ParentageEdge {
  sourceId: string
  childId: string
}

interface DomainRow extends PlacedRow {
  domainId: string
  hasExplicitPreference: boolean
}

export function placeRootDomains(
  input: PlaceRootDomainsInput,
): RootSceneGeometry {
  if (input.units.length === 0 || input.domains.length === 0) {
    return materializeRootSceneGeometry({
      placedUnits: [],
      placedDomains: [],
      rows: [],
      parentageGroups: [],
      metrics: input.metrics,
    })
  }

  const units = [...input.units].sort((left, right) => left.id.localeCompare(right.id))
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const unitIdByPersonId = new Map(
    units.flatMap(unit => unit.memberIds.map(personId => [personId, unit.id] as const)),
  )
  const edges = buildParentageEdges(input.parentageGroups, unitIdByPersonId)
  const orderedDomains = [...input.domains].sort((left, right) => (
    left.order - right.order || left.id.localeCompare(right.id)
  ))
  const contentWidthByDomainId = new Map(
    orderedDomains.map(domain => [
      domain.id,
      domainContentWidth(domain, units, edges, input),
    ]),
  )
  const allocatedDomains = allocateDomainIntervals(
    orderedDomains,
    contentWidthByDomainId,
    unitById,
    input,
  )
  const allocatedDomainById = new Map(
    allocatedDomains.map(domain => [domain.id, domain]),
  )
  const rows = orderedDomains.flatMap(domain => orderDomainRows(
    domain,
    units.filter(unit => unit.domainId === domain.id),
    edges,
    input,
  ))
  const firstGeneration = Math.min(...units.map(unit => unit.generation))
  const placedUnits = placeInitialRows(
    rows,
    unitById,
    allocatedDomainById,
    firstGeneration,
    input,
  )
  centerParentChildBranches(
    placedUnits,
    rows,
    edges,
    allocatedDomainById,
    input,
  )
  const bottom = Math.max(...placedUnits.map(unit => (
    unit.rect.y + unit.rect.height
  )))
  const placedDomains = allocatedDomains.map(domain => ({
    ...domain,
    rect: { ...domain.rect, height: bottom },
  }))

  return materializeRootSceneGeometry({
    placedUnits,
    placedDomains,
    rows,
    parentageGroups: input.parentageGroups,
    metrics: input.metrics,
  })
}

function domainContentWidth(
  domain: LayoutDomain,
  units: RootedFamilyUnit[],
  edges: ParentageEdge[],
  input: PlaceRootDomainsInput,
): number {
  const domainUnits = units.filter(unit => unit.domainId === domain.id)
  if (domainUnits.length === 0) return input.metrics.cardWidth
  const domainUnitIds = new Set(domainUnits.map(unit => unit.id))
  const widthByUnitId = new Map(domainUnits.map(unit => [
    unit.id,
    snapUp(familyUnitWidth(unit, input.metrics), input.metrics.gridSize),
  ]))
  const rowWidths = [...groupUnitsByGeneration(domainUnits).values()].map(rowUnits => (
    rowUnits.reduce((sum, unit) => sum + (widthByUnitId.get(unit.id) ?? 0), 0)
      + Math.max(0, rowUnits.length - 1) * input.metrics.familyGap
  ))
  const childrenBySourceId = new Map<string, string[]>()
  const incomingUnitIds = new Set<string>()
  for (const edge of edges) {
    if (!domainUnitIds.has(edge.sourceId) || !domainUnitIds.has(edge.childId)) continue
    const childIds = childrenBySourceId.get(edge.sourceId) ?? []
    if (!childIds.includes(edge.childId)) childIds.push(edge.childId)
    childrenBySourceId.set(edge.sourceId, childIds)
    incomingUnitIds.add(edge.childId)
  }
  const spanByUnitId = new Map<string, number>()
  const branchSpan = (unitId: string, visiting: Set<string>): number => {
    const cached = spanByUnitId.get(unitId)
    if (cached !== undefined) return cached
    const ownWidth = widthByUnitId.get(unitId) ?? input.metrics.cardWidth
    if (visiting.has(unitId)) return ownWidth
    const nextVisiting = new Set(visiting).add(unitId)
    const childSpans = [...new Set(childrenBySourceId.get(unitId) ?? [])]
      .sort((left, right) => left.localeCompare(right))
      .map(childId => branchSpan(childId, nextVisiting))
    const descendantsWidth = childSpans.reduce((sum, width) => sum + width, 0)
      + Math.max(0, childSpans.length - 1) * input.metrics.familyGap
    const span = Math.max(ownWidth, descendantsWidth)
    spanByUnitId.set(unitId, span)
    return span
  }
  const sourceUnitIds = domainUnits
    .filter(unit => unit.isRootFamily || !incomingUnitIds.has(unit.id))
    .map(unit => unit.id)
    .sort((left, right) => left.localeCompare(right))
  const sourceSpans = sourceUnitIds.map(unitId => branchSpan(unitId, new Set()))
  const combinedSourceSpan = sourceSpans.reduce((sum, width) => sum + width, 0)
    + Math.max(0, sourceSpans.length - 1) * input.metrics.familyGap

  return snapUp(
    Math.max(combinedSourceSpan, ...rowWidths),
    input.metrics.gridSize,
  )
}

function allocateDomainIntervals(
  domains: LayoutDomain[],
  contentWidthByDomainId: ReadonlyMap<string, number>,
  unitById: ReadonlyMap<string, RootedFamilyUnit>,
  input: PlaceRootDomainsInput,
): PlacedLayoutDomain[] {
  let x = 0
  return domains.map((domain, index) => {
    const previous = domains[index - 1]
    if (previous !== undefined) {
      x += previous.kind === 'root' && domain.kind === 'root'
        ? input.metrics.rootGap
        : input.metrics.bridgeGap
    }
    let width = snapUp(
      (contentWidthByDomainId.get(domain.id) ?? input.metrics.cardWidth)
        + input.metrics.gridSize * 2,
      input.metrics.gridSize,
    )
    const rootUnit = domain.kind === 'root'
      ? domain.unitIds.map(unitId => unitById.get(unitId))
        .find(unit => unit?.isRootFamily)
      : undefined
    if (
      rootUnit !== undefined
      && (width - familyUnitWidth(rootUnit, input.metrics))
        / input.metrics.gridSize % 2 !== 0
    ) width += input.metrics.gridSize
    const placed: PlacedLayoutDomain = {
      ...domain,
      rootIds: [...domain.rootIds],
      signature: [...domain.signature],
      personIds: [...domain.personIds],
      unitIds: [...domain.unitIds],
      rect: { x, y: 0, width, height: 0 },
      columnStart: x / input.metrics.gridSize,
      columnEnd: (x + width) / input.metrics.gridSize - 1,
    }
    x += width
    return placed
  })
}

function orderDomainRows(
  domain: LayoutDomain,
  units: RootedFamilyUnit[],
  edges: ParentageEdge[],
  input: PlaceRootDomainsInput,
): DomainRow[] {
  const domainUnitIds = new Set(units.map(unit => unit.id))
  const domainEdges = edges.filter(edge => (
    domainUnitIds.has(edge.sourceId) && domainUnitIds.has(edge.childId)
  ))
  const previousDomain = [
    ...(input.previousScene?.rootDomains ?? []),
    ...(input.previousScene?.bridgeDomains ?? []),
  ].find(value => value.id === domain.id)
  const previousUnitIds = new Set(previousDomain?.unitIds ?? [])
  const domainIsUnchanged = previousDomain !== undefined
    && previousUnitIds.size === domainUnitIds.size
    && [...domainUnitIds].every(unitId => previousUnitIds.has(unitId))
  const previousXByUnitId = new Map(
    (domainIsUnchanged ? input.previousScene?.units : undefined)
      ?.filter(unit => unit.domainId === domain.id)
      .map(unit => [unit.id, unit.rect.x]) ?? [],
  )
  const domainOrder = new Map(domain.unitIds.map((unitId, index) => [unitId, index]))
  const preferences = domain.kind === 'root'
    ? input.preferences.rowOrders
    : input.preferences.bridgeOrders
  const rows = [...groupUnitsByGeneration(units).entries()]
    .sort(([left], [right]) => left - right)
    .map<DomainRow>(([generation, rowUnits]) => {
      const preference = preferences.find(value => (
        value.domainId === domain.id && value.generation === generation
      ))
      const preferenceIndex = new Map(
        preference?.unitIds.map((unitId, index) => [unitId, index]) ?? [],
      )
      let unitIds = rowUnits.map(unit => unit.id).sort((left, right) => {
        const leftPreference = preferenceIndex.get(left)
        const rightPreference = preferenceIndex.get(right)
        if (leftPreference !== undefined || rightPreference !== undefined) {
          if (leftPreference === undefined) return 1
          if (rightPreference === undefined) return -1
          if (leftPreference !== rightPreference) return leftPreference - rightPreference
        }
        const leftPrevious = previousXByUnitId.get(left)
        const rightPrevious = previousXByUnitId.get(right)
        if (leftPrevious !== undefined || rightPrevious !== undefined) {
          if (leftPrevious === undefined) return 1
          if (rightPrevious === undefined) return -1
          if (leftPrevious !== rightPrevious) return leftPrevious - rightPrevious
        }
        return (domainOrder.get(left) ?? Number.POSITIVE_INFINITY)
          - (domainOrder.get(right) ?? Number.POSITIVE_INFINITY)
          || left.localeCompare(right)
      })
      if (preference === undefined) {
        unitIds = contiguateSiblingUnits(unitIds, domainEdges)
      }
      return {
        id: `row:${domain.id}:${generation}`,
        domainId: domain.id,
        generation,
        unitIds,
        hasExplicitPreference: preference !== undefined,
      }
    })

  for (let pass = 0; pass < 4; pass += 1) {
    const positions = new Map(rows.flatMap(row => (
      row.unitIds.map((unitId, index) => [unitId, index] as const)
    )))
    const direction = pass % 2 === 0 ? 'down' : 'up'
    const sweepRows = direction === 'down' ? rows : [...rows].reverse()
    for (const row of sweepRows) {
      if (row.hasExplicitPreference) continue
      const blocks = siblingBlocks(row.unitIds, domainEdges)
      row.unitIds = blocks.sort((left, right) => {
        const leftCenter = blockBarycenter(left, direction, domainEdges, positions)
        const rightCenter = blockBarycenter(right, direction, domainEdges, positions)
        return leftCenter - rightCenter
          || left[0].localeCompare(right[0])
      }).flat()
    }
  }
  return rows
}

function placeInitialRows(
  rows: DomainRow[],
  unitById: ReadonlyMap<string, RootedFamilyUnit>,
  domainById: ReadonlyMap<string, PlacedLayoutDomain>,
  firstGeneration: number,
  input: PlaceRootDomainsInput,
): PlacedRootedFamilyUnit[] {
  return rows.flatMap(row => {
    const domain = domainById.get(row.domainId)
    const rowUnits = row.unitIds
      .map(unitId => unitById.get(unitId))
      .filter((unit): unit is RootedFamilyUnit => unit !== undefined)
    if (domain === undefined || rowUnits.length === 0) return []
    const widths = rowUnits.map(unit => familyUnitWidth(unit, input.metrics))
    const packedWidth = widths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, rowUnits.length - 1) * input.metrics.familyGap
    let x = snapNearest(
      domain.rect.x + (domain.rect.width - packedWidth) / 2,
      input.metrics.gridSize,
    )
    return rowUnits.map((unit, order) => {
      const width = widths[order]
      const placed: PlacedRootedFamilyUnit = {
        ...unit,
        memberIds: [...unit.memberIds],
        rootSignature: [...unit.rootSignature],
        memberRootIds: { ...unit.memberRootIds },
        rect: {
          x,
          y: (row.generation - firstGeneration)
            * (input.metrics.cardHeight + input.metrics.generationGap),
          width,
          height: input.metrics.cardHeight,
        },
        order,
      }
      x += width + input.metrics.familyGap
      return placed
    })
  })
}

function centerParentChildBranches(
  units: PlacedRootedFamilyUnit[],
  rows: DomainRow[],
  edges: ParentageEdge[],
  domainById: ReadonlyMap<string, PlacedLayoutDomain>,
  input: PlaceRootDomainsInput,
): void {
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const rowByUnitId = new Map(rows.flatMap(row => (
    row.unitIds.map(unitId => [unitId, row] as const)
  )))
  const childIdsBySourceId = new Map<string, string[]>()
  for (const edge of edges) {
    const source = unitById.get(edge.sourceId)
    const child = unitById.get(edge.childId)
    if (source === undefined || child === undefined || source.domainId !== child.domainId) {
      continue
    }
    const childIds = childIdsBySourceId.get(edge.sourceId) ?? []
    if (!childIds.includes(edge.childId)) childIds.push(edge.childId)
    childIdsBySourceId.set(edge.sourceId, childIds)
  }

  for (let pass = 0; pass < 4; pass += 1) {
    const desiredCenters = new Map<string, number[]>()
    for (const [sourceId, childIds] of childIdsBySourceId) {
      const source = unitById.get(sourceId)
      const children = childIds
        .map(childId => unitById.get(childId))
        .filter((unit): unit is PlacedRootedFamilyUnit => unit !== undefined)
      if (source === undefined || children.length === 0) continue
      const childLeft = Math.min(...children.map(child => child.rect.x))
      const childRight = Math.max(...children.map(child => (
        child.rect.x + child.rect.width
      )))
      const childCenter = (childLeft + childRight) / 2
      const sourceCenter = centerX(source)
      if (!source.isRootFamily) addDesiredCenter(desiredCenters, source.id, childCenter)
      const shift = sourceCenter - childCenter
      for (const child of children) {
        addDesiredCenter(desiredCenters, child.id, centerX(child) + shift)
      }
    }
    for (const unit of units) {
      const domain = domainById.get(unit.domainId)
      if (domain === undefined) continue
      const centers = unit.isRootFamily
        ? [domain.rect.x + domain.rect.width / 2]
        : desiredCenters.get(unit.id)
      if (centers === undefined || centers.length === 0) continue
      const desiredCenter = centers.reduce((sum, center) => sum + center, 0)
        / centers.length
      unit.rect.x = snapNearest(
        desiredCenter - unit.rect.width / 2,
        input.metrics.gridSize,
      )
    }
    for (const row of rows) {
      const domain = domainById.get(row.domainId)
      if (domain === undefined) continue
      const rowUnits = row.unitIds
        .map(unitId => unitById.get(unitId))
        .filter((unit): unit is PlacedRootedFamilyUnit => unit !== undefined)
      normalizeRowInsideDomain(rowUnits, domain, input)
    }
  }

  for (const unit of units.filter(value => value.isRootFamily)) {
    const row = rowByUnitId.get(unit.id)
    const domain = domainById.get(unit.domainId)
    if (row?.unitIds.length !== 1 || domain === undefined) continue
    unit.rect.x = domain.rect.x + (domain.rect.width - unit.rect.width) / 2
  }
}

function normalizeRowInsideDomain(
  units: PlacedRootedFamilyUnit[],
  domain: PlacedLayoutDomain,
  input: PlaceRootDomainsInput,
): void {
  if (units.length === 0) return
  const minimumX = domain.rect.x + input.metrics.gridSize
  const maximumRight = domain.rect.x + domain.rect.width - input.metrics.gridSize
  units[0].rect.x = Math.max(
    minimumX,
    Math.min(units[0].rect.x, maximumRight - units[0].rect.width),
  )
  for (let index = 1; index < units.length; index += 1) {
    const previous = units[index - 1]
    const minimumUnitX = snapUp(
      previous.rect.x + previous.rect.width + input.metrics.familyGap,
      input.metrics.gridSize,
    )
    units[index].rect.x = Math.max(units[index].rect.x, minimumUnitX)
  }
  const overflow = units.at(-1)!.rect.x + units.at(-1)!.rect.width - maximumRight
  if (overflow > 0) {
    const shift = snapUp(overflow, input.metrics.gridSize)
    units.forEach(unit => { unit.rect.x -= shift })
  }
  if (units[0].rect.x < minimumX) {
    const shift = snapUp(minimumX - units[0].rect.x, input.metrics.gridSize)
    units.forEach(unit => { unit.rect.x += shift })
  }
}

function buildParentageEdges(
  groups: ParentageGroup[],
  unitIdByPersonId: ReadonlyMap<string, string>,
): ParentageEdge[] {
  const edgeById = new Map<string, ParentageEdge>()
  for (const group of [...groups].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const childPersonId of group.childPersonIds) {
      const childId = unitIdByPersonId.get(childPersonId)
      if (childId === undefined || childId === group.sourceUnitId) continue
      const id = `${group.sourceUnitId}\0${childId}`
      edgeById.set(id, { sourceId: group.sourceUnitId, childId })
    }
  }
  return [...edgeById.values()].sort((left, right) => (
    left.sourceId.localeCompare(right.sourceId)
    || left.childId.localeCompare(right.childId)
  ))
}

function groupUnitsByGeneration<T extends RootedFamilyUnit>(
  units: T[],
): Map<number, T[]> {
  const unitsByGeneration = new Map<number, T[]>()
  for (const unit of units) {
    const rowUnits = unitsByGeneration.get(unit.generation) ?? []
    rowUnits.push(unit)
    unitsByGeneration.set(unit.generation, rowUnits)
  }
  return unitsByGeneration
}

function contiguateSiblingUnits(
  unitIds: string[],
  edges: ParentageEdge[],
): string[] {
  let result = [...unitIds]
  const childrenBySourceId = childrenBySource(edges)
  for (const childIds of childrenBySourceId.values()) {
    const siblings = result.filter(unitId => childIds.includes(unitId))
    if (siblings.length < 2) continue
    const siblingSet = new Set(siblings)
    const firstIndex = Math.min(...siblings.map(unitId => result.indexOf(unitId)))
    result = result.filter(unitId => !siblingSet.has(unitId))
    result.splice(firstIndex, 0, ...siblings)
  }
  return result
}

function siblingBlocks(unitIds: string[], edges: ParentageEdge[]): string[][] {
  const groupByChildId = new Map<string, Set<string>>()
  for (const childIds of childrenBySource(edges).values()) {
    const rowChildren = childIds.filter(unitId => unitIds.includes(unitId))
    if (rowChildren.length < 2) continue
    const group = new Set(rowChildren)
    rowChildren.forEach(unitId => groupByChildId.set(unitId, group))
  }
  const visited = new Set<string>()
  return unitIds.flatMap(unitId => {
    if (visited.has(unitId)) return []
    const group = groupByChildId.get(unitId)
    const block = group === undefined
      ? [unitId]
      : unitIds.filter(value => group.has(value))
    block.forEach(value => visited.add(value))
    return [block]
  })
}

function childrenBySource(edges: ParentageEdge[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const edge of edges) {
    const childIds = result.get(edge.sourceId) ?? []
    if (!childIds.includes(edge.childId)) childIds.push(edge.childId)
    result.set(edge.sourceId, childIds)
  }
  return result
}

function blockBarycenter(
  block: string[],
  direction: 'down' | 'up',
  edges: ParentageEdge[],
  positions: ReadonlyMap<string, number>,
): number {
  const neighbors = edges.flatMap(edge => {
    if (direction === 'down' && block.includes(edge.childId)) {
      const position = positions.get(edge.sourceId)
      return position === undefined ? [] : [position]
    }
    if (direction === 'up' && block.includes(edge.sourceId)) {
      const position = positions.get(edge.childId)
      return position === undefined ? [] : [position]
    }
    return []
  })
  const values = neighbors.length > 0
    ? neighbors
    : block.flatMap(unitId => {
        const position = positions.get(unitId)
        return position === undefined ? [] : [position]
      })
  return values.length === 0
    ? Number.POSITIVE_INFINITY
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

function addDesiredCenter(
  centersByUnitId: Map<string, number[]>,
  unitId: string,
  center: number,
): void {
  const centers = centersByUnitId.get(unitId) ?? []
  centers.push(center)
  centersByUnitId.set(unitId, centers)
}

function centerX(unit: PlacedRootedFamilyUnit): number {
  return unit.rect.x + unit.rect.width / 2
}

function snapUp(value: number, gridSize: number): number {
  return Math.ceil(value / gridSize) * gridSize
}

function snapNearest(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}
