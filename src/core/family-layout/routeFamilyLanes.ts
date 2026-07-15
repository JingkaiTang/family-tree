import type {
  FamilyUnit,
  LayoutDiagnostic,
  LayoutMetrics,
  ParentageGroup,
  PlacedLayoutDomain,
  PlacedPersonCard,
  Point,
  Rect,
  RouteFamilyLanesResult,
  RouteGateway,
  RoutedFamilyEdge,
  RouteSegment,
  SceneGeometry,
} from './types'

export interface RouteFamilyLanesInput {
  geometry: SceneGeometry
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  metrics: LayoutMetrics
}

interface LaneOccupancy {
  y: number
  intervals: Array<{ minX: number; maxX: number; routeOwnerId: string }>
}

interface RouteRequest {
  group: ParentageGroup
  sourceUnit: FamilyUnit
  sourceHub: Point
  children: PlacedPersonCard[]
  childPorts: Point[]
  parentBottom: number
  sourceMinX: number
  sourceMaxX: number
  childClearanceTop: number
  minX: number
  maxX: number
  sourceDomainId?: string
  targetDomainId?: string
  gatewaySlotIndex?: number
  gatewaySlotCount?: number
}

interface VerticalOccupancy {
  x: number
  minY: number
  maxY: number
  routeOwnerId: string
}

