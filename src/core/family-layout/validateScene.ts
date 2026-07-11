import type {
  LayoutDiagnostic,
  LayoutMetrics,
  LayoutScene,
  Point,
  Rect,
  RoutedFamilyEdge,
  RouteSegment,
} from './types'

export function validateScene(scene: LayoutScene, metrics: LayoutMetrics): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = []
  forEachOverlap(scene.cards, (left, right) => diagnostics.push({
    code: 'NODE_OVERLAP',
    ids: sortedIds(left.id, right.id),
    message: `Person cards ${sortedIds(left.id, right.id).join(' and ')} overlap`,
  }))
  forEachOverlap(scene.units, (left, right) => diagnostics.push({
    code: 'NODE_OVERLAP',
    ids: sortedIds(left.id, right.id),
    message: `Family units ${sortedIds(left.id, right.id).join(' and ')} overlap`,
  }))

  for (let leftIndex = 0; leftIndex < scene.routes.length; leftIndex++) {
    const left = scene.routes[leftIndex]
    validateRouteTerminals(left, scene, diagnostics)
    validateRouteObstacles(left, scene, metrics, diagnostics)
    for (let rightIndex = leftIndex + 1; rightIndex < scene.routes.length; rightIndex++) {
      const right = scene.routes[rightIndex]
      if (left.routeOwnerId === right.routeOwnerId) continue
      validateRoutePair(left, right, diagnostics)
    }
  }
  return deduplicate(diagnostics).sort((left, right) => (
    left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
  ))
}

function validateRouteTerminals(
  route: RoutedFamilyEdge,
  scene: LayoutScene,
  diagnostics: LayoutDiagnostic[],
) {
  const leaves = routeLeaves(route)
  const graphIsConnected = route.segments.length > 0 && connectedSegments(route.segments)
  const hubPoints = scene.hubs.map(hub => hub.point)
  const cardPorts = scene.cards.map(card => topPort(card.rect))
  const hubLeaves = leaves.filter(point => hubPoints.some(hub => samePoint(point, hub)))
  const cardLeaves = leaves.filter(point => cardPorts.some(port => samePoint(point, port)))
  if (!graphIsConnected) diagnostics.push({
    code: 'UNROUTABLE_PRIMARY_EDGE',
    ids: [route.routeOwnerId],
    message: `Route ${route.routeOwnerId} is disconnected`,
  })
  if (
    hubLeaves.length !== 1
    || cardLeaves.length === 0
    || leaves.some(point => (
      !hubPoints.some(hub => samePoint(point, hub))
      && !cardPorts.some(port => samePoint(point, port))
    ))
  ) diagnostics.push({
    code: 'UNROUTABLE_PRIMARY_EDGE',
    ids: [route.routeOwnerId],
    message: `Route ${route.routeOwnerId} has dangling or mismatched endpoints`,
  })
}

function validateRouteObstacles(
  route: RoutedFamilyEdge,
  scene: LayoutScene,
  metrics: LayoutMetrics,
  diagnostics: LayoutDiagnostic[],
) {
  const leaves = routeLeaves(route)
  const sourceUnitIds = new Set(scene.hubs
    .filter(hub => leaves.some(point => samePoint(point, hub.point)))
    .map(hub => hub.unitId))
  const targetCardIds = new Set(scene.cards
    .filter(card => leaves.some(point => samePoint(point, topPort(card.rect))))
    .map(card => card.id))
  const targetUnitIds = new Set(scene.cards
    .filter(card => targetCardIds.has(card.id))
    .map(card => card.unitId))
  const sourceCardIds = new Set(scene.cards
    .filter(card => sourceUnitIds.has(card.unitId))
    .map(card => card.id))

  for (const card of scene.cards) {
    if (targetCardIds.has(card.id) || sourceCardIds.has(card.id)) continue
    const obstacle = expandRect(card.rect, metrics.cardClearance)
    if (!route.segments.some(segment => segmentIntersectsRect(segment, obstacle))) continue
    diagnostics.push({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: sortedIds(card.id, route.routeOwnerId),
      message: `Route ${route.routeOwnerId} intersects card ${card.id}`,
    })
  }
  for (const unit of scene.units) {
    if (sourceUnitIds.has(unit.id) || targetUnitIds.has(unit.id)) continue
    const obstacle = expandRect(unit.rect, metrics.cardClearance)
    if (!route.segments.some(segment => segmentIntersectsRect(segment, obstacle))) continue
    diagnostics.push({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: sortedIds(route.routeOwnerId, unit.id),
      message: `Route ${route.routeOwnerId} intersects family unit ${unit.id}`,
    })
  }
}

