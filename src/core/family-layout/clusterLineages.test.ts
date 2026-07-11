import { describe, expect, it } from 'vitest'
import { member } from './testHelpers'
import type {
  FamilyUnit,
  ParentageFact,
  PartnershipFact,
  ProjectedFamily,
} from './types'
import { clusterLineages } from './clusterLineages'

describe('clusterLineages', () => {
  it('keeps two blood cores around one cross-lineage partnership bridge', () => {
    const projected = projectedFamily(
      [['a-root', ['a']], ['b-root', ['b']]],
      [['ab', ['a', 'b']]],
    )
    const units = [
      unit('unit:person:a-root', ['a-root']),
      unit('unit:person:b-root', ['b-root']),
      unit('unit:partnership:ab', ['a', 'b'], 'couple'),
    ]

    const clusters = clusterLineages(projected, units, [])

    expect(clusters.map(cluster => cluster.kind)).toEqual(['bridge', 'core', 'core'])
    expect(clusters.find(cluster => cluster.kind === 'bridge')).toMatchObject({
      unitIds: ['unit:partnership:ab'],
      personIds: ['a', 'b'],
    })
    expect(clusters.filter(cluster => cluster.kind === 'core').map(cluster => ({
      unitIds: cluster.unitIds,
      personIds: cluster.personIds,
    }))).toEqual([
      { unitIds: ['unit:person:a-root'], personIds: ['a', 'a-root'] },
      { unitIds: ['unit:person:b-root'], personIds: ['b', 'b-root'] },
    ])
  })

  it('groups A-sibling/B-sibling cross partnerships into one bridge band', () => {
    const projected = projectedFamily(
      [['a-root', ['a1', 'a2']], ['b-root', ['b1', 'b2']]],
      [['a1-b1', ['a1', 'b1']], ['a2-b2', ['a2', 'b2']]],
    )
    const units = [
      unit('unit:person:a-root', ['a-root']),
      unit('unit:person:b-root', ['b-root']),
      unit('unit:partnership:a1-b1', ['a1', 'b1'], 'couple'),
      unit('unit:partnership:a2-b2', ['a2', 'b2'], 'couple'),
    ]

    const clusters = clusterLineages(projected, units, [])

    expect(clusters.filter(cluster => cluster.kind === 'core')).toHaveLength(2)
    expect(clusters.filter(cluster => cluster.kind === 'bridge')).toEqual([
      expect.objectContaining({
        unitIds: ['unit:partnership:a1-b1', 'unit:partnership:a2-b2'],
        personIds: ['a1', 'a2', 'b1', 'b2'],
      }),
    ])
  })

  it('merges a cycle in the lineage bridge graph into one supercomponent', () => {
    const projected = projectedFamily(
      [
        ['a-root', ['a1', 'a2']],
        ['b-root', ['b1', 'b2']],
        ['c-root', ['c1', 'c2']],
      ],
      [
        ['a1-b1', ['a1', 'b1']],
        ['b2-c1', ['b2', 'c1']],
        ['a2-c2', ['a2', 'c2']],
      ],
    )
    const units = [
      unit('unit:person:a-root', ['a-root']),
      unit('unit:person:b-root', ['b-root']),
      unit('unit:person:c-root', ['c-root']),
      unit('unit:partnership:a1-b1', ['a1', 'b1'], 'couple'),
      unit('unit:partnership:b2-c1', ['b2', 'c1'], 'couple'),
      unit('unit:partnership:a2-c2', ['a2', 'c2'], 'couple'),
    ]

    expect(clusterLineages(projected, units, [])).toEqual([{
      id: expect.stringMatching(/^supercomponent:/),
      kind: 'supercomponent',
      unitIds: units.map(value => value.id).sort(),
      personIds: projected.people.map(person => person.id).sort(),
    }])
  })

  it('upgrades three bridges between the same two cores to a supercomponent', () => {
    const projected = projectedFamily(
      [['a-root', ['a1', 'a2', 'a3']], ['b-root', ['b1', 'b2', 'b3']]],
      [
        ['a1-b1', ['a1', 'b1']],
        ['a2-b2', ['a2', 'b2']],
        ['a3-b3', ['a3', 'b3']],
      ],
    )
    const units = [
      unit('unit:person:a-root', ['a-root']),
      unit('unit:person:b-root', ['b-root']),
      unit('unit:partnership:a1-b1', ['a1', 'b1'], 'couple'),
      unit('unit:partnership:a2-b2', ['a2', 'b2'], 'couple'),
      unit('unit:partnership:a3-b3', ['a3', 'b3'], 'couple'),
    ]

    expect(clusterLineages(projected, units, [])).toEqual([
      expect.objectContaining({
        kind: 'supercomponent',
        unitIds: units.map(value => value.id).sort(),
      }),
    ])
  })
})

function projectedFamily(
  bloodFamilies: Array<[parentId: string, childIds: string[]]>,
  partnerships: Array<[id: string, partnerIds: string[]]>,
): ProjectedFamily {
  const parentages: ParentageFact[] = bloodFamilies.map(([parentId, childIds]) => ({
    id: `parentage:${parentId}`,
    parentIds: [parentId],
    childIds,
    typeByChildId: Object.fromEntries(childIds.map(childId => [childId, 'blood'])),
  }))
  const primaryPartnerships: PartnershipFact[] = partnerships.map(([id, partnerIds]) => ({
    id: `partnership:${id}`,
    partnerIds,
    status: 'current',
  }))
  const personIds = [...new Set([
    ...bloodFamilies.flatMap(([parentId, childIds]) => [parentId, ...childIds]),
    ...partnerships.flatMap(([, partnerIds]) => partnerIds),
  ])].sort()
  return {
    people: personIds.map(id => ({ id, member: member(id) })),
    primaryPartnerships,
    primaryParentages: parentages,
    auxiliaryRelations: [],
    diagnostics: [],
  }
}

function unit(
  id: string,
  memberIds: string[],
  kind: FamilyUnit['kind'] = 'single',
): FamilyUnit {
  return {
    id,
    kind,
    memberIds,
    generation: kind === 'couple' ? 1 : 0,
    width: kind === 'couple' ? 360 : 168,
    lineageAffinity: {},
    accent: '',
  }
}
