import { describe, expect, it } from 'vitest'
import { buildSafeFallbackScene } from './buildSafeFallbackScene'
import { completePrimaryParentageRoutes } from './completePrimaryParentageRoutes'
import { layoutFamilyScene } from './layoutFamilyScene'
import { buildProjectedInput, familyData, linkParent, member } from './testHelpers'
import { DEFAULT_FAMILY_VIEW_POLICY, DEFAULT_LAYOUT_METRICS, EMPTY_LAYOUT_PREFERENCES } from './types'
import { validateScene } from './validateScene'

describe('completePrimaryParentageRoutes', () => {
  it('completes a fallback layout without moving its cards or attributing the other parent source', () => {
    const { facts, scene, groups } = unmarriedFamily()
    const fallback = buildSafeFallbackScene(
      scene.units,
      [...scene.rootDomains, ...scene.bridgeDomains],
      groups,
      DEFAULT_LAYOUT_METRICS,
      [],
    )
    const completed = completePrimaryParentageRoutes(fallback, facts.parentages, groups, DEFAULT_LAYOUT_METRICS)

    expect(completed.cards).toEqual(fallback.cards)
    expect(completed.units).toEqual(fallback.units)
    expect(completed.routes.map(route => route.sourceParentIds)).toEqual([['a'], ['b']])
    expect(completed.routes[1].sourcePersonId).toBe('b')
    expect(completed.diagnostics).toEqual([])
    expect(validateScene(completed, DEFAULT_LAYOUT_METRICS)).toEqual([])
  })

  it('reports an unavailable parent connection instead of borrowing the other parent route', () => {
    const { facts, scene, groups } = unmarriedFamily()
    const incomplete = {
      ...scene,
      cards: scene.cards.filter(card => card.id !== 'b'),
      routes: scene.routes.filter(route => route.sourcePersonId === undefined),
    }
    const completed = completePrimaryParentageRoutes(incomplete, facts.parentages, groups, DEFAULT_LAYOUT_METRICS)

    expect(completed.routes.map(route => route.sourceParentIds)).toEqual([['a']])
    expect(completed.diagnostics).toContainEqual({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['primary-parent:["parentage:a+b","b","child"]', 'b', 'child'],
      message: 'Unable to route primary parent b to child child',
    })
  })
})

function unmarriedFamily() {
  const first = member('a')
  const second = member('b')
  const child = member('child')
  linkParent(child, first)
  linkParent(child, second)
  const { normalized, built } = buildProjectedInput(familyData([first, second, child]))
  const scene = layoutFamilyScene({
    facts: normalized.facts,
    view: DEFAULT_FAMILY_VIEW_POLICY,
    preferences: EMPTY_LAYOUT_PREFERENCES,
    metrics: DEFAULT_LAYOUT_METRICS,
    inputDiagnostics: [],
  })
  return { facts: normalized.facts, scene, groups: built.parentageGroups }
}
