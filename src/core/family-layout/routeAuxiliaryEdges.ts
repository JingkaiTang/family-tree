import type {
  AuxiliaryRelation,
  LayoutMetrics,
  PlacedPersonCard,
  Point,
  Rect,
  RoutedFamilyEdge,
  RouteSegment,
  SceneGeometry,
} from './types'

export interface RouteAuxiliaryEdgesInput {
  geometry: SceneGeometry
  auxiliaryRelations: AuxiliaryRelation[]
  primaryRoutes: RoutedFamilyEdge[]
  metrics: LayoutMetrics
}

interface Terminal {
  port: Point
  outside: Point
  grid: Point
  card: PlacedPersonCard
}

interface PortAllocation {
  y: number
  channelOffset: number
}

interface Candidate {
  points: Point[]
  segments: RouteSegment[]
  order: number
}

type Edge = [Point, Point]

interface Obstacle {
  id: string
  unitId: string
  type: 'card' | 'unit'
  rect: Rect
}

const GRAY = '#64748b'
const PURPLE = '#8b5cf6'

function allocatePorts(
  cards: PlacedPersonCard[],
  relations: AuxiliaryRelation[],
  metrics: LayoutMetrics,
): Map<string, PortAllocation> {
  const ownerIdsByPersonId = new Map<string, Set<string>>()
  for (const relation of relations) {
    for (const personId of new Set([relation.sourceId, relation.targetId])) {
      const ownerIds = ownerIdsByPersonId.get(personId) ?? new Set<string>()
      ownerIds.add(relation.id)
      ownerIdsByPersonId.set(personId, ownerIds)
    }
  }

  const result = new Map<string, PortAllocation>()
  for (const card of [...cards].sort((left, right) => left.id.localeCompare(right.id))) {
    const ownerIds = [...(ownerIdsByPersonId.get(card.id) ?? [])]
      .sort((left, right) => left.localeCompare(right))
    if (ownerIds.length === 0) continue
    const centerY = card.rect.y + card.rect.height / 2
    const minY = card.rect.y + metrics.cardClearance
    const maxY = card.rect.y + card.rect.height - metrics.cardClearance
    const spacing = ownerIds.length === 1
      ? 0
      : Math.min(metrics.routeSubgrid * 2, (maxY - minY) / (ownerIds.length - 1))
    ownerIds.forEach((ownerId, index) => result.set(portKey(ownerId, card.id), {
      y: centerY + (index - (ownerIds.length - 1) / 2) * spacing,
      channelOffset: index * metrics.routeSubgrid,
    }))
  }
  return result
}

function portKey(ownerId: string, personId: string): string {
  return `${ownerId}\u0000${personId}`
}

export function routeAuxiliaryEdges(input: RouteAuxiliaryEdgesInput): RoutedFamilyEdge[] {
  const cardsById = new Map(input.geometry.cards.map(card => [card.id, card]))
  const routes: RoutedFamilyEdge[] = []
  const sortedRelations = [...input.auxiliaryRelations].sort(compareById)
  const portByOwnerAndPerson = allocatePorts(
    input.geometry.cards,
    sortedRelations,
    input.metrics,
  )
  const occupiedEdges = routeEdges(input.primaryRoutes)

  for (const relation of sortedRelations) {
    const source = cardsById.get(relation.sourceId)
    const target = cardsById.get(relation.targetId)
    if (!source || !target || source.id === target.id) continue
    const candidate = chooseCandidate(
      input,
      source,
      target,
      portByOwnerAndPerson.get(portKey(relation.id, source.id)),
      portByOwnerAndPerson.get(portKey(relation.id, target.id)),
      occupiedEdges,
    )
    if (!candidate) continue
    routes.push({
      id: `route:${relation.id}`,
      routeOwnerId: relation.id,
      kind: relation.kind,
      accent: relation.kind === 'godparent' ? PURPLE : GRAY,
      segments: candidate.segments,
    })
    occupiedEdges.push(...routeEdgesFromSegments(candidate.segments))
  }

  return routes
}

