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
      expect(sidePorts(geometry, relation.sourceId)).toContainEqual(endpoints[0])
      expect(sidePorts(geometry, relation.targetId)).toContainEqual(endpoints[1])
      const corridorPoints = routes[index].segments.slice(2, -2)
        .flatMap(segment => segment.points)
      expect(corridorPoints.length).toBeGreaterThan(0)
      expect(corridorPoints.every(point => (
        point.x % DEFAULT_LAYOUT_METRICS.routeSubgrid === 0
        && point.y % DEFAULT_LAYOUT_METRICS.routeSubgrid === 0
      ))).toBe(true)
    }
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

    expect(JSON.stringify({ units: noFocus.units, cards: noFocus.cards }))
      .toBe(JSON.stringify({ units: hidden.units, cards: hidden.cards }))
    expect(JSON.stringify({ units: focused.units, cards: focused.cards }))
      .toBe(JSON.stringify({ units: hidden.units, cards: hidden.cards }))
    expect(noFocus.routes.filter(route => route.kind !== 'primary')).toEqual([])
    expect(unrelated.routes.filter(route => route.kind !== 'primary')).toEqual([])
    expect(focused.routes.filter(route => route.kind !== 'primary').map(route => route.kind))
      .toEqual(['godparent', 'historical-partnership'])
    expect(Object.fromEntries(focused.cards.map(card => [card.id, card.generation])))
      .toEqual(Object.fromEntries(hidden.cards.map(card => [card.id, card.generation])))
  })
})

function rowGeometry(ids: string[]): SceneGeometry {
  const units = ids.map((id, index) => ({
    id: `unit:${id}`,
    kind: 'single' as const,
    memberIds: [id],
    generation: 0,
    width: 168,
    lineageAffinity: {},
    accent: '#111111',
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
    bounds: { x: 0, y: 0, width: Math.max(0, ids.length * 288 - 120), height: 216 },
  }
}

function routeEndpoints(route: RoutedFamilyEdge): [Point, Point] {
  return [route.segments[0].points[0], route.segments.at(-1)!.points.at(-1)!]
}

function sidePorts(geometry: SceneGeometry, id: string): Point[] {
  const card = geometry.cards.find(value => value.id === id)!
  return [{ x: card.rect.x, y: card.rect.y + card.rect.height / 2 }, {
    x: card.rect.x + card.rect.width,
    y: card.rect.y + card.rect.height / 2,
  }]
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