export function routeFamilyLanes(input: RouteFamilyLanesInput): RouteFamilyLanesResult {
  const diagnostics: LayoutDiagnostic[] = []
  const unitsById = new Map(input.units.map(unit => [unit.id, unit]))
  const placedUnitsById = new Map(input.geometry.units.map(unit => [unit.id, unit]))
  const hubsById = new Map(input.geometry.hubs.map(hub => [hub.id, hub]))
  const cardsById = new Map(input.geometry.cards.map(card => [card.id, card]))
  const rootedGeometry = input.geometry
  const domainById = new Map(
    [...rootedGeometry.rootDomains, ...rootedGeometry.bridgeDomains]
      .map(domain => [domain.id, domain] as const),
  )
  const requests: RouteRequest[] = []

  for (const group of [...input.parentageGroups].sort(compareById)) {
    const sourceUnit = unitsById.get(group.sourceUnitId)
    const placedSource = placedUnitsById.get(group.sourceUnitId)
    const sourceHub = hubsById.get(group.sourceHubId ?? `hub:${group.sourceUnitId}`)
    const children = group.childPersonIds
      .map(childId => cardsById.get(childId))
      .filter((card): card is PlacedPersonCard => card !== undefined)
      .sort((left, right) => left.rect.x - right.rect.x || left.id.localeCompare(right.id))
    if (
      sourceUnit === undefined
      || placedSource === undefined
      || sourceHub === undefined
      || children.length !== group.childPersonIds.length
      || children.length === 0
    ) {
      diagnostics.push(unroutable(group.id))
      continue
    }
    const childPorts = children.map(child => topPort(child.rect))
    const sourceDomainId = placedUnitDomainId(placedSource)
    const targetDomainIds = [...new Set(children.flatMap(child => {
      const childUnit = placedUnitsById.get(child.unitId)
      const domainId = childUnit === undefined ? undefined : placedUnitDomainId(childUnit)
      return domainId === undefined ? [] : [domainId]
    }))]
    if (
      sourceDomainId === undefined
      || targetDomainIds.length === 0
      || !domainById.has(sourceDomainId)
      || targetDomainIds.some(domainId => !domainById.has(domainId))
    ) {
      diagnostics.push(unroutable(group.id))
      continue
    }
    requests.push({
      group,
      sourceUnit,
      sourceHub: sourceHub.point,
      children,
      childPorts,
      parentBottom: placedSource.rect.y + placedSource.rect.height,
      sourceMinX: placedSource.rect.x,
      sourceMaxX: placedSource.rect.x + placedSource.rect.width,
      childClearanceTop: Math.min(...children.map(child => (
        child.rect.y - input.metrics.cardClearance
      ))),
      minX: Math.min(...childPorts.map(point => point.x)),
      maxX: Math.max(...childPorts.map(point => point.x)),
      sourceDomainId,
      targetDomainId: targetDomainIds.length === 1
        ? targetDomainIds[0]
        : undefined,
    })
  }

  assignGatewaySlots(requests, domainById)
  requests.sort((left, right) => (
    (right.maxX - right.minX) - (left.maxX - left.minX)
    || left.group.id.localeCompare(right.group.id)
  ))
  const horizontalOccupancyByY = new Map<number, LaneOccupancy>()
  const verticalOccupancy: VerticalOccupancy[] = []
  const rawRoutes: RoutedFamilyEdge[] = []
  const gateways: RouteGateway[] = []

  for (const request of requests) {
    let acceptedRoute: RoutedFamilyEdge | undefined
    let acceptedGateways: RouteGateway[] = []
    const lastLaneIndex = maximumLaneIndex(request, input.metrics)
    const firstLaneIndex = request.gatewaySlotIndex ?? 0
    const laneStride = request.gatewaySlotCount ?? 1
    for (
      let laneIndex = firstLaneIndex;
      laneIndex <= lastLaneIndex;
      laneIndex += laneStride
    ) {
      const laneY = request.parentBottom
        + input.metrics.routeSubgrid * (laneIndex + 2)
      if (childBusConflictsAtY(request, laneY, horizontalOccupancyByY)) continue
      const verticalOccupancyStart = verticalOccupancy.length
      const routedCandidate = request.sourceDomainId !== undefined
        && request.targetDomainId !== undefined
        && request.sourceDomainId !== request.targetDomainId
        ? buildCrossDomainRoute(
            request,
            laneY,
            verticalOccupancy,
            input.metrics,
            domainById,
          )
        : { route: buildRoute(request, laneY, verticalOccupancy, input.metrics), gateways: [] }
      const candidate = routedCandidate.route
      const blocked = horizontalFootprintConflicts(candidate, horizontalOccupancyByY)
        || routeConflictsWithAccepted(candidate, rawRoutes)
        || routeIntersectsObstacle(candidate, request, input.geometry, input.metrics)
      if (blocked) {
        verticalOccupancy.length = verticalOccupancyStart
        continue
      }
      registerHorizontalFootprint(candidate, horizontalOccupancyByY)
      acceptedRoute = candidate
      acceptedGateways = routedCandidate.gateways
      break
    }
    if (acceptedRoute === undefined) diagnostics.push(unroutable(request.group.id))
    else rawRoutes.push({
      ...acceptedRoute,
      segments: (acceptedRoute.gatewayIds?.length ?? 0) > 0
        ? acceptedRoute.segments
        : coalesceHorizontalSegments(acceptedRoute.segments),
    })
    if (acceptedRoute !== undefined) gateways.push(...acceptedGateways)
  }

  const routes = addCrossingBridges(rawRoutes, input.metrics.routeSubgrid)
    .sort((left, right) => left.routeOwnerId.localeCompare(right.routeOwnerId))
  diagnostics.sort((left, right) => left.ids.join('+').localeCompare(right.ids.join('+')))
  return {
    routes,
    gateways: gateways.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics,
  }
}

