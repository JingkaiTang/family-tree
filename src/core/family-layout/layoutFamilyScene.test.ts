import { describe, expect, it } from 'vitest'
import { normalizeFacts } from './normalizeFacts'
import { familyData, linkParent, linkSpouse, member } from './testHelpers'
import { layoutFamilyScene } from './layoutFamilyScene'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'
import type { FamilyFacts, LayoutRequest, Rect, RootLayoutScene } from './types'

describe('layoutFamilyScene', () => {
  it('returns an empty zero-sized scene for empty input', () => {
    const scene = layoutFamilyScene(request({ people: [], partnerships: [], parentages: [] }))

    expect(scene).toEqual({
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      rootDomains: [],
      bridgeDomains: [],
      gateways: [],
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
    expect(scene.rootDomains).toHaveLength(1)
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
    expect(scene.rootDomains).toHaveLength(2)
    expect(unsafeDiagnostics(scene)).toEqual([])
    expectNoOverlap(scene)
  })

  it('keeps an unchanged disconnected component fixed when an earlier domain shrinks', () => {
    const before = layoutFamilyScene(disconnectedResizeRequest(3))
    const afterRequest = disconnectedResizeRequest(1)
    afterRequest.previousScene = before
    afterRequest.changedIds = ['a-child-2', 'a-child-3']

    const after = layoutFamilyScene(afterRequest)

    expect(componentGeometry(after, 'component:z-child')).toEqual(
      componentGeometry(before, 'component:z-child'),
    )
  })

  it('keeps root color and neighborhood when adding an earlier ancestor family', () => {
    const beforeMembers = ancestorLineage(false)
    const before = layoutFamilyScene(requestFromMembers(beforeMembers))
    const afterMembers = ancestorLineage(true)
    const afterRequest = requestFromMembers(afterMembers)
    afterRequest.previousScene = before
    afterRequest.changedIds = ['new-a0', 'new-a0-spouse', 'a0']

    const after = layoutFamilyScene(afterRequest)
    const oldDomain = before.rootDomains.find(domain => (
      domain.id === 'domain:root:a0+a0-spouse'
    ))!
    const newDomain = after.rootDomains.find(domain => (
      domain.id === 'domain:root:new-a0+new-a0-spouse'
    ))!

    expect(newDomain.accent).toBe(oldDomain.accent)
    expect(Math.abs(centerX(newDomain.rect) - centerX(oldDomain.rect)))
      .toBeLessThanOrEqual(DEFAULT_LAYOUT_METRICS.gridSize * 2)
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

function disconnectedResizeRequest(aChildCount: number): LayoutRequest {
  const aParents = couple('a-root-a', 'a-root-b')
  const aChildren = Array.from({ length: aChildCount }, (_, index) => (
    member(`a-child-${index + 1}`)
  ))
  for (const child of aChildren) {
    linkParent(child, aParents[0])
    linkParent(child, aParents[1])
  }
  const zParents = couple('z-root-a', 'z-root-b')
  const zChild = member('z-child')
  linkParent(zChild, zParents[0])
  linkParent(zChild, zParents[1])
  return requestFromMembers([...aParents, ...aChildren, ...zParents, zChild])
}

function ancestorLineage(withAncestor: boolean) {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const a1 = member('a1')
  linkSpouse(a0, a0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)
  if (!withAncestor) return [a0, a0Spouse, a1]
  const newA0 = member('new-a0')
  const newA0Spouse = member('new-a0-spouse')
  linkSpouse(newA0, newA0Spouse)
  linkParent(a0, newA0)
  linkParent(a0, newA0Spouse)
  return [newA0, newA0Spouse, a0, a0Spouse, a1]
}

function componentGeometry(scene: RootLayoutScene, componentId: string) {
  const domains = [...scene.rootDomains, ...scene.bridgeDomains]
    .filter(domain => domain.componentId === componentId)
  const domainIds = new Set(domains.map(domain => domain.id))
  return {
    domains: domains.map(domain => ({ id: domain.id, rect: domain.rect })),
    units: scene.units
      .filter(unit => domainIds.has(unit.domainId))
      .map(unit => ({ id: unit.id, rect: unit.rect })),
  }
}

function centerX(rect: Rect): number {
  return rect.x + rect.width / 2
}

function unsafeDiagnostics(scene: RootLayoutScene) {
  const unsafeCodes = new Set([
    'NODE_OVERLAP',
    'CROSS_FAMILY_SEGMENT_OVERLAP',
    'INVALID_ROOT_DOMAIN_ASSIGNMENT',
    'ROOT_DOMAIN_INTRUSION',
    'UNROUTABLE_PRIMARY_EDGE',
  ])
  return scene.diagnostics.filter(value => unsafeCodes.has(value.code))
}

function expectNoOverlap(scene: RootLayoutScene) {
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
