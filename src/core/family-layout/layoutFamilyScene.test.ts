import { describe, expect, it } from 'vitest'
import { normalizeFacts } from './normalizeFacts'
import { familyData, linkParent, linkSpouse, member } from './testHelpers'
import { layoutFamilyScene } from './layoutFamilyScene'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'
import type { FamilyFacts, LayoutRequest, LayoutScene, Rect } from './types'

describe('layoutFamilyScene', () => {
  it('returns an empty zero-sized scene for empty input', () => {
    const scene = layoutFamilyScene(request({ people: [], partnerships: [], parentages: [] }))

    expect(scene).toEqual({
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      routes: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      diagnostics: [],
    })
  })

  it('composes a routable three-generation family scene', () => {
    const grandparents = couple('grandfather', 'grandmother')
    const parents = couple('father', 'mother')
    const child = member('child')
    linkParent(parents[0], grandparents[0])
    linkParent(parents[0], grandparents[1])
    linkParent(child, parents[0])
    linkParent(child, parents[1])

    const scene = layoutFamilyScene(requestFromMembers([
      ...grandparents,
      ...parents,
      child,
    ]))

    expect(scene.cards).toHaveLength(5)
    expect(scene.rows.map(row => row.generation)).toEqual([0, 1, 2])
    expect(scene.routes).toHaveLength(2)
    expect(unsafeDiagnostics(scene)).toEqual([])
    expectNoOverlap(scene)
  })

  it('packs two disconnected families without losing either component', () => {
    const firstParents = couple('first-father', 'first-mother')
    const firstChild = member('first-child')
    linkParent(firstChild, firstParents[0])
    linkParent(firstChild, firstParents[1])
    const secondParents = couple('second-father', 'second-mother')
    const secondChild = member('second-child')
    linkParent(secondChild, secondParents[0])
    linkParent(secondChild, secondParents[1])

    const scene = layoutFamilyScene(requestFromMembers([
      ...secondParents,
      secondChild,
      ...firstParents,
      firstChild,
    ]))

    expect(scene.cards.map(card => card.id).sort()).toEqual([
      'first-child',
      'first-father',
      'first-mother',
      'second-child',
      'second-father',
      'second-mother',
    ])
    expect(scene.routes).toHaveLength(2)
    expect(unsafeDiagnostics(scene)).toEqual([])
    expectNoOverlap(scene)
  })

  it('lays out multiple cross marriages as one safe scene', () => {
    const lineageA = couple('a-parent-left', 'a-parent-right')
    const lineageB = couple('b-parent-left', 'b-parent-right')
    const aChildren = [member('a-child-1'), member('a-child-2')]
    const bChildren = [member('b-child-1'), member('b-child-2')]
    for (const child of aChildren) {
      linkParent(child, lineageA[0])
      linkParent(child, lineageA[1])
    }
    for (const child of bChildren) {
      linkParent(child, lineageB[0])
      linkParent(child, lineageB[1])
    }
    linkSpouse(aChildren[0], bChildren[0])
    linkSpouse(aChildren[1], bChildren[1])

    const scene = layoutFamilyScene(requestFromMembers([
      ...lineageA,
      ...lineageB,
      ...aChildren,
      ...bChildren,
    ]))

    expect(scene.units.filter(unit => unit.kind === 'couple')).toHaveLength(4)
    expect(scene.routes).toHaveLength(2)
    expect(unsafeDiagnostics(scene)).toEqual([])
    expectNoOverlap(scene)
  })

  it('returns byte-identical output without mutating the request', () => {
    const parents = couple('parent-a', 'parent-b')
    const child = member('child')
    linkParent(child, parents[0])
    linkParent(child, parents[1])
    const value = requestFromMembers([child, ...parents])
    const before = JSON.stringify(value)

    const first = layoutFamilyScene(value)
    const second = layoutFamilyScene(structuredClone(value))

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(value)).toBe(before)
  })

  it('retries once with a larger generation gap instead of falling back', () => {
    const parents = couple('parent-a', 'parent-b')
    const child = member('child')
    linkParent(child, parents[0])
    linkParent(child, parents[1])
    const value = requestFromMembers([child, ...parents])
    value.metrics = { ...DEFAULT_LAYOUT_METRICS, generationGap: 8 }

    const scene = layoutFamilyScene(value)

    expect(scene.routes).toHaveLength(1)
    expect(unsafeDiagnostics(scene)).toEqual([])
    expect(scene.units.find(unit => unit.generation === 1)!.rect.y).toBe(
      DEFAULT_LAYOUT_METRICS.cardHeight + 48,
    )
  })

  it('falls back safely when a malformed parentage cycle remains unroutable', () => {
    const first = member('first')
    const second = member('second')
    linkParent(second, first)
    linkParent(first, second)
    const value = requestFromMembers([second, first])
    const before = JSON.stringify(value)

    const scene = layoutFamilyScene(value)

    expect(scene.cards.map(card => card.id).sort()).toEqual(['first', 'second'])
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(2)
    expect(scene.routes).toEqual([])
    expect(scene.diagnostics.some(value => value.code === 'PARENTAGE_CYCLE')).toBe(true)
    expect(scene.diagnostics.filter(value => (
      value.code === 'UNROUTABLE_PRIMARY_EDGE'
    )).some(value => value.ids[0].startsWith('parentage:'))).toBe(true)
    expectNoOverlap(scene)
    expect(JSON.stringify(value)).toBe(before)
  })
})

function requestFromMembers(members: ReturnType<typeof member>[]): LayoutRequest {
  const normalized = normalizeFacts(familyData(members))
  return request(normalized.facts, normalized.diagnostics)
}

function request(facts: FamilyFacts, inputDiagnostics: LayoutRequest['inputDiagnostics'] = []): LayoutRequest {
  return {
    facts,
    view: structuredClone(DEFAULT_FAMILY_VIEW_POLICY),
    preferences: structuredClone(EMPTY_LAYOUT_PREFERENCES),
    metrics: structuredClone(DEFAULT_LAYOUT_METRICS),
    inputDiagnostics,
  }
}

function couple(leftId: string, rightId: string) {
  const left = member(leftId)
  const right = member(rightId)
  linkSpouse(left, right)
  return [left, right] as const
}

function unsafeDiagnostics(scene: LayoutScene) {
  const unsafeCodes = new Set([
    'NODE_OVERLAP',
    'CROSS_FAMILY_SEGMENT_OVERLAP',
    'UNROUTABLE_PRIMARY_EDGE',
  ])
  return scene.diagnostics.filter(value => unsafeCodes.has(value.code))
}

function expectNoOverlap(scene: LayoutScene) {
  expect(hasOverlappingRects(scene.cards.map(card => card.rect))).toBe(false)
  expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
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
