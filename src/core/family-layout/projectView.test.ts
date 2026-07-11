import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT_METRICS } from './types'
import { familyData, linkSpouse, member } from './testHelpers'
import { normalizeFacts } from './normalizeFacts'
import { buildFamilyUnits } from './buildFamilyUnits'
import { projectView } from './projectView'

describe('projectView', () => {
  it('projects current partnership into one couple unit and historical partnership into auxiliary data', () => {
    const a = member('a')
    const b = member('b')
    const ex = member('ex')
    linkSpouse(a, b, 'married')
    linkSpouse(a, ex, 'divorced')
    const { facts } = normalizeFacts(familyData([a, b, ex]))

    const projected = projectView(facts, {
      primaryPartnershipByPerson: {},
      primaryParentageByChild: {},
      showHistoricalPartnerships: true,
      showSecondaryParentage: false,
      showGodparentRelations: false,
    })
    const built = buildFamilyUnits(projected, {
      rowOrders: [],
      familyAccentAssignments: {},
    }, DEFAULT_LAYOUT_METRICS)

    expect(built.units.find(unit => unit.kind === 'couple')?.memberIds).toEqual(['a', 'b'])
    expect(Object.keys(built.unitIdByPersonId).sort()).toEqual(['a', 'b', 'ex'])
    expect(projected.auxiliaryRelations).toContainEqual({
      id: 'aux:partnership:historical:a+ex',
      kind: 'historical-partnership',
      sourceId: 'a',
      targetId: 'ex',
    })
  })

  it('honors a mutually selected current partnership and exposes the other as secondary', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    linkSpouse(a, b)
    linkSpouse(a, c)
    const { facts } = normalizeFacts(familyData([c, b, a]))
    const selectedId = 'partnership:current:a+c'

    const projected = projectView(facts, {
      primaryPartnershipByPerson: { a: selectedId, c: selectedId },
      primaryParentageByChild: {},
      showHistoricalPartnerships: true,
      showSecondaryParentage: false,
      showGodparentRelations: false,
    })

    expect(projected.primaryPartnerships.map(partnership => partnership.id)).toEqual([selectedId])
    expect(projected.auxiliaryRelations).toEqual([{
      id: 'aux:secondary:partnership:current:a+b',
      kind: 'secondary-partnership',
      sourceId: 'a',
      targetId: 'b',
    }])
    expect(projected.diagnostics).toEqual([])
  })

  it('selects one parentage per child and projects optional auxiliary relations deterministically', () => {
    const parentA = member('parent-a')
    const parentB = member('parent-b')
    const child = member('child', {
      godparents: [
        { id: 'parent-b', type: 'godparent' },
        { id: 'missing', type: 'godparent' },
      ],
    })
    const people = normalizeFacts(familyData([child, parentB, parentA])).facts.people
    const facts = {
      people,
      partnerships: [],
      parentages: [
        {
          id: 'parentage:parent-a',
          parentIds: ['parent-a'],
          childIds: ['child'],
          typeByChildId: { child: 'blood' as const },
        },
        {
          id: 'parentage:parent-b',
          parentIds: ['parent-b'],
          childIds: ['child'],
          typeByChildId: { child: 'adopted' as const },
        },
      ],
    }

    const projected = projectView(facts, {
      primaryPartnershipByPerson: {},
      primaryParentageByChild: { child: 'parentage:parent-b' },
      showHistoricalPartnerships: false,
      showSecondaryParentage: true,
      showGodparentRelations: true,
    })

    expect(projected.primaryParentages).toEqual([facts.parentages[1]])
    expect(projected.auxiliaryRelations).toEqual([
      {
        id: 'aux:godparent:parent-b>child',
        kind: 'godparent',
        sourceId: 'parent-b',
        targetId: 'child',
      },
      {
        id: 'aux:parentage:parent-a:parent-a:child',
        kind: 'secondary-parentage',
        sourceId: 'parent-a',
        targetId: 'child',
      },
    ])
  })

  it('reports invalid primary partnership and parentage preferences', () => {
    const child = member('child')
    const parent = member('parent')
    const people = normalizeFacts(familyData([parent, child])).facts.people

    const projected = projectView({
      people,
      partnerships: [],
      parentages: [{
        id: 'parentage:parent',
        parentIds: ['parent'],
        childIds: ['child'],
        typeByChildId: { child: 'blood' },
      }],
    }, {
      primaryPartnershipByPerson: { parent: 'partnership:missing' },
      primaryParentageByChild: { child: 'parentage:missing' },
      showHistoricalPartnerships: false,
      showSecondaryParentage: false,
      showGodparentRelations: false,
    })

    expect(projected.diagnostics).toEqual([
      {
        code: 'INVALID_PRIMARY_PARENTAGE',
        ids: ['child', 'parentage:missing'],
        message: 'Invalid primary parentage parentage:missing for child',
      },
      {
        code: 'INVALID_PRIMARY_PARTNERSHIP',
        ids: ['parent', 'partnership:missing'],
        message: 'Invalid primary partnership partnership:missing for parent',
      },
    ])
  })
})