function assignGatewaySlots(
  requests: RouteRequest[],
  domainById: ReadonlyMap<string, PlacedLayoutDomain>,
): void {
  const requestsByBoundaryPair = new Map<string, RouteRequest[]>()
  for (const request of requests) {
    if (
      request.sourceDomainId === undefined
      || request.targetDomainId === undefined
      || request.sourceDomainId === request.targetDomainId
    ) continue
    const sourceDomain = domainById.get(request.sourceDomainId)
    const targetDomain = domainById.get(request.targetDomainId)
    if (sourceDomain === undefined || targetDomain === undefined) continue
    const targetIsRight = rectCenterX(targetDomain.rect) > rectCenterX(sourceDomain.rect)
    const sourceSide = targetIsRight ? 'right' : 'left'
    const targetSide = targetIsRight ? 'left' : 'right'
    const key = [
      `${sourceDomain.id}:${sourceSide}`,
      `${targetDomain.id}:${targetSide}`,
      request.parentBottom,
      request.childClearanceTop,
    ].join('|')
    const grouped = requestsByBoundaryPair.get(key) ?? []
    grouped.push(request)
    requestsByBoundaryPair.set(key, grouped)
  }
  for (const grouped of requestsByBoundaryPair.values()) {
    grouped.sort((left, right) => left.group.id.localeCompare(right.group.id))
    grouped.forEach((request, index) => {
      request.gatewaySlotIndex = index
      request.gatewaySlotCount = grouped.length
    })
  }
}

function coalesceHorizontalSegments(segments: RouteSegment[]): RouteSegment[] {
  const grouped = new Map<number, Array<[number, number]>>()
  for (const segment of segments) {
    if (segment.orientation !== 'horizontal') continue
    const [start, end] = segment.points
    const intervals = grouped.get(start.y) ?? []
    intervals.push([Math.min(start.x, end.x), Math.max(start.x, end.x)])
    grouped.set(start.y, intervals)
  }

  const mergedByY = new Map<number, RouteSegment[]>()
  for (const [y, intervals] of grouped) {
    const merged: Array<[number, number]> = []
    for (const interval of intervals.sort((left, right) => left[0] - right[0])) {
      const previous = merged.at(-1)
      if (previous === undefined || interval[0] > previous[1]) merged.push([...interval])
      else previous[1] = Math.max(previous[1], interval[1])
    }
    mergedByY.set(y, merged.map(([start, end]) => horizontal(start, end, y)))
  }

  const emittedYs = new Set<number>()
  return segments.flatMap(segment => {
    if (segment.orientation !== 'horizontal') return [segment]
    const y = segment.points[0].y
    if (emittedYs.has(y)) return []
    emittedYs.add(y)
    return mergedByY.get(y) ?? []
  })
}

function maximumLaneIndex(
  request: RouteRequest,
  metrics: LayoutMetrics,
): number {
  return Math.floor(
    (request.childClearanceTop - request.parentBottom) / metrics.routeSubgrid,
  ) - 2
}

function childBusConflictsAtY(
  request: RouteRequest,
  y: number,
  occupancyByY: Map<number, LaneOccupancy>,
): boolean {
  if (request.childPorts.length <= 1) return false
  return occupancyByY.get(y)?.intervals.some(interval => (
    interval.routeOwnerId !== request.group.id
    && intervalsOverlapOrTouch(
      request.minX,
      request.maxX,
      interval.minX,
      interval.maxX,
    )
  )) ?? false
}

function horizontalFootprintConflicts(
  route: RoutedFamilyEdge,
  occupancyByY: Map<number, LaneOccupancy>,
): boolean {
  return horizontalFootprint(route).some(interval => (
    occupancyByY.get(interval.y)?.intervals.some(occupied => (
      occupied.routeOwnerId !== route.routeOwnerId
      && intervalsOverlapOrTouch(
        interval.minX,
        interval.maxX,
        occupied.minX,
        occupied.maxX,
      )
    )) ?? false
  ))
}

function routeConflictsWithAccepted(
  candidate: RoutedFamilyEdge,
  acceptedRoutes: RoutedFamilyEdge[],
): boolean {
  return acceptedRoutes.some(accepted => candidate.segments.some(candidateSegment => (
    accepted.segments.some(acceptedSegment => (
      segmentsShareOwnedGeometry(candidateSegment, acceptedSegment)
    ))
  )))
}

