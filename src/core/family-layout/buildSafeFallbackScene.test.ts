import { describe, expect, it } from 'vitest'
import { buildSafeFallbackScene } from './buildSafeFallbackScene'
import { DEFAULT_LAYOUT_METRICS } from './types'
import type {
  LayoutDiagnostic,
  LayoutDomain,
  ParentageGroup,
  Rect,
  RootedFamilyUnit,
} from './types'

describe('buildSafeFallbackScene', () => {
  it('renders malformed cyclic units once without overlap or routes', () => {
    const units = [single('z-parent', ['person-z']), single('a-parent', ['person-a'])]
    const parentageGroups: ParentageGroup[] = [{
      id: 'parentage:z-to-a',
      sourceUnitId: 'z-parent',
      childPersonIds: ['person-a'],
    }, {
      id: 'parentage:a-to-z',
      sourceUnitId: 'a-parent',
      childPersonIds: ['person-z'],
    }]
    const inputDiagnostic: LayoutDiagnostic = {
      code: 'PARENTAGE_CYCLE',
      ids: ['a-parent', 'z-parent'],
      message: 'cycle retained from generation assignment',
    }

    const scene = buildSafeFallbackScene(
      units,
      domainsFor(units),
      parentageGroups,
      DEFAULT_LAYOUT_METRICS,
      [inputDiagnostic],
    )

    expect(scene.routes).toEqual([])
    expect(scene.gateways).toEqual([])
    expect(scene.rootDomains).toHaveLength(1)
    expect(scene.bridgeDomains).toEqual([])
    expect(scene.rootDomains[0].unitIds).toEqual(['a-parent', 'z-parent'])
    expect(scene.cards.map(card => card.id).sort()).toEqual(['person-a', 'person-z'])
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(hasOverlappingRects(scene.cards.map(card => card.rect))).toBe(false)
    expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
    expect(scene.rows).toEqual([{
      id: 'row:domain:test:0',
      generation: 0,
      unitIds: ['a-parent', 'z-parent'],
    }])
    expect(scene.diagnostics).toContainEqual(inputDiagnostic)
    expect(scene.diagnostics.filter(value => (
      value.code === 'UNROUTABLE_PRIMARY_EDGE'
    )).map(value => value.ids)).toEqual([
      ['parentage:a-to-z'],
      ['parentage:z-to-a'],
    ])
  })

  it('places generation rows deterministically with fallback geometry', () => {
    const units = [
      single('child-b', ['child-b-person'], 1),
      couple('parents', ['parent-a', 'parent-b'], 0),
      single('child-a', ['child-a-person'], 1),
    ]
    const groups: ParentageGroup[] = [{
      id: 'parentage:parents',
      sourceUnitId: 'parents',
      childPersonIds: ['child-a-person', 'child-b-person'],
    }]

    const first = buildSafeFallbackScene(
      units,
      domainsFor(units),
      groups,
      DEFAULT_LAYOUT_METRICS,
      [],
    )
    const second = buildSafeFallbackScene(
      structuredClone(units),
      domainsFor(units),
      structuredClone(groups),
      structuredClone(DEFAULT_LAYOUT_METRICS),
      [],
    )

    expect(first.rows.map(row => row.unitIds)).toEqual([
      ['parents'],
      ['child-a', 'child-b'],
    ])
    expect(first.cards.find(card => card.id === 'parent-b')!.rect.x).toBe(
      first.cards.find(card => card.id === 'parent-a')!.rect.x
        + DEFAULT_LAYOUT_METRICS.cardWidth
        + DEFAULT_LAYOUT_METRICS.spouseGap,
    )
    expect(first.units.find(unit => unit.id === 'child-a')!.rect.y).toBe(
      DEFAULT_LAYOUT_METRICS.cardHeight + DEFAULT_LAYOUT_METRICS.generationGap,
    )
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.units.every(unit => unit.domainId === 'domain:test')).toBe(true)
    expect(first.rootDomains[0].rect).toEqual(first.bounds)
    expect(first.routes.map(route => route.routeOwnerId)).toEqual(['parentage:parents'])
    expect(first.diagnostics).toEqual([])
  })

  it('preserves an existing unroutable owner diagnostic without duplicating it', () => {
    const units = [single('parent', ['parent-person'])]
    const groups: ParentageGroup[] = [{
      id: 'parentage:parent',
      sourceUnitId: 'parent',
      childPersonIds: ['missing-child'],
    }]
    const existing: LayoutDiagnostic = {
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['parentage:parent'],
      message: 'Unable to route primary family edge parentage:parent',
    }
    const diagnostics = [existing]

    const scene = buildSafeFallbackScene(
      units,
      domainsFor(units),
      groups,
      DEFAULT_LAYOUT_METRICS,
      diagnostics,
    )

    expect(scene.diagnostics).toEqual([existing])
    expect(diagnostics).toEqual([existing])
  })

  it('keeps a safe route when another parentage is unroutable', () => {
    const units = [
      couple('valid-parents', ['valid-parent-a', 'valid-parent-b'], 0),
      single('broken-parent', ['broken-parent-person']),
      single('valid-child', ['valid-child-person'], 1),
    ]
    const groups: ParentageGroup[] = [{
      id: 'parentage:valid',
      sourceUnitId: 'valid-parents',
      childPersonIds: ['valid-child-person'],
    }, {
      id: 'parentage:broken',
      sourceUnitId: 'broken-parent',
      childPersonIds: ['missing-child-person'],
    }]

    const scene = buildSafeFallbackScene(
      units,
      domainsFor(units),
      groups,
      DEFAULT_LAYOUT_METRICS,
      [],
    )

    expect(scene.routes.map(route => route.routeOwnerId)).toEqual(['parentage:valid'])
    expect(scene.diagnostics.filter(value => (
      value.code === 'UNROUTABLE_PRIMARY_EDGE'
    )).map(value => value.ids)).toEqual([['parentage:broken']])
  })

  it('keeps stable ID order and one family gap across disconnected generations', () => {
    const units = [
      single('z-child', ['z-child-person'], 1),
      single('z-parent', ['z-parent-person']),
      single('a-child', ['a-child-person'], 1),
      single('a-parent', ['a-parent-person']),
    ]
    const groups: ParentageGroup[] = [{
      id: 'parentage:a-parent',
      sourceUnitId: 'a-parent',
      childPersonIds: ['z-child-person'],
    }, {
      id: 'parentage:z-parent',
      sourceUnitId: 'z-parent',
      childPersonIds: ['a-child-person'],
    }]
    const before = JSON.stringify({ units, groups })

    const scene = buildSafeFallbackScene(
      units,
      domainsFor(units),
      groups,
      DEFAULT_LAYOUT_METRICS,
      [],
    )

    expect(scene.rows.map(row => row.unitIds)).toEqual([
      ['a-parent', 'z-parent'],
      ['a-child', 'z-child'],
    ])
    for (const row of scene.rows) {
      const rowUnits = row.unitIds.map(unitId => (
        scene.units.find(unit => unit.id === unitId)!
      ))
      for (let index = 1; index < rowUnits.length; index++) {
        expect(rowUnits[index].rect.x - (
          rowUnits[index - 1].rect.x + rowUnits[index - 1].rect.width
        )).toBe(DEFAULT_LAYOUT_METRICS.familyGap)
      }
    }
    expect(scene.cards.map(card => card.id).sort()).toEqual([
      'a-child-person',
      'a-parent-person',
      'z-child-person',
      'z-parent-person',
    ])
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(hasOverlappingRects(scene.cards.map(card => card.rect))).toBe(false)
    expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
    expect(scene.routes.map(route => route.routeOwnerId).sort()).toEqual([
      'parentage:a-parent',
      'parentage:z-parent',
    ])
    expect(scene.diagnostics).toEqual([])
    expect(JSON.stringify({ units, groups })).toBe(before)
  })
})

