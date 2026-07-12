import { describe, expect, it } from 'vitest'
import { DEFAULT_FAMILY_VIEW_POLICY, DEFAULT_LAYOUT_METRICS } from './types'
import { familyData, linkParent, linkSpouse, member } from './testHelpers'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import { buildFamilyUnits, FAMILY_ACCENTS, stableHash } from './buildFamilyUnits'

describe('buildFamilyUnits', () => {
  it('creates couple units first and one stable unit mapping for every person', () => {
    const a = member('a')
    const b = member('b')
    const single = member('single')
    linkSpouse(a, b)
    const { facts } = normalizeFacts(familyData([single, b, a]))

    const built = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(built.units.map(unit => ({ id: unit.id, kind: unit.kind, memberIds: unit.memberIds }))).toEqual([
      {
        id: 'unit:partnership:current:a+b',
        kind: 'couple',
        memberIds: ['a', 'b'],
      },
      {
        id: 'unit:person:single',
        kind: 'single',
        memberIds: ['single'],
      },
    ])
    expect(built.unitIdByPersonId).toEqual({
      a: 'unit:partnership:current:a+b',
      b: 'unit:partnership:current:a+b',
      single: 'unit:person:single',
    })
  })

  it('lets a single-parent unit own its parentage group and orders children by birth date then id', () => {
    const parent = member('parent')
    const later = member('a-later', { birthDate: '2010-01-01' })
    const sameDateB = member('b-same', { birthDate: '2000-01-01' })
    const sameDateA = member('a-same', { birthDate: '2000-01-01' })
    linkParent(later, parent)
    linkParent(sameDateB, parent)
    linkParent(sameDateA, parent)
    const { facts } = normalizeFacts(familyData([later, sameDateB, parent, sameDateA]))

    const built = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(built.parentageGroups).toEqual([{
      id: 'parentage:parent',
      sourceUnitId: 'unit:person:parent',
      childPersonIds: ['a-same', 'b-same', 'a-later'],
    }])
  })

  it('chooses the unit containing the most parents and uses stable id to break ties', () => {
    const parentA = member('a')
    const parentB = member('b')
    const parentC = member('c')
    const child = member('child')
    linkSpouse(parentB, parentC)
    const { facts } = normalizeFacts(familyData([child, parentC, parentB, parentA]))
    facts.parentages = [{
      id: 'parentage:a+b+c',
      parentIds: ['a', 'b', 'c'],
      childIds: ['child'],
      typeByChildId: { child: 'blood' },
    }, {
      id: 'parentage:a+child',
      parentIds: ['a', 'child'],
      childIds: ['b'],
      typeByChildId: { b: 'blood' },
    }]

    const built = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(built.parentageGroups.map(group => [group.id, group.sourceUnitId])).toEqual([
      ['parentage:a+b+c', 'unit:partnership:current:b+c'],
      ['parentage:a+child', 'unit:person:a'],
    ])
  })

  it('anchors a historical co-parent group to the participating current-couple member', () => {
    const parentA = member('a')
    const parentB = member('b')
    const parentC = member('c')
    const childAB = member('child-ab')
    const childAC = member('child-ac')
    linkSpouse(parentA, parentB)
    linkSpouse(parentA, parentC, 'divorced')
    linkParent(childAB, parentA)
    linkParent(childAB, parentB)
    linkParent(childAC, parentA)
    linkParent(childAC, parentC)
    const { facts } = normalizeFacts(familyData([
      childAC,
      parentC,
      childAB,
      parentB,
      parentA,
    ]))

    const built = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(built.parentageGroups).toEqual([{
      id: 'parentage:a+b',
      sourceUnitId: 'unit:partnership:current:a+b',
      childPersonIds: ['child-ab'],
    }, {
      id: 'parentage:a+c',
      sourceUnitId: 'unit:partnership:current:a+b',
      sourceHubId: 'hub:parentage:a+c',
      sourceAnchorPersonId: 'a',
      childPersonIds: ['child-ac'],
    }])
  })

  it('uses unit geometry, persisted accents, and deterministic collision avoidance', () => {
    const dad = member('dad')
    const child = member('c')
    linkParent(child, dad)
    const { facts } = normalizeFacts(familyData([dad, child]))

    const automatic = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )
    const persisted = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      {
        rowOrders: [],
        familyAccentAssignments: { 'unit:person:dad': '#123456' },
      },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(stableHash('unit:person:dad')).toBe(1256129081)
    expect(stableHash('unit:person:dad') % FAMILY_ACCENTS.length).toBe(
      stableHash('unit:person:c') % FAMILY_ACCENTS.length,
    )
    expect(automatic.units.find(unit => unit.id === 'unit:person:dad')?.accent).not.toBe(
      automatic.units.find(unit => unit.id === 'unit:person:c')?.accent,
    )
    expect(persisted.units.find(unit => unit.id === 'unit:person:dad')).toMatchObject({
      width: DEFAULT_LAYOUT_METRICS.cardWidth,
      generation: 0,
      lineageAffinity: {},
      accent: '#123456',
    })
  })

  it('sizes couple units from card width and spouse gap', () => {
    const a = member('a')
    const b = member('b')
    linkSpouse(a, b)
    const { facts } = normalizeFacts(familyData([a, b]))

    const built = buildFamilyUnits(
      projectView(facts, DEFAULT_FAMILY_VIEW_POLICY),
      { rowOrders: [], familyAccentAssignments: {} },
      DEFAULT_LAYOUT_METRICS,
    )

    expect(built.units[0].width).toBe(
      DEFAULT_LAYOUT_METRICS.cardWidth * 2 + DEFAULT_LAYOUT_METRICS.spouseGap,
    )
  })
})
