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

interface Candidate {
  points: Point[]
  segments: RouteSegment[]
  order: number
}

const GRAY = '#64748b'
const PURPLE = '#8b5cf6'

export function routeAuxiliaryEdges(input: RouteAuxiliaryEdgesInput): RoutedFamilyEdge[] {
  const cardsById = new Map(input.geometry.cards.map(card => [card.id, card]))
  const routes: RoutedFamilyEdge[] = []

  for (const relation of [...input.auxiliaryRelations].sort(compareById)) {
    const source = cardsById.get(relation.sourceId)
    const target = cardsById.get(relation.targetId)
    if (!source || !target || source.id === target.id) continue
    const candidate = chooseCandidate(input, source, target)
    if (!candidate) continue
    routes.push({
      id: `route:${relation.id}`,
      routeOwnerId: relation.id,
      kind: relation.kind,
      accent: relation.kind === 'godparent' ? PURPLE : GRAY,
      segments: candidate.segments,
    })
  }

  return routes
}

function chooseCandidate(
  input: RouteAuxiliaryEdgesInput,
  source: PlacedPersonCard,
  target: PlacedPersonCard,
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
  const sourceTerminals = sideTerminals(source, clearance, input.metrics.routeSubgrid)
  const targetTerminals = sideTerminals(target, clearance, input.metrics.routeSubgrid)
  const minX = snapDown(
    Math.min(...obstacles.map(obstacle => obstacle.rect.x)),
    input.metrics.routeSubgrid,
  )
  const maxX = snapUp(
    Math.max(...obstacles.map(obstacle => obstacle.rect.x + obstacle.rect.width)),
    input.metrics.routeSubgrid,
  )
  const minY = snapDown(
    Math.min(...obstacles.map(obstacle => obstacle.rect.y)),
    input.metrics.routeSubgrid,
  )
  const maxY = snapUp(
    Math.max(...obstacles.map(obstacle => obstacle.rect.y + obstacle.rect.height)),
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
        if (!candidateIsValid(candidate, start, end, obstacles, input.primaryRoutes)) continue
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
): Terminal[] {
  const centerY = card.rect.y + card.rect.height / 2
  const gridY = snapNearest(centerY, routeSubgrid)
  const leftX = snapDown(card.rect.x - clearance, routeSubgrid)
  const rightX = snapUp(card.rect.x + card.rect.width + clearance, routeSubgrid)
  return [{
    port: { x: card.rect.x, y: centerY },
    outside: { x: leftX, y: centerY },
    grid: { x: leftX, y: gridY },
    card,
  }, {
    port: { x: card.rect.x + card.rect.width, y: centerY },
    outside: { x: rightX, y: centerY },
    grid: { x: rightX, y: gridY },
    card,
  }]
}

function candidateIsValid(
  candidate: Candidate,
  start: Terminal,
  end: Terminal,
  obstacles: Array<{
    id: string
    unitId: string
    type: 'card' | 'unit'
    rect: Rect
  }>,
  primaryRoutes: RoutedFamilyEdge[],
): boolean {
  if (candidate.segments.some(segment => primaryRoutes.some(route => (
    route.segments.some(primary => positiveCollinearOverlap(segment, primary))
  )))) return false

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