function validateRoutePair(
  left: RoutedFamilyEdge,
  right: RoutedFamilyEdge,
  diagnostics: LayoutDiagnostic[],
) {
  const ids = sortedIds(left.routeOwnerId, right.routeOwnerId)
  if (left.segments.some(leftSegment => right.segments.some(rightSegment => (
    positiveCollinearOverlap(leftSegment, rightSegment)
  )))) diagnostics.push({
    code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
    ids,
    message: `Routes ${ids.join(' and ')} share a collinear segment`,
  })
  if (left.segments.some(leftSegment => right.segments.some(rightSegment => (
    falseTJunction(leftSegment, rightSegment)
  )))) diagnostics.push({
    code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
    ids,
    message: `Routes ${ids.join(' and ')} form a false T-junction`,
  })
  if (left.segments.some(leftSegment => right.segments.some(rightSegment => (
    perpendicularInteriorCross(leftSegment, rightSegment)
  )))) diagnostics.push({
    code: 'UNROUTABLE_PRIMARY_EDGE',
    ids,
    message: `Routes ${ids.join(' and ')} cross without a bridge`,
  })
}

function routeLeaves(route: RoutedFamilyEdge): Point[] {
  const endpoints = route.segments.flatMap(segment => [
    segment.points[0],
    segment.points.at(-1)!,
  ])
  return uniquePoints(endpoints.filter(point => (
    route.segments.filter(segment => pointTopologicallyOnSegment(point, segment)).length === 1
  )))
}

function connectedSegments(segments: RouteSegment[]): boolean {
  const visited = new Set([0])
  const pending = [0]
  while (pending.length > 0) {
    const index = pending.pop()!
    for (let candidate = 0; candidate < segments.length; candidate++) {
      if (
        visited.has(candidate)
        || !segmentsTopologicallyConnect(segments[index], segments[candidate])
      ) continue
      visited.add(candidate)
      pending.push(candidate)
    }
  }
  return visited.size === segments.length
}

function segmentsTopologicallyConnect(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation === 'bridge') {
    return bridgeEndpoints(left).some(point => pointTopologicallyOnSegment(point, right))
  }
  if (right.orientation === 'bridge') {
    return bridgeEndpoints(right).some(point => pointTopologicallyOnSegment(point, left))
  }
  return polylineLegs(left).some(leftLeg => polylineLegs(right).some(rightLeg => (
    segmentsIntersect(leftLeg[0], leftLeg[1], rightLeg[0], rightLeg[1])
  )))
}

function pointTopologicallyOnSegment(point: Point, segment: RouteSegment): boolean {
  return segment.orientation === 'bridge'
    ? bridgeEndpoints(segment).some(endpoint => samePoint(point, endpoint))
    : pointOnPolyline(point, segment)
}

function bridgeEndpoints(segment: RouteSegment): [Point, Point] {
  return [segment.points[0], segment.points.at(-1)!]
}

function pointOnPolyline(point: Point, segment: RouteSegment): boolean {
  return polylineLegs(segment).some(([start, end]) => pointOnSegment(point, start, end))
}