function chooseCandidate(
  input: RouteAuxiliaryEdgesInput,
  source: PlacedPersonCard,
  target: PlacedPersonCard,
  sourcePort: PortAllocation | undefined,
  targetPort: PortAllocation | undefined,
  occupiedEdges: Edge[],
): Candidate | undefined {
  const clearance = snapUp(input.metrics.cardClearance, input.metrics.routeSubgrid)
  const obstacles = [
    ...input.geometry.cards.map(card => ({
      id: card.id,
      unitId: card.unitId,
      type: 'card' as const,
      rect: expandRect(card.rect, input.metrics.cardClearance),
    })),
    ...input.geometry.units.map(unit => ({
      id: unit.id,
      unitId: unit.id,
      type: 'unit' as const,
      rect: expandRect(unit.rect, input.metrics.cardClearance),
    })),
  ]
  const sourceTerminals = sideTerminals(
    source,
    clearance,
    input.metrics.routeSubgrid,
    sourcePort?.y,
    sourcePort?.channelOffset,
  )
  const targetTerminals = sideTerminals(
    target,
    clearance,
    input.metrics.routeSubgrid,
    targetPort?.y,
    targetPort?.channelOffset,
  )
  const relatedUnitIds = relatedComponentUnitIds(
    input.geometry,
    input.primaryRoutes,
    source.unitId,
    target.unitId,
  )
  const componentObstacles = obstacles.filter(obstacle => (
    relatedUnitIds.has(obstacle.unitId)
  ))
  const minX = snapDown(
    Math.min(...obstacles.map(obstacle => obstacle.rect.x)),
    input.metrics.routeSubgrid,
  )
  const maxX = snapUp(
    Math.max(...obstacles.map(obstacle => obstacle.rect.x + obstacle.rect.width)),
    input.metrics.routeSubgrid,
  )
  const minY = snapDown(
    Math.min(...componentObstacles.map(obstacle => obstacle.rect.y)),
    input.metrics.routeSubgrid,
  )
  const maxY = snapUp(
    Math.max(...componentObstacles.map(obstacle => obstacle.rect.y + obstacle.rect.height)),
    input.metrics.routeSubgrid,
  )
  const candidates: Candidate[] = []
  let order = 0

  for (const start of sourceTerminals) {
    for (const end of targetTerminals) {
      const paths: Point[][] = [
        [start.port, start.outside, start.grid, { x: end.grid.x, y: start.grid.y }, end.grid, end.outside, end.port],
        [start.port, start.outside, start.grid, { x: start.grid.x, y: end.grid.y }, end.grid, end.outside, end.port],
        [start.port, start.outside, start.grid, { x: start.grid.x, y: minY }, { x: end.grid.x, y: minY }, end.grid, end.outside, end.port],
        [start.port, start.outside, start.grid, { x: start.grid.x, y: maxY }, { x: end.grid.x, y: maxY }, end.grid, end.outside, end.port],
        [start.port, start.outside, start.grid, { x: minX, y: start.grid.y }, { x: minX, y: end.grid.y }, end.grid, end.outside, end.port],
        [start.port, start.outside, start.grid, { x: maxX, y: start.grid.y }, { x: maxX, y: end.grid.y }, end.grid, end.outside, end.port],
      ]
      for (const path of paths) {
        const points = simplifyPoints(path)
        const candidate = { points, segments: toSegments(points), order: order++ }
        if (candidate.segments.length === 0) continue
        if (!candidateIsValid(candidate, start, end, obstacles, occupiedEdges)) continue
        candidates.push(candidate)
      }
    }
  }

  return candidates.sort(compareCandidates)[0]
}

function sideTerminals(
  card: PlacedPersonCard,
  clearance: number,
  routeSubgrid: number,
  portY = card.rect.y + card.rect.height / 2,
  channelOffset = 0,
): Terminal[] {
  const gridY = snapNearest(portY, routeSubgrid)
  const leftX = snapDown(card.rect.x - clearance - channelOffset, routeSubgrid)
  const rightX = snapUp(card.rect.x + card.rect.width + clearance + channelOffset, routeSubgrid)
  return [{
    port: { x: card.rect.x, y: portY },
    outside: { x: leftX, y: portY },
    grid: { x: leftX, y: gridY },
    card,
  }, {
    port: { x: card.rect.x + card.rect.width, y: portY },
    outside: { x: rightX, y: portY },
    grid: { x: rightX, y: gridY },
    card,
  }]
}

