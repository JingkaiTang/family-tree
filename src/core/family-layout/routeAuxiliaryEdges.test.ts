import { describe, expect, it } from 'vitest'
import { layoutFamilyScene } from './layoutFamilyScene'
import { routeAuxiliaryEdges } from './routeAuxiliaryEdges'
import { normalizeFacts } from './normalizeFacts'
import { familyData, linkSpouse, member, positiveCollinearOverlap } from './testHelpers'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'
import type {
  AuxiliaryRelation,
  LayoutRequest,
  Point,
  RoutedFamilyEdge,
  SceneGeometry,
} from './types'

describe('routeAuxiliaryEdges', () => {
  it('routes historical and secondary partnerships from side ports with separate owners', () => {
    const geometry = rowGeometry(['a', 'b', 'c'])
    const relations: AuxiliaryRelation[] = [{
      id: 'aux:historical:a+b',
      kind: 'historical-partnership',
      sourceId: 'a',
      targetId: 'b',
    }, {
      id: 'aux:secondary:a+c',
      kind: 'secondary-partnership',
      sourceId: 'a',
      targetId: 'c',
    }]

    const routes = routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: relations,
      primaryRoutes: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(routes.map(route => ({
      id: route.id,
      owner: route.routeOwnerId,
      kind: route.kind,
    }))).toEqual([{
      id: 'route:aux:historical:a+b',
      owner: 'aux:historical:a+b',
      kind: 'historical-partnership',
    }, {
      id: 'route:aux:secondary:a+c',
      owner: 'aux:secondary:a+c',
      kind: 'secondary-partnership',
    }])
    for (const [index, relation] of relations.entries()) {
      const endpoints = routeEndpoints(routes[index])
      expect(isSafeSidePort(geometry, relation.sourceId, endpoints[0])).toBe(true)
      expect(isSafeSidePort(geometry, relation.targetId, endpoints[1])).toBe(true)
      const corridorPoints = routes[index].segments.slice(2, -2)
        .flatMap(segment => segment.points)
      expect(corridorPoints.length).toBeGreaterThan(0)
      expect(corridorPoints.every(point => (
        point.x % DEFAULT_LAYOUT_METRICS.routeSubgrid === 0
        && point.y % DEFAULT_LAYOUT_METRICS.routeSubgrid === 0
      ))).toBe(true)
    }
    expect(new Set(routes.map(route => pointKey(routeEndpoints(route)[0]))).size).toBe(2)
  })

  it('never shares a positive-length segment with a primary route', () => {
    const geometry = rowGeometry(['a', 'b'])
    const primaryRoute: RoutedFamilyEdge = {
      id: 'route:primary',
      routeOwnerId: 'parentage:primary',
      kind: 'primary',
      accent: '#111111',
      segments: [{
        orientation: 'horizontal',
        points: [{ x: 168, y: 108 }, { x: 288, y: 108 }],
      }],
    }

    const routes = routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: [{
        id: 'aux:a+b',
        kind: 'historical-partnership',
        sourceId: 'a',
        targetId: 'b',
      }],
      primaryRoutes: [primaryRoute],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(routes).toHaveLength(1)
    expect(routes[0].segments.some(auxiliary => (
      primaryRoute.segments.some(primary => positiveCollinearOverlap(auxiliary, primary))
    ))).toBe(false)
  })

  it('treats every polyline edge of a primary bridge as occupied', () => {
    const geometry = rowGeometry(['a', 'b'])
    const bridge: RoutedFamilyEdge = {
      id: 'route:bridge',
      routeOwnerId: 'parentage:bridge',
      kind: 'primary',
      accent: '#111111',
      segments: [{
        orientation: 'bridge',
        points: [{ x: 200, y: 80 }, { x: 228, y: 104 }, { x: 256, y: 80 }],
      }],
    }

    const routes = routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: [{
        id: 'aux:a+b',
        kind: 'historical-partnership',
        sourceId: 'a',
        targetId: 'b',
      }],
      primaryRoutes: [bridge],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(routes).toHaveLength(1)
    expect(routeEdges(routes[0]).some(auxiliary => (
      routeEdges(bridge).some(primary => segmentsIntersect(auxiliary, primary))
    ))).toBe(false)
  })

  it('allows an occupied primary edge to meet an auxiliary route at one exact endpoint', () => {
    const geometry = rowGeometry(['a', 'b'])
    const relation: AuxiliaryRelation = {
      id: 'aux:a+b',
      kind: 'historical-partnership',
      sourceId: 'a',
      targetId: 'b',
    }
    const baseline = routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: [relation],
      primaryRoutes: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })
    const exactEndpoint: RoutedFamilyEdge = {
      id: 'route:primary-endpoint',
      routeOwnerId: 'parentage:primary-endpoint',
      kind: 'primary',
      accent: '#111111',
      segments: [{
        orientation: 'vertical',
        points: [{ x: 184, y: 80 }, { x: 184, y: 104 }],
      }],
    }

    expect(routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: [relation],
      primaryRoutes: [exactEndpoint],
      metrics: DEFAULT_LAYOUT_METRICS,
    })).toEqual(baseline)
  })

  it('chooses the same candidate route for equivalent input permutations', () => {
    const geometry = rowGeometry(['a', 'blocker', 'b'])
    const relations: AuxiliaryRelation[] = [{
      id: 'aux:z',
      kind: 'godparent',
      sourceId: 'a',
      targetId: 'b',
    }, {
      id: 'aux:a',
      kind: 'secondary-parentage',
      sourceId: 'b',
      targetId: 'a',
    }]
    const input = {
      geometry,
      auxiliaryRelations: relations,
      primaryRoutes: [] as RoutedFamilyEdge[],
      metrics: DEFAULT_LAYOUT_METRICS,
    }

    const forward = routeAuxiliaryEdges(input)
    const reversed = routeAuxiliaryEdges({
      ...input,
      geometry: {
        ...geometry,
        cards: [...geometry.cards].reverse(),
        units: [...geometry.units].reverse(),
      },
      auxiliaryRelations: [...relations].reverse(),
    })

    expect(reversed).toEqual(forward)
  })

  it('keeps component corridors unchanged when a distant unrelated unit is added', () => {
    const geometry = rowGeometry(['a', 'blocker', 'b'])
    const relation: AuxiliaryRelation = {
      id: 'aux:a+b',
      kind: 'historical-partnership',
      sourceId: 'a',
      targetId: 'b',
    }
    const baseline = routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: [relation],
      primaryRoutes: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })
    const distantUnit = {
      ...geometry.units[0],
      id: 'unit:distant',
      memberIds: ['distant'],
      rect: { x: 2400, y: -1200, width: 168, height: 216 },
      order: 3,
    }
    const withDistantComponent = routeAuxiliaryEdges({
      geometry: {
        ...geometry,
        units: [...geometry.units, distantUnit],
        cards: [...geometry.cards, {
          id: 'distant',
          unitId: distantUnit.id,
          generation: 0,
          rect: { ...distantUnit.rect },
        }],
      },
      auxiliaryRelations: [relation],
      primaryRoutes: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(withDistantComponent).toEqual(baseline)
  })

  it('keeps primary geometry byte-identical and filters routes by auxiliary focus', () => {
    const a = member('a')
    const current = member('current')
    const ex = member('ex')
    const godchild = member('godchild', {
      godparents: [{ id: 'a', type: 'godparent' }],
    })
    linkSpouse(a, current)
    linkSpouse(a, ex, 'divorced')
    const normalized = normalizeFacts(familyData([godchild, ex, current, a]))
    const hidden = layoutFamilyScene(layoutRequest(normalized, false))
    const noFocus = layoutFamilyScene(layoutRequest(normalized, true))
    const focused = layoutFamilyScene({
      ...layoutRequest(normalized, true),
      auxiliaryFocusPersonId: 'a',
    })
    const unrelated = layoutFamilyScene({
      ...layoutRequest(normalized, true),
      auxiliaryFocusPersonId: 'current',
    })

    expect(primaryGeometry(noFocus)).toEqual(primaryGeometry(hidden))
    expect(primaryGeometry(focused)).toEqual(primaryGeometry(hidden))
    expect(focused.routes.filter(route => route.kind === 'primary'))
      .toEqual(hidden.routes.filter(route => route.kind === 'primary'))
    expect(noFocus.routes.filter(route => route.kind !== 'primary')).toEqual([])
    expect(unrelated.routes.filter(route => route.kind !== 'primary')).toEqual([])
    expect(focused.routes.filter(route => route.kind !== 'primary').map(route => route.kind))
      .toEqual(['godparent', 'historical-partnership'])
    expect(Object.fromEntries(focused.cards.map(card => [card.id, card.generation])))
      .toEqual(Object.fromEntries(hidden.cards.map(card => [card.id, card.generation])))
  })
})