function segmentsShareOwnedGeometry(
  left: RouteSegment,
  right: RouteSegment,
): boolean {
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const [leftStart, leftEnd] = left.points
  const [rightStart, rightEnd] = right.points
  if (left.orientation === right.orientation) {
    const sharesPositiveLength = left.orientation === 'horizontal'
      ? leftStart.y === rightStart.y && intervalsHavePositiveOverlap(
          leftStart.x,
          leftEnd.x,
          rightStart.x,
          rightEnd.x,
        )
      : leftStart.x === rightStart.x && intervalsHavePositiveOverlap(
          leftStart.y,
          leftEnd.y,
          rightStart.y,
          rightEnd.y,
        )
    if (sharesPositiveLength) return true
  }
  const leftEndpoints = [leftStart, leftEnd]
  const rightEndpoints = [rightStart, rightEnd]
  return leftEndpoints.some(leftPoint => rightEndpoints.some(rightPoint => (
    samePoint(leftPoint, rightPoint)
  ))) || leftEndpoints.some(point => (
    pointStrictlyInsideSegment(point, rightStart, rightEnd)
  )) || rightEndpoints.some(point => (
    pointStrictlyInsideSegment(point, leftStart, leftEnd)
  ))
}

function registerHorizontalFootprint(
  route: RoutedFamilyEdge,
  occupancyByY: Map<number, LaneOccupancy>,
) {
  for (const interval of horizontalFootprint(route)) {
    const occupancy = occupancyByY.get(interval.y) ?? { y: interval.y, intervals: [] }
    if (!occupancyByY.has(interval.y)) occupancyByY.set(interval.y, occupancy)
    occupancy.intervals.push({
      minX: interval.minX,
      maxX: interval.maxX,
      routeOwnerId: route.routeOwnerId,
    })
  }
}

function horizontalFootprint(route: RoutedFamilyEdge): Array<{
  y: number
  minX: number
  maxX: number
}> {
  return route.segments.flatMap(segment => {
    if (segment.orientation !== 'horizontal') return []
    const [start, end] = segment.points
    return [{
      y: start.y,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
    }]
  })
}

function buildRoute(
  request: RouteRequest,
  laneY: number,
  occupancy: VerticalOccupancy[],
  metrics: LayoutMetrics,
): RoutedFamilyEdge {
  const segments: RouteSegment[] = []
  const sourceVertical = allocateVertical(
    request.sourceHub,
    { x: request.sourceHub.x, y: laneY },
    request.group.id,
    occupancy,
    metrics.routeSubgrid,
    request.sourceMinX,
    request.sourceMaxX,
    true,
    false,
  )
  segments.push(...sourceVertical.segments)
  const childVerticals = request.childPorts.map(childPort => allocateVertical(
    { x: childPort.x, y: laneY },
    childPort,
    request.group.id,
    occupancy,
    metrics.routeSubgrid,
    request.minX,
    request.maxX,
    false,
    true,
  ))
  if (request.childPorts.length > 1) {
    const busMinX = Math.min(...childVerticals.map(value => value.x))
    const busMaxX = Math.max(...childVerticals.map(value => value.x))
    segments.push(horizontal(busMinX, busMaxX, laneY))
    if (sourceVertical.x < busMinX || sourceVertical.x > busMaxX) {
      segments.push(horizontal(
        sourceVertical.x,
        Math.max(busMinX, Math.min(busMaxX, sourceVertical.x)),
        laneY,
      ))
    }
  } else if (sourceVertical.x !== childVerticals[0].x) {
    segments.push(horizontal(sourceVertical.x, childVerticals[0].x, laneY))
  }
  childVerticals.forEach(value => segments.push(...value.segments))
  return {
    id: `route:${request.group.id}`,
    routeOwnerId: request.group.id,
    kind: 'primary',
    accent: request.sourceUnit.accent,
    segments: segments.filter(segment => !zeroLength(segment)),
    gatewayIds: [],
  }
}