function candidateIsValid(
  candidate: Candidate,
  start: Terminal,
  end: Terminal,
  obstacles: Obstacle[],
  occupiedEdges: Edge[],
): boolean {
  if (routeEdgesFromSegments(candidate.segments).some(auxiliary => (
    occupiedEdges.some(occupied => edgesConflict(auxiliary, occupied))
  ))) return false

  const lastIndex = candidate.segments.length - 1
  return obstacles.every(obstacle => candidate.segments.every((segment, index) => {
    if (!segmentIntersectsRect(segment, obstacle.rect)) return true
    const sourceTerminalObstacle = obstacle.type === 'card'
      ? obstacle.id === start.card.id
      : obstacle.id === start.card.unitId
    const targetTerminalObstacle = obstacle.type === 'card'
      ? obstacle.id === end.card.id
      : obstacle.id === end.card.unitId
    return (index === 0 && sourceTerminalObstacle)
      || (index === lastIndex && targetTerminalObstacle)
  }))
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return bendCount(left) - bendCount(right)
    || routeLength(left) - routeLength(right)
    || comparePointLists(left.points, right.points)
    || left.order - right.order
}

function bendCount(candidate: Candidate): number {
  return Math.max(0, candidate.segments.length - 1)
}

function routeLength(candidate: Candidate): number {
  return candidate.segments.reduce((sum, segment) => {
    const [start, end] = segment.points
    return sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
  }, 0)
}

