import { describe, expect, it } from 'vitest'
import { layoutFamilyScene } from './layoutFamilyScene'
import { routeAuxiliaryEdges } from './routeAuxiliaryEdges'
import { normalizeFacts } from './normalizeFacts'
import { familyData, linkParent, linkSpouse, member, positiveCollinearOverlap } from './testHelpers'
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
  it('routes a godparent connection around an unrelated three-generation family', () => {
    const normalized = normalizeFacts(staggeredFamily())
    const hidden = layoutFamilyScene(layoutRequest(normalized, false))
    const scene = layoutFamilyScene({
      ...layoutRequest(normalized, true),
      auxiliaryFocusPersonId: 'f-godchild',
    })

    const routes = scene.routes.filter(route => route.kind === 'godparent')
    expect(routes).toHaveLength(1)
    const [start, end] = routeEndpoints(routes[0])
    expect(isSafeSidePort(scene, 'a-godmother', start)).toBe(true)
    expect(isSafeSidePort(scene, 'f-godchild', end)).toBe(true)
    expectRouteAvoidsCards(routes[0], scene)
    expectNoFalseConnections(routes[0], scene.routes.filter(route => route.kind === 'primary'))
    expect(primaryGeometry(scene)).toEqual(primaryGeometry(hidden))
    expect(scene.routes.filter(route => route.kind === 'primary')).toEqual(hidden.routes)
    expect(scene.diagnostics).toEqual([])
  })

  it('keeps crowded auxiliary owners separate and deterministic around staggered obstacles', () => {
    const scene = layoutFamilyScene(layoutRequest(normalizeFacts(staggeredFamily()), false))
    const relations: AuxiliaryRelation[] = [{
      id: 'aux:a-godparent', kind: 'godparent', sourceId: 'a-godmother', targetId: 'f-godchild',
    }, {
      id: 'aux:b-secondary', kind: 'secondary-parentage', sourceId: 'a-godmother', targetId: 'g-unrelated-child',
    }, {
      id: 'aux:c-historical', kind: 'historical-partnership', sourceId: 'a-godmother', targetId: 'e-mother',
    }]
    const input = {
      geometry: scene, auxiliaryRelations: relations, primaryRoutes: scene.routes, metrics: DEFAULT_LAYOUT_METRICS,
    }
    const routes = routeAuxiliaryEdges(input)
    expect(routes.map(route => route.routeOwnerId)).toEqual(relations.map(relation => relation.id))
    for (const [index, route] of routes.entries()) {
      const [start, end] = routeEndpoints(route)
      expect(isSafeSidePort(scene, relations[index].sourceId, start)).toBe(true)
      expect(isSafeSidePort(scene, relations[index].targetId, end)).toBe(true)
      expectRouteAvoidsCards(route, scene)
      expectNoFalseConnections(route, [...scene.routes, ...routes.slice(0, index)])
    }
    expect(new Set(routes.map(route => pointKey(routeEndpoints(route)[0]))).size).toBe(3)
    expect(routeAuxiliaryEdges({
      ...input,
      geometry: { ...scene, cards: [...scene.cards].reverse(), units: [...scene.units].reverse() },
      auxiliaryRelations: [...relations].reverse(),
      primaryRoutes: [...scene.routes].reverse(),
    })).toEqual(routes)
  })

  it('reports a blocked auxiliary relation without replacing otherwise valid primary geometry', () => {
    const spouse = member('a-spouse', { gender: 'male' })
    const godmother = member('b-godmother', { gender: 'female' })
    const godchild = member('c-godchild', { godparents: [{ id: godmother.id, type: 'godparent' }] })
    linkSpouse(spouse, godmother)
    const normalized = normalizeFacts(familyData([spouse, godmother, godchild]))
    const request = {
      ...layoutRequest(normalized, true),
      metrics: { ...DEFAULT_LAYOUT_METRICS, rootGap: 0, cardClearance: 32 },
    }
    const hidden = layoutFamilyScene(request)
    const focused = layoutFamilyScene({ ...request, auxiliaryFocusPersonId: godmother.id })

    expect(focused.routes).toEqual(hidden.routes)
    expect(primaryGeometry(focused)).toEqual(primaryGeometry(hidden))
    expect(focused.diagnostics).toEqual([{
      code: 'UNROUTABLE_AUXILIARY_EDGE',
      ids: ['aux:godparent:b-godmother>c-godchild', 'b-godmother', 'c-godchild'],
      message: '部分辅助连线暂时无法显示：当前卡片间没有找到安全通道。',
    }])
  })

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

function staggeredFamily() {
  const godmother = member('a-godmother', { gender: 'female', birthDate: '1948-10-12' })
  const grandfather = member('b-grandfather', { gender: 'male', birthDate: '1944-03-20' })
  const father = member('c-father', { gender: 'male', birthDate: '1971-08-26' })
  const unrelatedParent = member('d-unrelated-parent', { gender: 'male', birthDate: '1971-09-13' })
  const mother = member('e-mother', { gender: 'female', birthDate: '1970-05-16' })
  const godchild = member('f-godchild', {
    gender: 'female', birthDate: '1995-11-24', godparents: [{ id: godmother.id, type: 'godparent' }],
  })
  const unrelatedChild = member('g-unrelated-child', { gender: 'male', birthDate: '1992-09-20' })
  linkParent(unrelatedParent, grandfather)
  linkParent(unrelatedChild, unrelatedParent)
  linkSpouse(father, mother)
  linkParent(godchild, father)
  linkParent(godchild, mother)
  return familyData([godmother, grandfather, father, unrelatedParent, mother, godchild, unrelatedChild])
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

function expectRouteAvoidsCards(route: RoutedFamilyEdge, geometry: SceneGeometry) {
  for (const segment of route.segments) {
    const [start, end] = segment.points
    for (const { rect } of geometry.cards) {
      const crossesInterior = start.y === end.y
        ? start.y > rect.y && start.y < rect.y + rect.height
          && Math.max(start.x, end.x) > rect.x && Math.min(start.x, end.x) < rect.x + rect.width
        : start.x > rect.x && start.x < rect.x + rect.width
          && Math.max(start.y, end.y) > rect.y && Math.min(start.y, end.y) < rect.y + rect.height
      expect(crossesInterior).toBe(false)
    }
  }
}

function expectNoFalseConnections(route: RoutedFamilyEdge, others: RoutedFamilyEdge[]) {
  const strictlyOnEdge = (point: Point, [a, b]: Edge) => (
    (point.x - a.x) * (b.y - a.y) === (point.y - a.y) * (b.x - a.x)
    && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
    && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
    && pointKey(point) !== pointKey(a) && pointKey(point) !== pointKey(b)
  )
  for (const other of others) {
    expect(route.segments.some(auxiliary => (
      other.segments.some(existing => positiveCollinearOverlap(auxiliary, existing))
    ))).toBe(false)
    for (const auxiliary of routeEdges(route)) {
      for (const existing of routeEdges(other)) {
        expect(auxiliary.some(point => strictlyOnEdge(point, existing))).toBe(false)
        expect(existing.some(point => strictlyOnEdge(point, auxiliary))).toBe(false)
      }
    }
  }
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