function buildCrossDomainRoute(
  request: RouteRequest,
  laneY: number,
  occupancy: VerticalOccupancy[],
  metrics: LayoutMetrics,
  domainById: ReadonlyMap<string, PlacedLayoutDomain>,
): { route: RoutedFamilyEdge; gateways: RouteGateway[] } {
  const sourceDomain = domainById.get(request.sourceDomainId ?? '')
  const targetDomain = domainById.get(request.targetDomainId ?? '')
  if (sourceDomain === undefined || targetDomain === undefined) {
    return {
      route: buildRoute(request, laneY, occupancy, metrics),
      gateways: [],
    }
  }
  const targetIsRight = rectCenterX(targetDomain.rect) > rectCenterX(sourceDomain.rect)
  const sourceSide = targetIsRight ? 'right' as const : 'left' as const
  const targetSide = targetIsRight ? 'left' as const : 'right' as const
  const sourceGateway = gatewayAt(
    sourceDomain,
    sourceSide,
    laneY,
    request.group.id,
  )
  const targetGateway = gatewayAt(
    targetDomain,
    targetSide,
    laneY,
    request.group.id,
  )
  const segments: RouteSegment[] = []
  const sourceVertical = allocateVertical(
    request.sourceHub,
    { x: request.sourceHub.x, y: laneY },
    request.group.id,
    occupancy,
    metrics.routeSubgrid,
    request.sourceMinX,
    request.sourceMaxX,
    true,
    false,
  )
  segments.push(...sourceVertical.segments)
  if (sourceVertical.x !== sourceGateway.point.x) {
    segments.push(horizontal(sourceVertical.x, sourceGateway.point.x, laneY))
  }
  if (sourceGateway.point.x !== targetGateway.point.x) {
    segments.push(horizontal(sourceGateway.point.x, targetGateway.point.x, laneY))
  }
  const childVerticals = request.childPorts.map(childPort => allocateVertical(
    { x: childPort.x, y: laneY },
    childPort,
    request.group.id,
    occupancy,
    metrics.routeSubgrid,
    request.minX,
    request.maxX,
    false,
    true,
  ))
  const busMinX = Math.min(...childVerticals.map(value => value.x))
  const busMaxX = Math.max(...childVerticals.map(value => value.x))
  if (request.childPorts.length > 1) {
    segments.push(horizontal(busMinX, busMaxX, laneY))
  }
  const targetConnectionX = Math.max(
    busMinX,
    Math.min(busMaxX, targetGateway.point.x),
  )
  if (targetGateway.point.x !== targetConnectionX) {
    segments.push(horizontal(targetGateway.point.x, targetConnectionX, laneY))
  } else if (request.childPorts.length === 1 && targetGateway.point.x !== busMinX) {
    segments.push(horizontal(targetGateway.point.x, busMinX, laneY))
  }
  childVerticals.forEach(value => segments.push(...value.segments))
  const gatewayIds = [sourceGateway.id, targetGateway.id]

  return {
    route: {
      id: `route:${request.group.id}`,
      routeOwnerId: request.group.id,
      kind: 'primary',
      accent: request.sourceUnit.accent,
      segments: segments.filter(segment => !zeroLength(segment)),
      gatewayIds,
    },
    gateways: [sourceGateway, targetGateway],
  }
}

function gatewayAt(
  domain: PlacedLayoutDomain,
  side: 'left' | 'right',
  y: number,
  routeOwnerId: string,
): RouteGateway {
  return {
    id: `gateway:${domain.id}:${side}:${routeOwnerId}`,
    domainId: domain.id,
    side,
    point: {
      x: side === 'left' ? domain.rect.x : domain.rect.x + domain.rect.width,
      y,
    },
    routeOwnerId,
  }
}

function allocateVertical(
  start: Point,
  end: Point,
  routeOwnerId: string,
  occupancy: VerticalOccupancy[],
  routeSubgrid: number,
  connectionMinX: number,
  connectionMaxX: number,
  exactStart: boolean,
  exactEnd: boolean,
): { x: number; segments: RouteSegment[] } {
  const minY = Math.min(start.y, end.y)
  const maxY = Math.max(start.y, end.y)
  const x = allocateVerticalX(
    start.x,
    minY,
    maxY,
    routeOwnerId,
    occupancy,
    routeSubgrid,
    connectionMinX,
    connectionMaxX,
  )
  occupancy.push({ x, minY, maxY, routeOwnerId })
  const segments: RouteSegment[] = []
  if (exactStart && x !== start.x) segments.push(horizontal(start.x, x, start.y))
  segments.push(vertical(x, start.y, end.y))
  if (exactEnd && x !== end.x) segments.push(horizontal(x, end.x, end.y))
  return { x, segments }
}