function polylineLegs(segment: RouteSegment): Array<[Point, Point]> {
  return segment.points.slice(1).map((point, index) => [segment.points[index], point])
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (left: Point, middle: Point, right: Point) => (
    (middle.x - left.x) * (right.y - left.y)
    - (middle.y - left.y) * (right.x - left.x)
  )
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (abC === 0 && pointOnSegment(c, a, b)) return true
  if (abD === 0 && pointOnSegment(d, a, b)) return true
  if (cdA === 0 && pointOnSegment(a, c, d)) return true
  if (cdB === 0 && pointOnSegment(b, c, d)) return true
  return (abC < 0) !== (abD < 0) && (cdA < 0) !== (cdB < 0)
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross = (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y)
  if (cross !== 0) return false
  return point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y)
}

function positiveCollinearOverlap(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation !== right.orientation) return false
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const [a0, a1] = left.points
  const [b0, b1] = right.points
  if (left.orientation === 'horizontal') {
    return a0.y === b0.y && positiveOverlap(a0.x, a1.x, b0.x, b1.x)
  }
  return a0.x === b0.x && positiveOverlap(a0.y, a1.y, b0.y, b1.y)
}

function falseTJunction(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const leftEndpoints = [left.points[0], left.points.at(-1)!]
  const rightEndpoints = [right.points[0], right.points.at(-1)!]
  return leftEndpoints.some(leftPoint => rightEndpoints.some(rightPoint => (
    samePoint(leftPoint, rightPoint)
  ))) || leftEndpoints.some(point => (
    pointStrictlyInside(point, right)
  )) || rightEndpoints.some(point => (
    pointStrictlyInside(point, left)
  ))
}

function perpendicularInteriorCross(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  if (left.orientation === right.orientation) return false
  const horizontal = left.orientation === 'horizontal' ? left : right
  const vertical = left.orientation === 'vertical' ? left : right
  const [horizontalStart, horizontalEnd] = horizontal.points
  const [verticalStart, verticalEnd] = vertical.points
  const crossing = { x: verticalStart.x, y: horizontalStart.y }
  return pointStrictlyInside(crossing, horizontal)
    && pointStrictlyInside(crossing, vertical)
}

function pointStrictlyInside(point: Point, segment: RouteSegment): boolean {
  const [start, end] = segment.points
  return pointOnSegment(point, start, end)
    && !samePoint(point, start)
    && !samePoint(point, end)
}

function segmentIntersectsRect(segment: RouteSegment, rect: Rect): boolean {
  return polylineLegs(segment).some(([start, end]) => (
    Math.max(start.x, end.x) > rect.x
    && Math.min(start.x, end.x) < rect.x + rect.width
    && Math.max(start.y, end.y) > rect.y
    && Math.min(start.y, end.y) < rect.y + rect.height
  ))
}

function forEachOverlap<T extends { rect: Rect }>(
  values: T[],
  callback: (left: T, right: T) => void,
) {
  for (let leftIndex = 0; leftIndex < values.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex++) {
      if (rectsOverlap(values[leftIndex].rect, values[rightIndex].rect)) {
        callback(values[leftIndex], values[rightIndex])
      }
    }
  }
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

function expandRect(rect: Rect, clearance: number): Rect {
  return {
    x: rect.x - clearance,
    y: rect.y - clearance,
    width: rect.width + clearance * 2,
    height: rect.height + clearance * 2,
  }
}

function topPort(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y }
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>()
  return points.filter(point => {
    const key = `${point.x},${point.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function positiveOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(Math.min(a0, a1), Math.min(b0, b1))
    < Math.min(Math.max(a0, a1), Math.max(b0, b1))
}

function sortedIds(...ids: string[]): string[] {
  return ids.sort((left, right) => left.localeCompare(right))
}

function deduplicate(diagnostics: LayoutDiagnostic[]): LayoutDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter(diagnostic => {
    const key = `${diagnostic.code}:${diagnostic.ids.join('+')}:${diagnostic.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