function primaryGeometry(scene: ReturnType<typeof layoutFamilyScene>) {
  return {
    units: scene.units,
    cards: scene.cards,
    hubs: scene.hubs,
    rows: scene.rows,
    rootDomains: scene.rootDomains,
    bridgeDomains: scene.bridgeDomains,
    gateways: scene.gateways,
    bounds: scene.bounds,
  }
}

function rowGeometry(ids: string[]): SceneGeometry {
  const units = ids.map((id, index) => ({
    id: `unit:${id}`,
    kind: 'single' as const,
    memberIds: [id],
    generation: 0,
    width: 168,
    lineageAffinity: {},
    accent: '#111111',
    rootSignature: ['root:test'],
    domainId: 'domain:root:test',
    memberRootIds: { [id]: 'root:test' },
    rootAccent: '#4F7CAC',
    isRootFamily: false,
    rect: { x: index * 288, y: 0, width: 168, height: 216 },
    order: index,
  }))
  return {
    units,
    cards: units.map(unit => ({
      id: unit.memberIds[0],
      unitId: unit.id,
      generation: 0,
      rect: { ...unit.rect },
    })),
    hubs: [],
    rows: [{ id: 'row:0', generation: 0, unitIds: units.map(unit => unit.id) }],
    rootDomains: [{
      id: 'domain:root:test',
      kind: 'root',
      componentId: 'component:test',
      rootIds: ['root:test'],
      signature: ['root:test'],
      personIds: [...ids],
      unitIds: units.map(unit => unit.id),
      order: 0,
      accent: '#4F7CAC',
      rect: { x: 0, y: 0, width: Math.max(168, ids.length * 288), height: 216 },
      columnStart: 0,
      columnEnd: Math.max(6, ids.length * 12 - 1),
    }],
    bridgeDomains: [],
    bounds: { x: 0, y: 0, width: Math.max(0, ids.length * 288 - 120), height: 216 },
  }
}

