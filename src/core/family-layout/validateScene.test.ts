import { describe, expect, it } from 'vitest'
import { validateScene } from './validateScene'
import { DEFAULT_LAYOUT_METRICS, type LayoutScene, type RoutedFamilyEdge } from './types'

describe('validateScene', () => {
  it('accepts an attached obstacle-free family route', () => {
    const scene = baseScene()
    scene.routes = [route('parentage:valid', [
      vertical(50, 100, 140),
      horizontal(50, 250, 140),
      vertical(250, 140, 200),
    ])]

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toEqual([])
  })

  it('keeps a normal bridge path topologically connected through bridge endpoints', () => {
    const scene = emptyScene()
    scene.hubs = [{ id: 'hub:source', unitId: 'unit:source', point: { x: 0, y: 20 } }]
    scene.cards = [placedCard('child', 'unit:child', 36, 20, 8)]
    scene.routes = [route('parentage:bridge', [{
      orientation: 'horizontal',
      points: [{ x: 0, y: 20 }, { x: 10, y: 20 }],
    }, {
      orientation: 'bridge',
      points: [{ x: 10, y: 20 }, { x: 20, y: 10 }, { x: 30, y: 20 }],
    }, {
      orientation: 'horizontal',
      points: [{ x: 30, y: 20 }, { x: 40, y: 20 }],
    }])]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toEqual([])
  })

  it('does not connect a disconnected component through a bridge interior point', () => {
    const scene = emptyScene()
    scene.hubs = [{ id: 'hub:source', unitId: 'unit:source', point: { x: 0, y: 20 } }]
    scene.cards = [
      placedCard('child', 'unit:child', 36, 20, 8),
      placedCard('detached', 'unit:detached', 16, 0, 8),
    ]
    scene.routes = [route('parentage:disconnected', [{
      orientation: 'horizontal',
      points: [{ x: 0, y: 20 }, { x: 10, y: 20 }],
    }, {
      orientation: 'bridge',
      points: [{ x: 10, y: 20 }, { x: 20, y: 10 }, { x: 30, y: 20 }],
    }, {
      orientation: 'horizontal',
      points: [{ x: 30, y: 20 }, { x: 40, y: 20 }],
    }, {
      orientation: 'vertical',
      points: [{ x: 20, y: 0 }, { x: 20, y: 10 }],
    }])]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toContainEqual({
        code: 'UNROUTABLE_PRIMARY_EDGE',
        ids: ['parentage:disconnected'],
        message: 'Route parentage:disconnected is disconnected',
      })
  })

  it('reports card and unit overlaps deterministically', () => {
    const scene = emptyScene()
    scene.units = [placedUnit('unit:b', 'b', 40, 0), placedUnit('unit:a', 'a', 0, 0)]
    scene.cards = [placedCard('card:b', 'unit:b', 40, 0), placedCard('card:a', 'unit:a', 0, 0)]

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toEqual([{
      code: 'NODE_OVERLAP',
      ids: ['card:a', 'card:b'],
      message: 'Person cards card:a and card:b overlap',
    }, {
      code: 'NODE_OVERLAP',
      ids: ['unit:a', 'unit:b'],
      message: 'Family units unit:a and unit:b overlap',
    }])
  })

  it('reports a route intersecting an unrelated card obstacle', () => {
    const scene = baseScene()
    scene.cards.push(placedCard('obstacle', 'unit:obstacle', 100, 120))
    scene.routes = [route('parentage:blocked', [
      vertical(50, 100, 150),
      horizontal(50, 250, 150),
      vertical(250, 150, 200),
    ])]

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toContainEqual({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['obstacle', 'parentage:blocked'],
      message: 'Route parentage:blocked intersects card obstacle',
    })
  })

  it('reports cross-owner collinear sharing and false T-junctions', () => {
    const scene = emptyScene()
    scene.routes = [
      route('owner:a', [horizontal(0, 40, 20)]),
      route('owner:b', [horizontal(20, 60, 20)]),
      route('owner:c', [vertical(10, 20, 60)]),
    ]

    const diagnostics = validateScene(scene, DEFAULT_LAYOUT_METRICS)

    expect(diagnostics).toContainEqual({
      code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
      ids: ['owner:a', 'owner:b'],
      message: 'Routes owner:a and owner:b share a collinear segment',
    })
    expect(diagnostics).toContainEqual({
      code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
      ids: ['owner:a', 'owner:c'],
      message: 'Routes owner:a and owner:c form a false T-junction',
    })
  })

  it('reports a perpendicular cross-owner intersection without bridge metadata', () => {
    const scene = emptyScene()
    scene.routes = [
      route('owner:horizontal', [horizontal(0, 40, 20)]),
      route('owner:vertical', [vertical(20, 0, 40)]),
    ]

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toContainEqual({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['owner:horizontal', 'owner:vertical'],
      message: 'Routes owner:horizontal and owner:vertical cross without a bridge',
    })
  })

  it('reports dangling route endpoints that match neither a hub nor a card port', () => {
    const scene = emptyScene()
    scene.routes = [route('parentage:dangling', [vertical(10, 10, 30)])]

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toEqual([{
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['parentage:dangling'],
      message: 'Route parentage:dangling has dangling or mismatched endpoints',
    }])
  })
})

function baseScene(): LayoutScene {
  const scene = emptyScene()
  scene.units = [placedUnit('unit:parent', 'parent', 0, 0), placedUnit('unit:child', 'child', 200, 200)]
  scene.cards = [placedCard('parent', 'unit:parent', 0, 0), placedCard('child', 'unit:child', 200, 200)]
  scene.hubs = [{ id: 'hub:unit:parent', unitId: 'unit:parent', point: { x: 50, y: 100 } }]
  return scene
}

function emptyScene(): LayoutScene {
  return {
    units: [],
    cards: [],
    hubs: [],
    rows: [],
    routes: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    diagnostics: [],
  }
}

function placedUnit(id: string, personId: string, x: number, y: number) {
  return {
    id,
    kind: 'single' as const,
    memberIds: [personId],
    generation: y === 0 ? 0 : 1,
    width: 100,
    lineageAffinity: {},
    accent: '',
    rect: { x, y, width: 100, height: 100 },
    order: 0,
  }
}

function placedCard(id: string, unitId: string, x: number, y: number, size = 100) {
  return {
    id,
    unitId,
    generation: y === 0 ? 0 : 1,
    rect: { x, y, width: size, height: size },
  }
}

function route(routeOwnerId: string, segments: RoutedFamilyEdge['segments']): RoutedFamilyEdge {
  return {
    id: `route:${routeOwnerId}`,
    routeOwnerId,
    kind: 'primary',
    accent: '',
    segments,
  }
}

function horizontal(fromX: number, toX: number, y: number) {
  return { orientation: 'horizontal' as const, points: [{ x: fromX, y }, { x: toX, y }] }
}

function vertical(x: number, fromY: number, toY: number) {
  return { orientation: 'vertical' as const, points: [{ x, y: fromY }, { x, y: toY }] }
}
