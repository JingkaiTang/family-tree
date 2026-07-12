import type {
  FamilyUnit,
  LayoutDiagnostic,
  LayoutMetrics,
  ParentageGroup,
  PlacedPersonCard,
  Point,
  Rect,
  RouteFamilyLanesResult,
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
  childClearanceTop: number
  minX: number
  maxX: number
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
  const hubsByUnitId = new Map(input.geometry.hubs.map(hub => [hub.unitId, hub]))
  const cardsById = new Map(input.geometry.cards.map(card => [card.id, card]))
  const requests: RouteRequest[] = []

  for (const group of [...input.parentageGroups].sort(compareById)) {
    const sourceUnit = unitsById.get(group.sourceUnitId)
    const placedSource = placedUnitsById.get(group.sourceUnitId)
    const sourceHub = hubsByUnitId.get(group.sourceUnitId)
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
    requests.push({
      group,
      sourceUnit,
      sourceHub: sourceHub.point,
      children,
      childPorts,
      parentBottom: placedSource.rect.y + placedSource.rect.height,
      childClearanceTop: Math.min(...children.map(child => (
        child.rect.y - input.metrics.cardClearance
      ))),
      minX: Math.min(...childPorts.map(point => point.x)),
      maxX: Math.max(...childPorts.map(point => point.x)),
    })
  }

  requests.sort((left, right) => (
    (right.maxX - right.minX) - (left.maxX - left.minX)
    || left.group.id.localeCompare(right.group.id)
  ))
  const horizontalOccupancyByY = new Map<number, LaneOccupancy>()
  const verticalOccupancy: VerticalOccupancy[] = []
  const rawRoutes: RoutedFamilyEdge[] = []

  for (const request of requests) {
    let acceptedRoute: RoutedFamilyEdge | undefined
    const lastLaneIndex = maximumLaneIndex(request, input.metrics)
    for (let laneIndex = 0; laneIndex <= lastLaneIndex; laneIndex++) {
      const laneY = request.parentBottom
        + input.metrics.routeSubgrid * (laneIndex + 2)
      if (childBusConflictsAtY(request, laneY, horizontalOccupancyByY)) continue
      const verticalOccupancyStart = verticalOccupancy.length
      const candidate = buildRoute(request, laneY, verticalOccupancy, input.metrics)
      const blocked = horizontalFootprintConflicts(candidate, horizontalOccupancyByY)
        || routeIntersectsObstacle(candidate, request, input.geometry, input.metrics)
      if (blocked) {
        verticalOccupancy.length = verticalOccupancyStart
        continue
      }
      registerHorizontalFootprint(candidate, horizontalOccupancyByY)
      acceptedRoute = candidate
      break
    }
    if (acceptedRoute === undefined) diagnostics.push(unroutable(request.group.id))
    else rawRoutes.push(acceptedRoute)
  }

  const routes = addCrossingBridges(rawRoutes, input.metrics.routeSubgrid)
    .sort((left, right) => left.routeOwnerId.localeCompare(right.routeOwnerId))
  diagnostics.sort((left, right) => left.ids.join('+').localeCompare(right.ids.join('+')))
  return { routes, diagnostics }
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
    request.minX,
    request.maxX,
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
    segments.push(horizontal(request.minX, request.maxX, laneY))
    if (sourceVertical.x < request.minX || sourceVertical.x > request.maxX) {
      segments.push(horizontal(
        sourceVertical.x,
        Math.max(request.minX, Math.min(request.maxX, sourceVertical.x)),
        laneY,
      ))
    }
    for (const childVertical of childVerticals) {
      if (childVertical.x >= request.minX && childVertical.x <= request.maxX) continue
      segments.push(horizontal(
        childVertical.x,
        Math.max(request.minX, Math.min(request.maxX, childVertical.x)),
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
    && positiveOverlap(minY, maxY, vertical.minY, vertical.maxY)
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

function positiveOverlap(leftMin: number, leftMax: number, rightMin: number, rightMax: number): boolean {
  return Math.max(leftMin, rightMin) < Math.min(leftMax, rightMax)
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
