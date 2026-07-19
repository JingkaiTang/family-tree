import {
  familyUnitWidth,
  materializeSceneGeometry,
} from './materializeSceneGeometry'
import type {
  LayoutDomain,
  ParentageGroup,
  PlaceRootDomainsInput,
  PlacedLayoutDomain,
  PlacedFamilyUnit,
  PlacedRow,
  RootedFamilyUnit,
  SceneGeometry,
} from './types'

interface ParentageEdge {
  groupId: string
  sourceId: string
  childId: string
  order: number
  hasExplicitSiblingOrder: boolean
}

interface DomainRow extends PlacedRow {
  domainId: string
  hasExplicitPreference: boolean
  columns: Record<string, number>
}

export function placeRootDomains(
  input: PlaceRootDomainsInput,
): SceneGeometry {
  if (input.units.length === 0 || input.domains.length === 0) {
    return materializeSceneGeometry({
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
    units,
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

  return materializeSceneGeometry({
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
  const preferences = domain.kind === 'root'
    ? input.preferences.rowOrders
    : input.preferences.bridgeOrders
  const hasManualColumns = preferences.some(preference => (
    preference.domainId === domain.id
    && Object.keys(preference.columns ?? {}).length > 0
  ))
  const unitById = new Map(domainUnits.map(unit => [unit.id, unit]))
  const manuallyPositionedWidth = hasManualColumns
    ? orderDomainRows(domain, domainUnits, edges, input)
      .reduce((maximum, row) => {
        const rowUnits = row.unitIds
          .map(unitId => unitById.get(unitId))
          .filter((unit): unit is RootedFamilyUnit => unit !== undefined)
        for (let index = 0; index < rowUnits.length; index += 1) {
          const column = row.columns[rowUnits[index].id]
          if (column === undefined) continue
          const trailingWidth = rowUnits.slice(index).reduce((sum, unit) => (
            sum + (widthByUnitId.get(unit.id) ?? input.metrics.cardWidth)
          ), 0) + Math.max(0, rowUnits.length - index - 1) * input.metrics.familyGap
          maximum = Math.max(
            maximum,
            column * input.metrics.gridSize + trailingWidth,
          )
        }
        return maximum
      }, 0)
    : 0

  return snapUp(
    Math.max(combinedSourceSpan, manuallyPositionedWidth, ...rowWidths),
    input.metrics.gridSize,
  )
}

function allocateDomainIntervals(
  domains: LayoutDomain[],
  contentWidthByDomainId: ReadonlyMap<string, number>,
  units: RootedFamilyUnit[],
  input: PlaceRootDomainsInput,
): PlacedLayoutDomain[] {
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const widthByDomainId = new Map<string, number>()
  for (const domain of domains) {
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
    widthByDomainId.set(domain.id, width)
  }
  const preferredXByDomainId = buildComponentAnchors(
    domains,
    widthByDomainId,
    units,
    input,
  )
  let previousPlaced: PlacedLayoutDomain | undefined
  return domains.map(domain => {
    const width = widthByDomainId.get(domain.id) ?? input.metrics.cardWidth
    const minimumX = previousPlaced === undefined
      ? 0
      : previousPlaced.rect.x + previousPlaced.rect.width
        + domainGap(previousPlaced, domain, input)
    const preferredX = preferredXByDomainId.get(domain.id)
    const x = snapUp(
      Math.max(minimumX, preferredX ?? minimumX),
      input.metrics.gridSize,
    )
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
    previousPlaced = placed
    return placed
  })
}

function domainGap(
  previous: LayoutDomain,
  current: LayoutDomain,
  input: PlaceRootDomainsInput,
): number {
  return previous.kind === 'root' && current.kind === 'root'
    ? input.metrics.rootGap
    : input.metrics.bridgeGap
}

function buildComponentAnchors(
  domains: LayoutDomain[],
  widthByDomainId: ReadonlyMap<string, number>,
  units: RootedFamilyUnit[],
  input: PlaceRootDomainsInput,
): Map<string, number> {
  const anchors = new Map<string, number>()
  const previousDomains = allPreviousDomains(input)
  const changedComponentIds = collectChangedComponentIds(domains, units, input)
  for (const componentDomains of groupDomainsByComponent(domains)) {
    const firstDomain = componentDomains[0]
    if (
      firstDomain === undefined
      || input.preferences.rootOrders.some(preference => (
        preference.componentId === firstDomain.componentId
      ))
    ) continue

    const matchedPreviousDomains = componentDomains
      .map(domain => findPreviousDomain(domain, input))
      .filter((domain): domain is PlacedLayoutDomain => domain !== undefined)
    const previousComponentIds = new Set(
      matchedPreviousDomains.map(domain => domain.componentId),
    )
    if (previousComponentIds.size !== 1) continue
    const previousComponentId = [...previousComponentIds][0]
    const previousComponentDomains = previousDomains.filter(domain => (
      domain.componentId === previousComponentId
    ))
    if (previousComponentDomains.length === 0) continue

    const previousLeft = Math.min(...previousComponentDomains.map(domain => (
      domain.rect.x
    )))
    const previousRight = Math.max(...previousComponentDomains.map(domain => (
      domain.rect.x + domain.rect.width
    )))
    const componentWidth = componentDomains.reduce((sum, domain, index) => {
      const previous = componentDomains[index - 1]
      return sum + (widthByDomainId.get(domain.id) ?? input.metrics.cardWidth)
        + (previous === undefined ? 0 : domainGap(previous, domain, input))
    }, 0)
    const compositionChanged = !sameDomainComposition(
      componentDomains,
      previousComponentDomains,
    )
    const isAffected = compositionChanged
      || changedComponentIds.has(firstDomain.componentId)
      || changedComponentIds.has(previousComponentId)
    const preferredX = isAffected
      ? (previousLeft + previousRight - componentWidth) / 2
      : previousLeft
    anchors.set(
      firstDomain.id,
      snapNearest(preferredX, input.metrics.gridSize),
    )
  }
  return anchors
}

function groupDomainsByComponent(domains: LayoutDomain[]): LayoutDomain[][] {
  const groups: LayoutDomain[][] = []
  for (const domain of domains) {
    const current = groups.at(-1)
    if (current?.[0]?.componentId === domain.componentId) current.push(domain)
    else groups.push([domain])
  }
  return groups
}

function collectChangedComponentIds(
  domains: LayoutDomain[],
  units: RootedFamilyUnit[],
  input: PlaceRootDomainsInput,
): Set<string> {
  const changedIds = new Set(input.changedIds ?? [])
  if (changedIds.size === 0) return new Set()
  const componentIdByDomainId = new Map(
    domains.map(domain => [domain.id, domain.componentId]),
  )
  const previousDomains = allPreviousDomains(input)
  for (const domain of previousDomains) {
    componentIdByDomainId.set(domain.id, domain.componentId)
  }
  const changedComponentIds = new Set<string>()
  const addUnitComponent = (unit: RootedFamilyUnit | PlacedFamilyUnit) => {
    if (
      !changedIds.has(unit.id)
      && !unit.memberIds.some(personId => changedIds.has(personId))
    ) return
    const componentId = componentIdByDomainId.get(unit.domainId)
    if (componentId !== undefined) changedComponentIds.add(componentId)
  }
  units.forEach(addUnitComponent)
  input.previousScene?.units.forEach(addUnitComponent)
  return changedComponentIds
}

function sameDomainComposition(
  currentDomains: LayoutDomain[],
  previousDomains: PlacedLayoutDomain[],
): boolean {
  if (currentDomains.length !== previousDomains.length) return false
  const previousById = new Map(previousDomains.map(domain => [domain.id, domain]))
  return currentDomains.every(domain => {
    const previous = previousById.get(domain.id)
    return previous !== undefined && sameIds(previous.unitIds, [...domain.unitIds].sort())
  })
}

function allPreviousDomains(input: PlaceRootDomainsInput): PlacedLayoutDomain[] {
  return [
    ...(input.previousScene?.rootDomains ?? []),
    ...(input.previousScene?.bridgeDomains ?? []),
  ]
}

function findPreviousDomain(
  domain: LayoutDomain,
  input: PlaceRootDomainsInput,
): PlacedLayoutDomain | undefined {
  const previousDomains = allPreviousDomains(input)
  const exact = previousDomains.find(previous => previous.id === domain.id)
  if (exact !== undefined) return exact

  const previousRootIds = domain.rootIds
    .map(rootId => input.previousRootIdByRootId?.[rootId] ?? rootId)
    .sort((left, right) => left.localeCompare(right))
  return previousDomains.find(previous => (
    previous.kind === domain.kind
    && sameIds(previous.rootIds, previousRootIds)
  ))
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort((first, second) => first.localeCompare(second))
  const sortedRight = [...right].sort((first, second) => first.localeCompare(second))
  return sortedLeft.every((value, index) => value === sortedRight[index])
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
  const siblingOrderIndex = buildSiblingOrderIndex(domainEdges)
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
        const explicitSiblingOrder = compareSiblingOrder(
          left,
          right,
          siblingOrderIndex,
          true,
        )
        if (explicitSiblingOrder !== 0) return explicitSiblingOrder
        const leftPreference = preferenceIndex.get(left)
        const rightPreference = preferenceIndex.get(right)
        if (leftPreference !== undefined || rightPreference !== undefined) {
          if (leftPreference === undefined) return 1
          if (rightPreference === undefined) return -1
          if (leftPreference !== rightPreference) return leftPreference - rightPreference
        }
        const automaticSiblingOrder = compareSiblingOrder(
          left,
          right,
          siblingOrderIndex,
          false,
        )
        if (automaticSiblingOrder !== 0) return automaticSiblingOrder
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
        columns: { ...(preference?.columns ?? {}) },
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
): PlacedFamilyUnit[] {
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
    const placed = rowUnits.map((unit, order) => {
      const width = widths[order]
      const placed: PlacedFamilyUnit = {
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
    normalizeRowInsideDomain(placed, domain, input, row.columns)
    return placed
  })
}

function centerParentChildBranches(
  units: PlacedFamilyUnit[],
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
        .filter((unit): unit is PlacedFamilyUnit => unit !== undefined)
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
        .filter((unit): unit is PlacedFamilyUnit => unit !== undefined)
      normalizeRowInsideDomain(rowUnits, domain, input, row.columns)
    }
  }

  for (const unit of units.filter(value => value.isRootFamily)) {
    const row = rowByUnitId.get(unit.id)
    const domain = domainById.get(unit.domainId)
    if (
      row?.unitIds.length !== 1
      || domain === undefined
      || row.columns[unit.id] !== undefined
    ) continue
    unit.rect.x = domain.rect.x + (domain.rect.width - unit.rect.width) / 2
  }
}

function normalizeRowInsideDomain(
  units: PlacedFamilyUnit[],
  domain: PlacedLayoutDomain,
  input: PlaceRootDomainsInput,
  columns: Readonly<Record<string, number>> = {},
): void {
  if (units.length === 0) return
  const minimumX = domain.rect.x + input.metrics.gridSize
  const maximumRight = domain.rect.x + domain.rect.width - input.metrics.gridSize

  if (Object.keys(columns).length > 0) {
    let nextX = minimumX
    for (const unit of units) {
      const column = columns[unit.id]
      const desiredX = column === undefined
        ? nextX
        : minimumX + column * input.metrics.gridSize
      unit.rect.x = snapUp(Math.max(desiredX, nextX), input.metrics.gridSize)
      nextX = unit.rect.x + unit.rect.width + input.metrics.familyGap
    }
    return
  }

  // Keep branch-centering as the desired position, then project the row into
  // the hard domain bounds while preserving order and the minimum family gap.
  let nextX = maximumRight
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]
    const maximumUnitX = nextX - unit.rect.width
    unit.rect.x = snapDown(
      Math.min(unit.rect.x, maximumUnitX),
      input.metrics.gridSize,
    )
    nextX = unit.rect.x - input.metrics.familyGap
  }

  nextX = minimumX
  for (const unit of units) {
    unit.rect.x = snapUp(
      Math.max(unit.rect.x, nextX),
      input.metrics.gridSize,
    )
    nextX = unit.rect.x + unit.rect.width + input.metrics.familyGap
  }
}

function buildParentageEdges(
  groups: ParentageGroup[],
  unitIdByPersonId: ReadonlyMap<string, string>,
): ParentageEdge[] {
  const edgeById = new Map<string, ParentageEdge>()
  for (const group of [...groups].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const [order, childPersonId] of group.childPersonIds.entries()) {
      const childId = unitIdByPersonId.get(childPersonId)
      if (childId === undefined || childId === group.sourceUnitId) continue
      const id = `${group.sourceUnitId}\0${childId}`
      edgeById.set(id, {
        groupId: group.id,
        sourceId: group.sourceUnitId,
        childId,
        order,
        hasExplicitSiblingOrder: group.hasExplicitSiblingOrder === true,
      })
    }
  }
  return [...edgeById.values()].sort((left, right) => (
    left.sourceId.localeCompare(right.sourceId)
    || left.groupId.localeCompare(right.groupId)
    || left.order - right.order
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
    const siblings = childIds.filter(unitId => result.includes(unitId))
    if (siblings.length < 2) continue
    const siblingSet = new Set(siblings)
    const firstIndex = Math.min(...siblings.map(unitId => result.indexOf(unitId)))
    result = result.filter(unitId => !siblingSet.has(unitId))
    result.splice(firstIndex, 0, ...siblings)
  }
  return result
}

interface SiblingOrderEntry {
  groupId: string
  order: number
  hasExplicitSiblingOrder: boolean
}

function buildSiblingOrderIndex(
  edges: ParentageEdge[],
): Map<string, SiblingOrderEntry[]> {
  const result = new Map<string, SiblingOrderEntry[]>()
  for (const edge of edges) {
    const entries = result.get(edge.childId) ?? []
    entries.push({
      groupId: edge.groupId,
      order: edge.order,
      hasExplicitSiblingOrder: edge.hasExplicitSiblingOrder,
    })
    result.set(edge.childId, entries)
  }
  return result
}

function compareSiblingOrder(
  leftId: string,
  rightId: string,
  index: ReadonlyMap<string, SiblingOrderEntry[]>,
  explicitOnly: boolean,
): number {
  const leftEntries = index.get(leftId) ?? []
  const rightEntries = index.get(rightId) ?? []
  for (const left of leftEntries) {
    if (explicitOnly && !left.hasExplicitSiblingOrder) continue
    const right = rightEntries.find(entry => entry.groupId === left.groupId)
    if (right === undefined) continue
    if (explicitOnly && !right.hasExplicitSiblingOrder) continue
    if (left.order !== right.order) return left.order - right.order
  }
  return 0
}

function siblingBlocks(unitIds: string[], edges: ParentageEdge[]): string[][] {
  const parentByUnitId = new Map(unitIds.map(unitId => [unitId, unitId]))
  const findRoot = (unitId: string): string => {
    const parentId = parentByUnitId.get(unitId) ?? unitId
    if (parentId === unitId) return unitId
    const rootId = findRoot(parentId)
    parentByUnitId.set(unitId, rootId)
    return rootId
  }
  const union = (leftId: string, rightId: string): void => {
    const leftRootId = findRoot(leftId)
    const rightRootId = findRoot(rightId)
    if (leftRootId === rightRootId) return
    parentByUnitId.set(rightRootId, leftRootId)
  }

  for (const childIds of childrenBySource(edges).values()) {
    const rowChildren = childIds.filter(unitId => unitIds.includes(unitId))
    if (rowChildren.length < 2) continue
    for (let index = 1; index < rowChildren.length; index += 1) {
      union(rowChildren[0], rowChildren[index])
    }
  }
  const blocksByRootId = new Map<string, string[]>()
  for (const unitId of unitIds) {
    const rootId = findRoot(unitId)
    const block = blocksByRootId.get(rootId) ?? []
    block.push(unitId)
    blocksByRootId.set(rootId, block)
  }
  return [...blocksByRootId.values()]
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

function centerX(unit: PlacedFamilyUnit): number {
  return unit.rect.x + unit.rect.width / 2
}

function snapUp(value: number, gridSize: number): number {
  return Math.ceil(value / gridSize) * gridSize
}

function snapDown(value: number, gridSize: number): number {
  return Math.floor(value / gridSize) * gridSize
}

function snapNearest(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}
