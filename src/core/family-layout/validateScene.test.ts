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

  it('does not report cross-owner geometry for many routes in distant generations', () => {
    const scene = emptyScene()
    scene.routes = Array.from({ length: 200 }, (_, index) => route(
      `owner:${index}`,
      [horizontal(0, 40, index * 1_000)],
    ))

    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS).filter(diagnostic => (
      diagnostic.code === 'CROSS_FAMILY_SEGMENT_OVERLAP'
      || diagnostic.message.startsWith('Routes ')
    ))).toEqual([])
  })

  it('accepts adjacent distinct source ports on the same card bottom', () => {
    const scene = emptyScene()
    scene.hubs = [{
      id: 'hub:parentage:a+c',
      unitId: 'unit:source',
      point: { x: 40, y: 100 },
    }, {
      id: 'hub:parentage:a+d',
      unitId: 'unit:source',
      point: { x: 56, y: 100 },
    }]
    scene.cards = [
      placedCard('child:c', 'unit:child:c', 20, 200, 8),
      placedCard('child:d', 'unit:child:d', 68, 200, 8),
    ]
    scene.routes = [route('parentage:a+c', [
      vertical(40, 100, 140),
      horizontal(24, 40, 140),
      vertical(24, 140, 200),
    ]), route('parentage:a+d', [
      vertical(56, 100, 148),
      horizontal(56, 72, 148),
      vertical(72, 148, 200),
    ])]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toEqual([])
  })

  it('accepts auxiliary side ports and exact cross-owner endpoint contact', () => {
    const scene = emptyScene()
    scene.units = [
      placedUnit('unit:a', 'a', 0, 0),
      placedUnit('unit:b', 'b', 200, 0),
      placedUnit('unit:c', 'c', 200, 120),
    ]
    scene.cards = [
      placedCard('a', 'unit:a', 0, 0),
      placedCard('b', 'unit:b', 200, 0),
      placedCard('c', 'unit:c', 200, 120),
    ]
    scene.routes = [route('aux:a+b', [horizontal(100, 200, 40)], 'historical-partnership'),
      route('aux:b+c', [vertical(200, 40, 160)], 'secondary-partnership')]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toEqual([])
  })

  it('allows auxiliary owners to cross at one interior point without sharing a segment', () => {
    const scene = emptyScene()
    scene.units = [
      placedUnit('unit:left', 'left', 0, 50),
      placedUnit('unit:right', 'right', 300, 50),
      placedUnit('unit:top', 'top', 50, -100),
      placedUnit('unit:bottom', 'bottom', 150, 200),
    ]
    scene.cards = [
      placedCard('left', 'unit:left', 0, 50),
      placedCard('right', 'unit:right', 300, 50),
      placedCard('top', 'unit:top', 50, -100),
      placedCard('bottom', 'unit:bottom', 150, 200),
    ]
    scene.routes = [
      route('aux:left+right', [horizontal(100, 300, 100)], 'historical-partnership'),
      route('aux:top+bottom', [vertical(150, -50, 250)], 'secondary-partnership'),
    ]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toEqual([])
  })

  it('reports auxiliary-to-auxiliary and auxiliary-to-primary route conflicts', () => {
    const scene = emptyScene()
    scene.routes = [
      route('aux:a', [horizontal(0, 40, 20)], 'historical-partnership'),
      route('aux:b', [horizontal(20, 60, 20)], 'secondary-partnership'),
      route('parentage:c', [vertical(10, 20, 60)]),
    ]

    const diagnostics = validateScene(scene, DEFAULT_LAYOUT_METRICS)

    expect(diagnostics).toContainEqual({
      code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
      ids: ['aux:a', 'aux:b'],
      message: 'Routes aux:a and aux:b share a collinear segment',
    })
    expect(diagnostics).toContainEqual({
      code: 'CROSS_FAMILY_SEGMENT_OVERLAP',
      ids: ['aux:a', 'parentage:c'],
      message: 'Routes aux:a and parentage:c form a false T-junction',
    })
  })

  it('reports an auxiliary route with one dangling side endpoint', () => {
    const scene = emptyScene()
    scene.cards = [placedCard('a', 'unit:a', 0, 0)]
    scene.routes = [route(
      'aux:dangling',
      [horizontal(100, 160, 50)],
      'historical-partnership',
    )]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toEqual([{
        code: 'UNROUTABLE_PRIMARY_EDGE',
        ids: ['aux:dangling'],
        message: 'Route aux:dangling has dangling or mismatched endpoints',
      }])
  })

  it('reports an auxiliary route whose two side endpoints belong to the same card', () => {
    const scene = emptyScene()
    scene.cards = [placedCard('a', 'unit:a', 0, 0)]
    scene.routes = [route('aux:same-card', [
      horizontal(0, -20, 40),
      vertical(-20, 40, 60),
      horizontal(-20, 100, 60),
    ], 'historical-partnership')]

    expect(validateScene(scene, { ...DEFAULT_LAYOUT_METRICS, cardClearance: 0 }))
      .toContainEqual({
        code: 'UNROUTABLE_PRIMARY_EDGE',
        ids: ['aux:same-card'],
        message: 'Route aux:same-card has dangling or mismatched endpoints',
      })
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

function route(
  routeOwnerId: string,
  segments: RoutedFamilyEdge['segments'],
  kind: RoutedFamilyEdge['kind'] = 'primary',
): RoutedFamilyEdge {
  return {
    id: `route:${routeOwnerId}`,
    routeOwnerId,
    kind,
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