function comparePointLists(left: Point[], right: Point[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index].x - right[index].x || left[index].y - right[index].y
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function simplifyPoints(points: Point[]): Point[] {
  const unique = points.filter((point, index) => (
    index === 0 || !samePoint(point, points[index - 1])
  ))
  const simplified: Point[] = []
  for (const point of unique) {
    while (simplified.length >= 2) {
      const before = simplified[simplified.length - 2]
      const previous = simplified[simplified.length - 1]
      if (!collinear(before, previous, point)) break
      simplified.pop()
    }
    simplified.push(point)
  }
  return simplified
}

function toSegments(points: Point[]): RouteSegment[] {
  return points.slice(1).flatMap((point, index) => {
    const start = points[index]
    if (samePoint(start, point)) return []
    return [{
      orientation: start.y === point.y ? 'horizontal' as const : 'vertical' as const,
      points: [start, point],
    }]
  })
}

function segmentIntersectsRect(segment: RouteSegment, rect: Rect): boolean {
  const [start, end] = segment.points
  if (segment.orientation === 'horizontal') {
    return start.y > rect.y
      && start.y < rect.y + rect.height
      && Math.max(start.x, end.x) > rect.x
      && Math.min(start.x, end.x) < rect.x + rect.width
  }
  return start.x > rect.x
    && start.x < rect.x + rect.width
    && Math.max(start.y, end.y) > rect.y
    && Math.min(start.y, end.y) < rect.y + rect.height
}

function routeEdges(routes: RoutedFamilyEdge[]): Edge[] {
  return routes.flatMap(route => routeEdgesFromSegments(route.segments))
}

function relatedComponentUnitIds(
  geometry: SceneGeometry,
  primaryRoutes: RoutedFamilyEdge[],
  sourceUnitId: string,
  targetUnitId: string,
): Set<string> {
  const allUnitIds = new Set([
    ...geometry.units.map(unit => unit.id),
    ...geometry.cards.map(card => card.unitId),
    ...geometry.hubs.map(hub => hub.unitId),
  ])
  const parentByUnitId = new Map([...allUnitIds].map(unitId => [unitId, unitId]))
  const find = (unitId: string): string => {
    const parent = parentByUnitId.get(unitId) ?? unitId
    if (parent === unitId) return unitId
    const root = find(parent)
    parentByUnitId.set(unitId, root)
    return root
  }
  const union = (leftId: string, rightId: string) => {
    const leftRoot = find(leftId)
    const rightRoot = find(rightId)
    if (leftRoot === rightRoot) return
    const [first, second] = [leftRoot, rightRoot].sort((left, right) => (
      left.localeCompare(right)
    ))
    parentByUnitId.set(second, first)
  }
  const unitIdsByContact = new Map<string, string[]>()
  for (const hub of geometry.hubs) {
    registerContact(unitIdsByContact, hub.point, hub.unitId)
  }
  for (const card of geometry.cards) {
    registerContact(unitIdsByContact, topPort(card.rect), card.unitId)
  }
  for (const route of primaryRoutes) {
    const contactUnitIds = new Set(route.segments.flatMap(segment => {
      const endpoints = [segment.points[0], segment.points.at(-1)!]
      return endpoints.flatMap(point => unitIdsByContact.get(pointKey(point)) ?? [])
    }))
    const [firstUnitId, ...otherUnitIds] = [...contactUnitIds].sort((left, right) => (
      left.localeCompare(right)
    ))
    if (!firstUnitId) continue
    otherUnitIds.forEach(unitId => union(firstUnitId, unitId))
  }
  const relevantRoots = new Set([find(sourceUnitId), find(targetUnitId)])
  return new Set([...allUnitIds].filter(unitId => relevantRoots.has(find(unitId))))
}

function registerContact(
  unitIdsByContact: Map<string, string[]>,
  point: Point,
  unitId: string,
) {
  const key = pointKey(point)
  const unitIds = unitIdsByContact.get(key) ?? []
  if (!unitIds.includes(unitId)) unitIds.push(unitId)
  unitIdsByContact.set(key, unitIds)
}

function topPort(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y }
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function routeEdgesFromSegments(segments: RouteSegment[]): Edge[] {
  return segments.flatMap(segment => segment.points.slice(1).map((point, index) => (
    [segment.points[index], point] as Edge
  )))
}

function edgesConflict([a, b]: Edge, [c, d]: Edge): boolean {
  const abC = direction(a, b, c)
  const abD = direction(a, b, d)
  if (abC === 0 && abD === 0) {
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
      ? positiveOverlap(a.x, b.x, c.x, d.x)
      : positiveOverlap(a.y, b.y, c.y, d.y)
  }
  if (pointStrictlyOnEdge(c, a, b) || pointStrictlyOnEdge(d, a, b)) return true
  if (pointStrictlyOnEdge(a, c, d) || pointStrictlyOnEdge(b, c, d)) return true
  // 不同 owner 可以在单点正交交叉；只禁止共线重合和假 T 形接触。
  return false
}

function direction(start: Point, end: Point, point: Point): number {
  return (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x)
}

function pointOnSegment(start: Point, end: Point, point: Point): boolean {
  return direction(start, end, point) === 0
    && point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y)
}

function pointStrictlyOnEdge(point: Point, start: Point, end: Point): boolean {
  return pointOnSegment(start, end, point)
    && !samePoint(point, start)
    && !samePoint(point, end)
}

function positiveOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(Math.min(a0, a1), Math.min(b0, b1))
    < Math.min(Math.max(a0, a1), Math.max(b0, b1))
}

function expandRect(rect: Rect, clearance: number): Rect {
  return {
    x: rect.x - clearance,
    y: rect.y - clearance,
    width: rect.width + clearance * 2,
    height: rect.height + clearance * 2,
  }
}

function collinear(first: Point, second: Point, third: Point): boolean {
  return (first.x === second.x && second.x === third.x)
    || (first.y === second.y && second.y === third.y)
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y
}

function snapUp(value: number, subgrid: number): number {
  return Math.ceil(value / subgrid) * subgrid
}

function snapDown(value: number, subgrid: number): number {
  return Math.floor(value / subgrid) * subgrid
}

function snapNearest(value: number, subgrid: number): number {
  const lower = snapDown(value, subgrid)
  const upper = snapUp(value, subgrid)
  return value - lower <= upper - value ? lower : upper
}

function compareById(left: AuxiliaryRelation, right: AuxiliaryRelation): number {
  return left.id.localeCompare(right.id)
}