function single(id: string, memberIds: string[], generation = 0): RootedFamilyUnit {
  return {
    id,
    kind: 'single',
    memberIds,
    generation,
    width: DEFAULT_LAYOUT_METRICS.cardWidth,
    lineageAffinity: {},
    accent: '#111111',
    rootSignature: ['root:test'],
    domainId: 'domain:test',
    memberRootIds: Object.fromEntries(memberIds.map(memberId => (
      [memberId, 'root:test']
    ))),
    rootAccent: '#111111',
    isRootFamily: generation === 0,
  }
}

function couple(id: string, memberIds: string[], generation: number): RootedFamilyUnit {
  return {
    ...single(id, memberIds, generation),
    kind: 'couple',
    width: DEFAULT_LAYOUT_METRICS.cardWidth * 2 + DEFAULT_LAYOUT_METRICS.spouseGap,
  }
}

function domainsFor(units: RootedFamilyUnit[]): LayoutDomain[] {
  return [{
    id: 'domain:test',
    kind: 'root',
    componentId: 'component:test',
    rootIds: ['root:test'],
    signature: ['root:test'],
    personIds: units.flatMap(unit => unit.memberIds).sort(),
    unitIds: units.map(unit => unit.id).sort(),
    order: 0,
    accent: '#111111',
  }]
}

function hasOverlappingRects(rects: Rect[]): boolean {
  return rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
    leftIndex < rightIndex
    && left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  )))
}