function allocateVerticalX(
  desiredX: number,
  minY: number,
  maxY: number,
  routeOwnerId: string,
  occupancy: VerticalOccupancy[],
  routeSubgrid: number,
  connectionMinX: number,
  connectionMaxX: number,
): number {
  const conflictsAt = (x: number) => occupancy.some(vertical => (
    vertical.routeOwnerId !== routeOwnerId
    && vertical.x === x
    && intervalsOverlapOrTouch(minY, maxY, vertical.minY, vertical.maxY)
  ))
  if (!conflictsAt(desiredX)) return desiredX

  const offsets = [0]
  for (let step = 1; step <= occupancy.length + 1; step++) {
    offsets.push(step * routeSubgrid, -step * routeSubgrid)
  }
  offsets.sort((left, right) => {
    const leftInside = desiredX + left >= connectionMinX && desiredX + left <= connectionMaxX
    const rightInside = desiredX + right >= connectionMinX && desiredX + right <= connectionMaxX
    return Number(rightInside) - Number(leftInside)
      || Math.abs(left) - Math.abs(right)
      || right - left
  })
  return desiredX + offsets.find(offset => !conflictsAt(desiredX + offset))!
}

function addCrossingBridges(
  routes: RoutedFamilyEdge[],
  routeSubgrid: number,
): RoutedFamilyEdge[] {
  return routes.map(route => ({
    ...route,
    segments: route.segments.flatMap(segment => {
      if (segment.orientation !== 'horizontal') return [segment]
      const [start, end] = segment.points
      const crossingXs = routes.flatMap(other => (
        other.routeOwnerId === route.routeOwnerId
          ? []
          : other.segments.flatMap(otherSegment => {
              if (otherSegment.orientation !== 'vertical') return []
              const [verticalStart, verticalEnd] = otherSegment.points
              return pointStrictlyInsideSegment(
                { x: verticalStart.x, y: start.y },
                start,
                end,
              ) && pointStrictlyInsideSegment(
                { x: verticalStart.x, y: start.y },
                verticalStart,
                verticalEnd,
              ) ? [verticalStart.x] : []
            })
      ))
      const protectedXs = route.segments
        .filter(otherSegment => otherSegment !== segment)
        .flatMap(otherSegment => [
          otherSegment.points[0],
          otherSegment.points.at(-1)!,
        ])
        .filter(point => point.y === start.y && pointStrictlyInsideSegment(point, start, end))
        .map(point => point.x)
      return bridgeHorizontal(
        segment,
        [...new Set(crossingXs)],
        [...new Set(protectedXs)],
        routeSubgrid,
      )
    }),
  }))
}

function bridgeHorizontal(
  segment: RouteSegment,
  crossingXs: number[],
  protectedXs: number[],
  routeSubgrid: number,
): RouteSegment[] {
  if (crossingXs.length === 0) return [segment]
  const [start, end] = segment.points
  const minX = Math.min(start.x, end.x)
  const maxX = Math.max(start.x, end.x)
  const crossings = crossingXs
    .filter(x => x > minX && x < maxX)
    .sort((left, right) => left - right)
  if (crossings.length === 0) return [segment]
  const ascending: RouteSegment[] = []
  let cursor = minX
  for (const [index, x] of crossings.entries()) {
    const radius = Math.min(
      routeSubgrid / 2,
      x - minX,
      maxX - x,
      index === 0 ? Number.POSITIVE_INFINITY : (x - crossings[index - 1]) / 2,
      index === crossings.length - 1
        ? Number.POSITIVE_INFINITY
        : (crossings[index + 1] - x) / 2,
      ...protectedXs
        .map(protectedX => Math.abs(protectedX - x))
        .filter(distance => distance > 0),
    )
    if (cursor < x - radius) ascending.push(horizontal(cursor, x - radius, start.y))
    ascending.push({
      orientation: 'bridge',
      points: [
        { x: x - radius, y: start.y },
        { x, y: start.y - radius },
        { x: x + radius, y: start.y },
      ],
    })
    cursor = x + radius
  }
  if (cursor < maxX) ascending.push(horizontal(cursor, maxX, start.y))
  if (start.x <= end.x) return ascending
  return ascending.reverse().map(value => ({ ...value, points: [...value.points].reverse() }))
}