function routeEndpoints(route: RoutedFamilyEdge): [Point, Point] {
  return [route.segments[0].points[0], route.segments.at(-1)!.points.at(-1)!]
}

function isSafeSidePort(geometry: SceneGeometry, id: string, point: Point): boolean {
  const card = geometry.cards.find(value => value.id === id)!
  return (point.x === card.rect.x || point.x === card.rect.x + card.rect.width)
    && point.y >= card.rect.y + DEFAULT_LAYOUT_METRICS.cardClearance
    && point.y <= card.rect.y + card.rect.height - DEFAULT_LAYOUT_METRICS.cardClearance
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

type Edge = [Point, Point]

function routeEdges(route: RoutedFamilyEdge): Edge[] {
  return route.segments.flatMap(segment => (
    segment.points.slice(1).map((point, index) => [segment.points[index], point] as Edge)
  ))
}

function segmentsIntersect([a, b]: Edge, [c, d]: Edge): boolean {
  const direction = (start: Point, end: Point, point: Point) => (
    (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x)
  )
  const onSegment = (start: Point, end: Point, point: Point) => (
    direction(start, end, point) === 0
    && point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y)
  )
  const abC = direction(a, b, c)
  const abD = direction(a, b, d)
  const cdA = direction(c, d, a)
  const cdB = direction(c, d, b)
  if (abC === 0 && onSegment(a, b, c)) return true
  if (abD === 0 && onSegment(a, b, d)) return true
  if (cdA === 0 && onSegment(c, d, a)) return true
  if (cdB === 0 && onSegment(c, d, b)) return true
  return (abC < 0) !== (abD < 0) && (cdA < 0) !== (cdB < 0)
}

function layoutRequest(
  normalized: ReturnType<typeof normalizeFacts>,
  showAuxiliary: boolean,
): LayoutRequest {
  return {
    facts: normalized.facts,
    view: {
      ...structuredClone(DEFAULT_FAMILY_VIEW_POLICY),
      showHistoricalPartnerships: showAuxiliary,
      showSecondaryParentage: showAuxiliary,
      showGodparentRelations: showAuxiliary,
    },
    preferences: structuredClone(EMPTY_LAYOUT_PREFERENCES),
    metrics: structuredClone(DEFAULT_LAYOUT_METRICS),
    inputDiagnostics: normalized.diagnostics,
  }
}
