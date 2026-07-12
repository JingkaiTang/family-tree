import { describe, expect, it } from 'vitest'
import { routeFamilyLanes } from './routeFamilyLanes'
import { materializeSceneGeometry } from './materializeSceneGeometry'
import { positiveCollinearOverlap } from './testHelpers'
import { validateScene } from './validateScene'
import {
  DEFAULT_LAYOUT_METRICS,
  type FamilyUnit,
  type ParentageGroup,
  type Point,
  type Rect,
  type RouteSegment,
  type SceneGeometry,
} from './types'

describe('routeFamilyLanes', () => {
  it('allocates family-owned lanes without cross-owner segment sharing', () => {
    const fixture = overlappingFamilyFixture(5)

    const result = routeFamilyLanes({
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.routes).toHaveLength(5)
    expect(new Set(result.routes.map(route => route.routeOwnerId))).toEqual(
      new Set(fixture.parentageGroups.map(group => group.id)),
    )
    for (let i = 0; i < result.routes.length; i++) {
      for (let j = i + 1; j < result.routes.length; j++) {
        if (result.routes[i].routeOwnerId === result.routes[j].routeOwnerId) continue
        for (const left of result.routes[i].segments) {
          for (const right of result.routes[j].segments) {
            expect(positiveCollinearOverlap(left, right)).toBe(false)
          }
        }
      }
    }
  })

  it('allocates lanes from the complete horizontal footprint including a source connector', () => {
    const firstParent = narrowUnit('first-parent', 0, 0, 'first')
    const secondParent = narrowUnit('second-parent', 200, 0, 'second')
    const firstChildren = [
      narrowUnit('first-child-left', 400, 576, ''),
      narrowUnit('first-child-right', 640, 576, ''),
    ]
    const secondChildren = [
      narrowUnit('second-child-left', 100, 576, ''),
      narrowUnit('second-child-right', 340, 576, ''),
    ]
    const units = [firstParent, secondParent, ...firstChildren, ...secondChildren]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: firstChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: secondChildren.map(unit => unit.memberIds[0]),
    }]
    const geometry = geometryFor(units, [firstParent, secondParent])
    const metrics = { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }

    const result = routeFamilyLanes({ geometry, units, parentageGroups, metrics })

    expect(result.diagnostics).toEqual([])
    for (const left of result.routes[0].segments) {
      for (const right of result.routes[1].segments) {
        expect(positiveCollinearOverlap(left, right)).toBe(false)
      }
    }
    expect(new Set(result.routes.flatMap(route => route.segments
      .filter(segment => segment.orientation === 'horizontal')
      .map(segment => segment.points[0].y))).size).toBeGreaterThan(1)
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, metrics))
      .toEqual([])
  })

  it('tracks shifted terminal stubs outside the route lane y', () => {
    const firstParent = narrowUnit('first-parent', 500, 0, 'first', 2)
    const secondParent = narrowUnit('second-parent', 100, 0, 'second', 2)
    const thirdParent = narrowUnit('third-parent', 104, 0, 'third', 2)
    const firstChildren = [100, 104, 1000].map((x, index) => (
      narrowUnit(`first-child-${index}`, x, 576, '', 2)
    ))
    const secondChildren = [400, 640].map((x, index) => (
      narrowUnit(`second-child-${index}`, x, 576, '', 2)
    ))
    const thirdChildren = [700, 940].map((x, index) => (
      narrowUnit(`third-child-${index}`, x, 576, '', 2)
    ))
    const units = [
      firstParent,
      secondParent,
      thirdParent,
      ...firstChildren,
      ...secondChildren,
      ...thirdChildren,
    ]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: firstChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: secondChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:third',
      sourceUnitId: thirdParent.id,
      childPersonIds: thirdChildren.map(unit => unit.memberIds[0]),
    }]
    const geometry = geometryFor(units, [firstParent, secondParent, thirdParent])
    const metrics = { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }

    const result = routeFamilyLanes({ geometry, units, parentageGroups, metrics })

    expect(result.routes.map(route => route.routeOwnerId)).toEqual([
      'parentage:first',
      'parentage:second',
    ])
    expect(result.diagnostics).toEqual([{
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['parentage:third'],
      message: 'Unable to route primary family edge parentage:third',
    }])
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, metrics))
      .toEqual([])
  })

  it('attaches each owner exactly to its hub and child top ports', () => {
    const fixture = overlappingFamilyFixture(5)

    const result = routeFamilyLanes({
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    for (const group of fixture.parentageGroups) {
      const route = result.routes.find(value => value.routeOwnerId === group.id)!
      const hub = fixture.geometry.hubs.find(value => value.unitId === group.sourceUnitId)!
      expect(route.segments[0].points[0]).toEqual(hub.point)
      expect(route.accent).toBe(
        fixture.units.find(unit => unit.id === group.sourceUnitId)!.accent,
      )
      const endpoints = route.segments.flatMap(segment => [
        segment.points[0],
        segment.points.at(-1)!,
      ])
      for (const childId of group.childPersonIds) {
        const card = fixture.geometry.cards.find(value => value.id === childId)!
        expect(endpoints).toContainEqual(topPort(card.rect))
      }
    }
  })

  it('keeps routes outside expanded unrelated cards and marks crossings as bridges', () => {
    const fixture = overlappingFamilyFixture(5)

    const result = routeFamilyLanes({
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.routes.flatMap(route => route.segments)
      .some(segment => segment.orientation === 'bridge')).toBe(true)
    for (const route of result.routes) {
      const group = fixture.parentageGroups.find(value => value.id === route.routeOwnerId)!
      const source = fixture.units.find(value => value.id === group.sourceUnitId)!
      const ownCardIds = new Set([...source.memberIds, ...group.childPersonIds])
      for (const segment of route.segments) {
        for (const card of fixture.geometry.cards) {
          if (ownCardIds.has(card.id)) continue
          expect(segmentIntersectsRect(
            segment,
            expandRect(card.rect, DEFAULT_LAYOUT_METRICS.cardClearance),
          )).toBe(false)
        }
      }
    }
  })

  it('shares one bus only within the same parentage owner', () => {
    const fixture = overlappingFamilyFixture(1)

    const result = routeFamilyLanes({
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    const route = result.routes[0]
    expect(route.routeOwnerId).toBe(fixture.parentageGroups[0].id)
    expect(route.segments.filter(segment => segment.orientation === 'horizontal'))
      .toHaveLength(1)
    expect(route.segments.filter(segment => segment.orientation === 'vertical'))
      .toHaveLength(3)
  })

  it('shifts a colliding source vertical without creating a false T-junction', () => {
    const firstParent = singleUnit('first-parent', 960, 0, 'first')
    const secondParent = singleUnit('second-parent', 480, 0, 'second')
    const firstChildren = [
      singleUnit('first-child-left', 480, 576, ''),
      singleUnit('first-child-right', 1920, 576, ''),
    ]
    const secondChildren = [
      singleUnit('second-child-left', 240, 576, ''),
      singleUnit('second-child-right', 960, 576, ''),
    ]
    const units = [firstParent, secondParent, ...firstChildren, ...secondChildren]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: firstChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: secondChildren.map(unit => unit.memberIds[0]),
    }]
    const geometry = geometryFor(units, [firstParent, secondParent])

    const result = routeFamilyLanes({
      geometry,
      units,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.diagnostics).toEqual([])
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, DEFAULT_LAYOUT_METRICS))
      .toEqual([])
  })

  it('separates touching single-child connectors owned by different families', () => {
    const firstParent = singleUnit('first-parent', 0, 0, 'first')
    const secondParent = singleUnit('second-parent', 480, 0, 'second')
    const firstChild = singleUnit('first-child', 480, 576, '')
    const secondChild = singleUnit('second-child', 960, 576, '')
    const units = [firstParent, secondParent, firstChild, secondChild]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: [firstChild.memberIds[0]],
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: [secondChild.memberIds[0]],
    }]
    const geometry = geometryFor(units, [firstParent, secondParent])

    const result = routeFamilyLanes({
      geometry,
      units,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.diagnostics).toEqual([])
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, DEFAULT_LAYOUT_METRICS))
      .toEqual([])
  })

  it('keeps a free source stem exact when the child is behind an unrelated unit', () => {
    const filler = overlappingFamilyFixture(40)
    const targetBase = 200_000
    const source = coupleUnit('source', targetBase, 0, 'source')
    const obstacle = coupleUnit('obstacle', targetBase + 432, 0, 'obstacle')
    const child = singleUnit('child', targetBase + 480, 576, '')
    const units = [...filler.units, source, obstacle, child]
    const parentageGroups: ParentageGroup[] = [...filler.parentageGroups, {
      id: 'parentage:source',
      sourceUnitId: source.id,
      childPersonIds: child.memberIds,
    }]
    const geometry = materializeSceneGeometry({
      placedUnits: units.map((unit, order) => ({ ...unit, order })),
      rows: [{
        generation: 0,
        unitIds: units.filter(unit => unit.generation === 0).map(unit => unit.id),
      }, {
        generation: 1,
        unitIds: units.filter(unit => unit.generation === 1).map(unit => unit.id),
      }],
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    const result = routeFamilyLanes({
      geometry,
      units,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.diagnostics).toEqual([])
    const route = result.routes.find(value => value.routeOwnerId === 'parentage:source')!
    expect(route.segments.some(segment => (
      segment.orientation === 'vertical'
      && segment.points.every(point => point.x === targetBase + 180)
    ))).toBe(true)
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, DEFAULT_LAYOUT_METRICS))
      .toEqual([])
  })

  it('emits a bridge when a crossing is closer than half a subgrid to a bus end', () => {
    const firstParent = singleUnit('first-parent', 720, 0, 'first')
    const secondParent = singleUnit('second-parent', 482, 0, 'second')
    const firstChildren = [
      singleUnit('first-child-left', 480, 576, ''),
      singleUnit('first-child-right', 960, 576, ''),
    ]
    const secondChildren = [
      singleUnit('second-child-left', 240, 576, ''),
      singleUnit('second-child-right', 720, 576, ''),
    ]
    const units = [firstParent, secondParent, ...firstChildren, ...secondChildren]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: firstChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: secondChildren.map(unit => unit.memberIds[0]),
    }]
    const geometry = geometryFor(units, [firstParent, secondParent])

    const result = routeFamilyLanes({
      geometry,
      units,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    const firstRoute = result.routes.find(route => route.routeOwnerId === 'parentage:first')!
    expect(firstRoute.segments.some(segment => (
      segment.orientation === 'bridge'
      && segment.points.some(point => point.x === 566)
    ))).toBe(true)
    expect(validateScene({ ...geometry, routes: result.routes, diagnostics: [] }, DEFAULT_LAYOUT_METRICS))
      .toEqual([])
  })

  it('omits an owner and reports an unroutable primary edge when no lane fits', () => {
    const fixture = overlappingFamilyFixture(1, 224)

    const result = routeFamilyLanes({
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: { ...DEFAULT_LAYOUT_METRICS, generationGap: 8 },
    })

    expect(result.routes).toEqual([])
    expect(result.diagnostics).toEqual([{
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: [fixture.parentageGroups[0].id],
      message: `Unable to route primary family edge ${fixture.parentageGroups[0].id}`,
    }])
  })

  it('releases lane occupancy when an obstacle makes an earlier owner unroutable', () => {
    const firstParent = singleUnit('first-parent', 480, 0, 'first')
    const secondParent = singleUnit('second-parent', 240, 0, 'second')
    const firstChildren = [
      singleUnit('first-child-left', 0, 244, ''),
      singleUnit('first-child-right', 960, 244, ''),
    ]
    const secondChildren = [
      singleUnit('second-child-left', 240, 244, ''),
      singleUnit('second-child-right', 720, 244, ''),
    ]
    const units = [firstParent, secondParent, ...firstChildren, ...secondChildren]
    const parentageGroups = [{
      id: 'parentage:first',
      sourceUnitId: firstParent.id,
      childPersonIds: firstChildren.map(unit => unit.memberIds[0]),
    }, {
      id: 'parentage:second',
      sourceUnitId: secondParent.id,
      childPersonIds: secondChildren.map(unit => unit.memberIds[0]),
    }]
    const geometry = geometryFor(units, [firstParent, secondParent])
    geometry.cards.push({
      id: 'obstacle',
      unitId: 'unit:obstacle',
      generation: 0,
      rect: { x: 80, y: 216, width: 8, height: 8 },
    })

    const result = routeFamilyLanes({
      geometry,
      units,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(result.routes.map(route => route.routeOwnerId)).toEqual(['parentage:second'])
    expect(result.diagnostics).toEqual([{
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['parentage:first'],
      message: 'Unable to route primary family edge parentage:first',
    }])
  })

  it('routes many families completely and deterministically', () => {
    const fixture = overlappingFamilyFixture(40)
    const input = {
      geometry: fixture.geometry,
      units: fixture.units,
      parentageGroups: fixture.parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    }

    const first = routeFamilyLanes(input)
    const second = routeFamilyLanes(structuredClone(input))

    expect(first.routes).toHaveLength(40)
    expect(first.diagnostics).toEqual([])
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

function overlappingFamilyFixture(
  familyCount: number,
  childY = DEFAULT_LAYOUT_METRICS.cardHeight + DEFAULT_LAYOUT_METRICS.generationGap,
): {
  units: Array<FamilyUnit & { rect: Rect }>
  parentageGroups: ParentageGroup[]
  geometry: SceneGeometry
} {
  const childSpacing = DEFAULT_LAYOUT_METRICS.cardWidth + DEFAULT_LAYOUT_METRICS.familyGap
  const parentSpacing = childSpacing * 3
  const sourceUnits = Array.from({ length: familyCount }, (_, index) => (
    singleUnit(`parent-${index}`, index * parentSpacing, 0, `accent-${index}`)
  ))
  const leftChildren = Array.from({ length: familyCount }, (_, index) => (
    singleUnit(`child-left-${index}`, index * childSpacing, childY, '')
  ))
  const rightChildren = Array.from({ length: familyCount }, (_, index) => (
    singleUnit(
      `child-right-${index}`,
      (familyCount * 6 - index) * childSpacing,
      childY,
      '',
    )
  ))
  const units = [...sourceUnits, ...leftChildren, ...rightChildren]
  const parentageGroups = sourceUnits.map((source, index) => ({
    id: `parentage:${index.toString().padStart(3, '0')}`,
    sourceUnitId: source.id,
    childPersonIds: [
      leftChildren[index].memberIds[0],
      rightChildren[index].memberIds[0],
    ],
  }))
  return {
    units,
    parentageGroups,
    geometry: geometryFor(units, sourceUnits),
  }
}

function geometryFor(
  units: Array<FamilyUnit & { rect: Rect }>,
  sourceUnits: Array<FamilyUnit & { rect: Rect }>,
): SceneGeometry {
  const cards = units.map(unit => ({
    id: unit.memberIds[0],
    unitId: unit.id,
    generation: unit.generation,
    rect: { ...unit.rect },
  }))
  const hubs = sourceUnits.map(unit => ({
    id: `hub:${unit.id}`,
    unitId: unit.id,
    point: {
      x: unit.rect.x + unit.rect.width / 2,
      y: unit.rect.y + unit.rect.height,
    },
  }))
  const right = Math.max(...units.map(unit => unit.rect.x + unit.rect.width))
  const bottom = Math.max(...units.map(unit => unit.rect.y + unit.rect.height))
  return {
    units: units.map((unit, order) => ({ ...unit, order })),
    cards,
    hubs,
    rows: [{
      id: 'row:0',
      generation: 0,
      unitIds: sourceUnits.map(unit => unit.id),
    }, {
      id: 'row:1',
      generation: 1,
      unitIds: units.filter(unit => unit.generation === 1).map(unit => unit.id),
    }],
    bounds: { x: 0, y: 0, width: right, height: bottom },
  }
}

function singleUnit(id: string, x: number, y: number, accent: string): FamilyUnit & { rect: Rect } {
  return {
    id: `unit:person:${id}`,
    kind: 'single',
    memberIds: [id],
    generation: y === 0 ? 0 : 1,
    width: DEFAULT_LAYOUT_METRICS.cardWidth,
    lineageAffinity: {},
    accent,
    rect: {
      x,
      y,
      width: DEFAULT_LAYOUT_METRICS.cardWidth,
      height: DEFAULT_LAYOUT_METRICS.cardHeight,
    },
  }
}

function coupleUnit(id: string, x: number, y: number, accent: string): FamilyUnit & { rect: Rect } {
  return {
    id: `unit:partnership:${id}`,
    kind: 'couple',
    memberIds: [`${id}-left`, `${id}-right`],
    generation: y === 0 ? 0 : 1,
    width: DEFAULT_LAYOUT_METRICS.cardWidth * 2 + DEFAULT_LAYOUT_METRICS.spouseGap,
    lineageAffinity: {},
    accent,
    rect: {
      x,
      y,
      width: DEFAULT_LAYOUT_METRICS.cardWidth * 2 + DEFAULT_LAYOUT_METRICS.spouseGap,
      height: DEFAULT_LAYOUT_METRICS.cardHeight,
    },
  }
}

function narrowUnit(
  id: string,
  centerX: number,
  y: number,
  accent: string,
  size = 8,
): FamilyUnit & { rect: Rect } {
  return {
    id: `unit:person:${id}`,
    kind: 'single',
    memberIds: [id],
    generation: y === 0 ? 0 : 1,
    width: size,
    lineageAffinity: {},
    accent,
    rect: {
      x: centerX - size / 2,
      y,
      width: size,
      height: DEFAULT_LAYOUT_METRICS.cardHeight,
    },
  }
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

function segmentIntersectsRect(segment: RouteSegment, rect: Rect): boolean {
  const points = segment.points
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1]
    const right = points[index]
    if (
      Math.max(left.x, right.x) > rect.x
      && Math.min(left.x, right.x) < rect.x + rect.width
      && Math.max(left.y, right.y) > rect.y
      && Math.min(left.y, right.y) < rect.y + rect.height
    ) return true
  }
  return false
}
