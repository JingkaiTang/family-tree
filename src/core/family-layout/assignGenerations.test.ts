import { describe, expect, it } from 'vitest'
import { buildFamilyUnits } from './buildFamilyUnits'
import { assignGenerations } from './assignGenerations'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'
import { buildProjectedInput, familyData, linkParent, linkSpouse, member } from './testHelpers'

describe('assignGenerations', () => {
  it('keeps spouses in one unit and therefore on the same generation', () => {
    const parentA = member('parent-a')
    const parentB = member('parent-b')
    const child = member('child')
    linkSpouse(parentA, parentB)
    linkParent(child, parentA)
    linkParent(child, parentB)
    const input = buildProjectedInput(familyData([child, parentB, parentA]))

    const result = assignGenerations(input.projected, input.built)
    const parentUnitId = input.built.unitIdByPersonId[parentA.id]

    expect(input.built.unitIdByPersonId[parentB.id]).toBe(parentUnitId)
    expect(result.generationByUnitId).toEqual({
      [parentUnitId]: 0,
      'unit:person:child': 1,
    })
  })

  it('assigns three generations from parent-child constraints', () => {
    const grandparent = member('grandparent')
    const parent = member('parent')
    const child = member('child')
    linkParent(parent, grandparent)
    linkParent(child, parent)
    const input = buildProjectedInput(familyData([child, grandparent, parent]))

    const result = assignGenerations(input.projected, input.built)

    expect(result.generationByUnitId).toEqual({
      'unit:person:child': 2,
      'unit:person:grandparent': 0,
      'unit:person:parent': 1,
    })
  })

  it('does not use godparent relations to assign generations', () => {
    const godparent = member('godparent')
    const child = member('child', {
      godparents: [{ id: godparent.id, type: 'godparent' }],
    })
    godparent.godchildren.push({ id: child.id, type: 'godchild' })
    const normalized = normalizeFacts(familyData([godparent, child]))
    const projected = projectView(normalized.facts, {
      ...DEFAULT_FAMILY_VIEW_POLICY,
      showGodparentRelations: true,
    })
    const built = buildFamilyUnits(
      projected,
      EMPTY_LAYOUT_PREFERENCES,
      DEFAULT_LAYOUT_METRICS,
    )

    const result = assignGenerations(projected, built)

    expect(projected.auxiliaryRelations).toContainEqual({
      id: 'aux:godparent:godparent>child',
      kind: 'godparent',
      sourceId: 'godparent',
      targetId: 'child',
    })
    expect(result.generationByUnitId).toEqual({
      'unit:person:child': 0,
      'unit:person:godparent': 0,
    })
  })

  it('supports pedigree collapse without reporting a cycle', () => {
    const ancestor = member('ancestor')
    const branchA = member('branch-a')
    const branchB = member('branch-b')
    const descendantA = member('descendant-a')
    const descendantB = member('descendant-b')
    linkParent(branchA, ancestor)
    linkParent(branchB, ancestor)
    linkParent(descendantA, branchA)
    linkParent(descendantB, branchB)
    linkSpouse(descendantA, descendantB)
    const input = buildProjectedInput(familyData([
      descendantB,
      branchA,
      ancestor,
      descendantA,
      branchB,
    ]))

    const result = assignGenerations(input.projected, input.built)

    expect(result.generationByUnitId).toEqual({
      'unit:partnership:current:descendant-a+descendant-b': 2,
      'unit:person:ancestor': 0,
      'unit:person:branch-a': 1,
      'unit:person:branch-b': 1,
    })
    expect(result.cyclicUnitIds).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('reports a true parentage cycle without dropping units', () => {
    const a = member('a')
    const b = member('b')
    linkParent(b, a)
    linkParent(a, b)
    const input = buildProjectedInput(familyData([a, b]))

    const result = assignGenerations(input.projected, input.built)

    expect(Object.keys(result.generationByUnitId).sort()).toEqual([
      'unit:person:a',
      'unit:person:b',
    ])
    expect(result.cyclicUnitIds).toEqual(['unit:person:a', 'unit:person:b'])
    expect(result.generationByUnitId['unit:person:a']).toBe(
      result.generationByUnitId['unit:person:b'],
    )
    expect(result.diagnostics[0]).toMatchObject({
      code: 'PARENTAGE_CYCLE',
      ids: ['unit:person:a', 'unit:person:b'],
    })
  })

  it('reports a malformed self parentage edge as a cycle', () => {
    const input = buildProjectedInput(familyData([member('a')]))
    input.built.parentageGroups.push({
      id: 'parentage:self',
      sourceUnitId: 'unit:person:a',
      childPersonIds: ['a'],
    })

    const result = assignGenerations(input.projected, input.built)

    expect(result.generationByUnitId).toEqual({ 'unit:person:a': 0 })
    expect(result.cyclicUnitIds).toEqual(['unit:person:a'])
    expect(result.diagnostics).toEqual([{
      code: 'PARENTAGE_CYCLE',
      ids: ['unit:person:a'],
      message: 'Parentage cycle detected: unit:person:a',
    }])
  })
})
