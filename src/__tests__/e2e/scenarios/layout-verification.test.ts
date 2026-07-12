import { describe, expect, it } from 'vitest'
import {
  crossMarriedSiblingsFamily,
  denseBridgeFamily,
  largeFamily,
  manySameGenerationFamilies,
  multiUnionFamily,
  parentageCycleFamily,
  pedigreeCollapseFamily,
} from '@/__tests__/fixtures/families'
import { layoutFamilyTree } from '@/core/treeLayout'
import type { Member } from '@/core/schema'

const UNSAFE_DIAGNOSTIC_CODES = new Set([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
])

const fixtures: Array<[string, () => Record<string, Member>]> = [
  ['cross-married siblings', crossMarriedSiblingsFamily],
  ['dense bridge family', denseBridgeFamily],
  ['pedigree collapse', pedigreeCollapseFamily],
  ['many same-generation families', () => manySameGenerationFamilies(5)],
  ['large deterministic family', () => largeFamily(20260711, 500)],
]

describe('public family layout invariants', () => {
  it.each(fixtures)('renders %s once without hard diagnostics', async (_name, fixture) => {
    const members = Object.values(fixture())
    const scene = await layoutFamilyTree(members)

    expect(scene.cards).toHaveLength(members.length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
  })

  it('retains both cards and diagnoses a parentage cycle', async () => {
    const scene = await layoutFamilyTree(Object.values(parentageCycleFamily()))

    expect(scene.cards.map(card => card.id).sort()).toEqual(['cycle-a', 'cycle-b'])
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.diagnostics.some(diagnostic => (
      diagnostic.code === 'PARENTAGE_CYCLE'
    ))).toBe(true)
  })

  it('renders one current and one historical partnership without hard diagnostics', async () => {
    const members = Object.values(multiUnionFamily())
    const scene = await layoutFamilyTree(members, {
      view: { showHistoricalPartnerships: true },
      auxiliaryFocusPersonId: 'parentA',
    })

    expect(scene.cards).toHaveLength(members.length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.routes.some(route => route.kind === 'historical-partnership')).toBe(true)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
  })
})

describe('largeFamily fixture', () => {
  it('is deterministic, acyclic, stable and caps every parentage at four children', () => {
    const family = largeFamily(20260711, 500)
    const members = Object.values(family)

    expect(largeFamily(20260711, 500)).toEqual(family)
    expect(Object.keys(family)[0]).toBe('person-0001')
    expect(Object.keys(family).at(-1)).toBe('person-0500')
    expect(members).toHaveLength(500)

    const childrenByParentage = new Map<string, number>()
    for (const child of members) {
      for (const parent of child.parents) {
        expect(Number(parent.id.slice('person-'.length))).toBeLessThan(
          Number(child.id.slice('person-'.length)),
        )
        expect(family[parent.id].birthDate! < child.birthDate!).toBe(true)
      }
      if (child.parents.length === 0) continue
      const key = child.parents.map(parent => parent.id).sort().join('+')
      childrenByParentage.set(key, (childrenByParentage.get(key) ?? 0) + 1)
    }
    expect(Math.max(...childrenByParentage.values())).toBeLessThanOrEqual(4)
  })
})