function routeIntersectsObstacle(
  route: RoutedFamilyEdge,
  request: RouteRequest,
  geometry: SceneGeometry,
  metrics: LayoutMetrics,
): boolean {
  const ownCardIds = new Set([
    ...request.sourceUnit.memberIds,
    ...request.group.childPersonIds,
  ])
  const ownUnitIds = new Set([
    request.group.sourceUnitId,
    ...request.children.map(child => child.unitId),
  ])
  const cardObstacles = geometry.cards
    .filter(card => !ownCardIds.has(card.id))
    .map(card => expandRect(card.rect, metrics.cardClearance))
  const unitObstacles = geometry.units
    .filter(unit => !ownUnitIds.has(unit.id))
    .map(unit => expandRect(unit.rect, metrics.cardClearance))
  return route.segments.some(segment => (
    [...cardObstacles, ...unitObstacles].some(rect => segmentIntersectsRect(segment, rect))
  ))
}

function segmentIntersectsRect(segment: RouteSegment, rect: Rect): boolean {
  for (let index = 1; index < segment.points.length; index++) {
    const start = segment.points[index - 1]
    const end = segment.points[index]
    if (
      Math.max(start.x, end.x) > rect.x
      && Math.min(start.x, end.x) < rect.x + rect.width
      && Math.max(start.y, end.y) > rect.y
      && Math.min(start.y, end.y) < rect.y + rect.height
    ) return true
  }
  return false
}

function topPort(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y }
}

function expandRect(rect: Rect, clearance: number): Rect {
  return {
    x: rect.x - clearance,
    y: rect.y - clearance,
    width: rect.width + clearance * 2,
    height: rect.height + clearance * 2,
  }
}

function horizontal(fromX: number, toX: number, y: number): RouteSegment {
  return { orientation: 'horizontal', points: [{ x: fromX, y }, { x: toX, y }] }
}

function vertical(x: number, fromY: number, toY: number): RouteSegment {
  return { orientation: 'vertical', points: [{ x, y: fromY }, { x, y: toY }] }
}

function zeroLength(segment: RouteSegment): boolean {
  const [start, end] = segment.points
  return start.x === end.x && start.y === end.y
}

function intervalsOverlapOrTouch(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
): boolean {
  return leftMin <= rightMax && rightMin <= leftMax
}

function intervalsHavePositiveOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd))
    < Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd))
}

function pointStrictlyInsideSegment(point: Point, start: Point, end: Point): boolean {
  if (start.x === end.x) {
    return point.x === start.x
      && point.y > Math.min(start.y, end.y)
      && point.y < Math.max(start.y, end.y)
  }
  return point.y === start.y
    && point.x > Math.min(start.x, end.x)
    && point.x < Math.max(start.x, end.x)
}

function unroutable(groupId: string): LayoutDiagnostic {
  return {
    code: 'UNROUTABLE_PRIMARY_EDGE',
    ids: [groupId],
    message: `Unable to route primary family edge ${groupId}`,
  }
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

function placedUnitDomainId(unit: object): string | undefined {
  return 'domainId' in unit && typeof unit.domainId === 'string'
    ? unit.domainId
    : undefined
}

function rectCenterX(rect: Rect): number {
  return rect.x + rect.width / 2
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y
}
