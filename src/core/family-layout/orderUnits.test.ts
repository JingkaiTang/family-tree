import { describe, expect, it } from 'vitest'
import { clusterLineages } from './clusterLineages'
import { orderUnits } from './orderUnits'
import { member } from './testHelpers'
import type {
  FamilyUnit,
  LayoutPreferences,
  LayoutScene,
  LineageCluster,
  ParentageFact,
  ParentageGroup,
  PersonFact,
  ProjectedFamily,
} from './types'

const noPreferences: LayoutPreferences = {
  rowOrders: [],
  familyAccentAssignments: {},
}

describe('orderUnits', () => {
  it('lets a saved row sequence win over birth-date order', () => {
    const units = [single('a'), single('b'), single('c')]
    const preferences: LayoutPreferences = {
      rowOrders: [{
        id: 'row-preference-1',
        unitIds: ['unit:person:c', 'unit:person:a', 'unit:person:b'],
      }],
      familyAccentAssignments: {},
    }

    const rows = orderUnits(input(units, people([
      ['a', '1980-01-01'],
      ['b', '1970-01-01'],
      ['c', '1990-01-01'],
    ]), { preferences }))

    expect(rows).toEqual([{
      generation: 0,
      unitIds: ['unit:person:c', 'unit:person:a', 'unit:person:b'],
    }])
  })

  it('applies a saved single position to the couple that now contains the person', () => {
    const units = [
      single('left'),
      couple('current:a+b', ['a', 'b']),
      single('right'),
    ]
    const preferences: LayoutPreferences = {
      rowOrders: [{
        id: 'row:0',
        unitIds: [
          'unit:person:left',
          'unit:person:a',
          'unit:person:b',
          'unit:person:right',
        ],
      }],
      familyAccentAssignments: {},
    }

    expect(orderUnits(input(units, people([
      ['left', '1990-01-01'],
      ['a', '1970-01-01'],
      ['b', '1971-01-01'],
      ['right', '1980-01-01'],
    ]), { preferences }))[0].unitIds).toEqual([
      'unit:person:left',
      'unit:partnership:current:a+b',
      'unit:person:right',
    ])
  })

  it('applies a saved couple position to both people after they become singles', () => {
    const units = [single('left'), single('a'), single('b'), single('right')]
    const preferences: LayoutPreferences = {
      rowOrders: [{
        id: 'row:0',
        unitIds: [
          'unit:person:left',
          'unit:partnership:current:a+b',
          'unit:person:right',
        ],
      }],
      familyAccentAssignments: {},
    }

    expect(orderUnits(input(units, people([
      ['left', '1990-01-01'],
      ['a', '1970-01-01'],
      ['b', '1971-01-01'],
      ['right', '1980-01-01'],
    ]), { preferences }))[0].unitIds).toEqual([
      'unit:person:left',
      'unit:person:a',
      'unit:person:b',
      'unit:person:right',
    ])
  })

  it('inherits saved member positions when the primary spouse changes', () => {
    const units = [
      single('left'),
      couple('current:a+c', ['a', 'c']),
      single('b'),
      single('right'),
    ]
    const preferences: LayoutPreferences = {
      rowOrders: [{
        id: 'row:0',
        unitIds: [
          'unit:person:left',
          'unit:partnership:current:a+b',
          'unit:person:c',
          'unit:person:right',
        ],
      }],
      familyAccentAssignments: {},
    }

    expect(orderUnits(input(units, people([
      ['left', '1990-01-01'],
      ['a', '1970-01-01'],
      ['b', '1971-01-01'],
      ['c', '1972-01-01'],
      ['right', '1980-01-01'],
    ]), { preferences }))[0].unitIds).toEqual([
      'unit:person:left',
      'unit:partnership:current:a+c',
      'unit:person:b',
      'unit:person:right',
    ])
  })

  it('keeps a couple unit indivisible while sorting by birth date', () => {
    const units = [
      single('a'),
      couple('pair', ['left', 'right']),
      single('z'),
    ]

    const [row] = orderUnits(input(units, people([
      ['a', '1970-01-01'],
      ['left', '1980-01-01'],
      ['right', '1981-01-01'],
      ['z', '1990-01-01'],
    ])))

    expect(row.unitIds).toEqual([
      'unit:person:a',
      'unit:partnership:pair',
      'unit:person:z',
    ])
    expect(row.unitIds.filter(id => id === 'unit:partnership:pair')).toHaveLength(1)
  })

  it('keeps sibling child units contiguous when there is no bridge conflict', () => {
    const units = [
      single('parent', 0),
      single('a', 1),
      single('unrelated', 1),
      single('b', 1),
    ]
    const parentageGroups: ParentageGroup[] = [{
      id: 'parentage:parent',
      sourceUnitId: 'unit:person:parent',
      childPersonIds: ['a', 'b'],
    }]

    const rows = orderUnits(input(units, people([
      ['parent', '1970-01-01'],
      ['a', '2000-01-01'],
      ['unrelated', '2001-01-01'],
      ['b', '2002-01-01'],
    ]), { parentageGroups }))

    expect(rows.find(row => row.generation === 1)?.unitIds).toEqual([
      'unit:person:a',
      'unit:person:b',
      'unit:person:unrelated',
    ])
  })

  it('places A/B cross-marriage units in the bridge band between both cores', () => {
    const units = [
      single('a-core'),
      single('b-core'),
      couple('a1-b1', ['a1', 'b1']),
      couple('a2-b2', ['a2', 'b2']),
    ]
    const clusters: LineageCluster[] = [{
      id: 'core:a',
      kind: 'core',
      unitIds: ['unit:person:a-core'],
      personIds: ['a-core', 'a1', 'a2'],
    }, {
      id: 'core:b',
      kind: 'core',
      unitIds: ['unit:person:b-core'],
      personIds: ['b-core', 'b1', 'b2'],
    }, {
      id: 'bridge:core:a|core:b',
      kind: 'bridge',
      unitIds: ['unit:partnership:a1-b1', 'unit:partnership:a2-b2'],
      personIds: ['a1', 'a2', 'b1', 'b2'],
    }]

    const [row] = orderUnits(input(units, people([
      ['a-core', '1970-01-01'],
      ['b-core', '1971-01-01'],
      ['a1', '1980-01-01'],
      ['b1', '1980-01-02'],
      ['a2', '1981-01-01'],
      ['b2', '1981-01-02'],
    ]), { clusters }))

    expect(row.unitIds).toEqual([
      'unit:person:a-core',
      'unit:partnership:a1-b1',
      'unit:partnership:a2-b2',
      'unit:person:b-core',
    ])
  })

  it('returns byte-identical rows for identical inputs', () => {
    const value = input(
      [single('b'), single('a'), single('c', 1)],
      people([['a'], ['b'], ['c']]),
      {
        parentageGroups: [{
          id: 'parentage:a',
          sourceUnitId: 'unit:person:a',
          childPersonIds: ['c'],
        }],
      },
    )

    const first = orderUnits(value)
    const second = orderUnits(structuredClone(value))

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('orders a 200-unit reverse-parentage row completely and deterministically', () => {
    const edgeCount = 100
    const parentIds = Array.from({ length: edgeCount }, (_, index) => (
      `parent-${index.toString().padStart(3, '0')}`
    ))
    const childIds = Array.from({ length: edgeCount }, (_, index) => (
      `child-${index.toString().padStart(3, '0')}`
    ))
    const units = [
      ...parentIds.map(id => single(id, 0)),
      ...childIds.map(id => single(id, 1)),
    ]
    const parentageGroups = parentIds.map((parentId, index) => ({
      id: `parentage:${parentId}`,
      sourceUnitId: `unit:person:${parentId}`,
      childPersonIds: [childIds[edgeCount - index - 1]],
    }))

    const rows = orderUnits(input(
      units,
      people([...parentIds, ...childIds].map(id => [id])),
      { parentageGroups },
    ))

    const orderedUnitIds = rows.flatMap(row => row.unitIds)
    expect(rows).toEqual([{
      generation: 0,
      unitIds: parentIds.map(id => `unit:person:${id}`),
    }, {
      generation: 1,
      unitIds: [...childIds].reverse().map(id => `unit:person:${id}`),
    }])
    expect(orderedUnitIds).toHaveLength(200)
    expect(new Set(orderedUnitIds).size).toBe(200)
  })

  it('uses all six sweep refinements to repair a reversed parent-child affinity row', () => {
    const unrelatedIds = Array.from({ length: 6 }, (_, index) => `unrelated-${index}`)
    const units = [
      single('parent'),
      ...unrelatedIds.map(id => single(id)),
      single('child'),
    ]
    const primaryParentages: ParentageFact[] = [{
      id: 'parentage:parent',
      parentIds: ['parent'],
      childIds: ['child'],
      typeByChildId: { child: 'blood' },
    }]

    const [row] = orderUnits(input(
      units,
      people([
        ['parent', '1900-01-01'],
        ...unrelatedIds.map((id, index) => (
          [id, `${1910 + index}-01-01`] as [string, string]
        )),
        ['child', '2000-01-01'],
      ]),
      { primaryParentages },
    ))

    expect(row.unitIds).toEqual([
      'unit:person:parent',
      'unit:person:child',
      ...unrelatedIds.map(id => `unit:person:${id}`),
    ])
  })

  it.each(['adopted', 'step'] as const)(
    'keeps blood cores stronger than %s affinity inside a supercomponent',
    type => {
      const units = [
        single('a-root'),
        single('b-root'),
        single('a-child'),
        single('b-child'),
        couple('a-bridge-b-bridge', ['a-bridge', 'b-bridge']),
      ]
      const personFacts = people([
        ['a-root', '1970-01-01'],
        ['b-root', '1971-01-01'],
        ['a-child', '1980-01-01'],
        ['b-child', '1981-01-01'],
        ['a-bridge', '1990-01-01'],
        ['b-bridge', '1991-01-01'],
      ])
      const primaryParentages: ParentageFact[] = [{
        id: 'parentage:a-root',
        parentIds: ['a-root'],
        childIds: ['a-child', 'a-bridge'],
        typeByChildId: { 'a-child': 'blood', 'a-bridge': 'blood' },
      }, {
        id: 'parentage:b-root',
        parentIds: ['b-root'],
        childIds: ['b-child', 'b-bridge'],
        typeByChildId: { 'b-child': 'blood', 'b-bridge': 'blood' },
      }, {
        id: 'parentage:cross-affinity',
        parentIds: ['a-child'],
        childIds: ['b-child'],
        typeByChildId: { 'b-child': type },
      }]
      const clusters: LineageCluster[] = [{
        id: 'supercomponent:core:a-root+core:b-root',
        kind: 'supercomponent',
        unitIds: units.map(unit => unit.id).sort(),
        personIds: personFacts.map(person => person.id).sort(),
      }]

      const [row] = orderUnits(input(units, personFacts, {
        clusters,
        primaryParentages,
      }))
      const position = (unitId: string) => row.unitIds.indexOf(unitId)
      const adoptedDistance = Math.abs(
        position('unit:person:a-child') - position('unit:person:b-child'),
      )

      expect(Math.abs(
        position('unit:person:a-root') - position('unit:person:a-child'),
      )).toBeLessThan(adoptedDistance)
      expect(Math.abs(
        position('unit:person:b-root') - position('unit:person:b-child'),
      )).toBeLessThan(adoptedDistance)
      expect(position('unit:partnership:a-bridge-b-bridge')).toBeGreaterThan(
        Math.min(position('unit:person:a-child'), position('unit:person:b-child')),
      )
      expect(position('unit:partnership:a-bridge-b-bridge')).toBeLessThan(
        Math.max(position('unit:person:a-root'), position('unit:person:b-root')),
      )
    },
  )

  it.each(['adopted', 'step'] as const)(
    'uses %s parentage as 0.5 affinity without merging blood cores',
    type => {
      const units = [single('a'), single('z'), single('x')]
      const personFacts = people([
        ['a', '1970-01-01'],
        ['z', '1980-01-01'],
        ['x', '1990-01-01'],
      ])
      const affinityParentage: ParentageFact = {
        id: 'parentage:a',
        parentIds: ['a'],
        childIds: ['x'],
        typeByChildId: { x: type },
      }
      const projected: ProjectedFamily = {
        people: personFacts,
        primaryPartnerships: [],
        primaryParentages: [affinityParentage],
        auxiliaryRelations: [],
        diagnostics: [],
      }
      const clusters = clusterLineages(projected, units, [])

      expect(clusters.map(cluster => cluster.personIds)).toEqual([['a'], ['x'], ['z']])
      expect(orderUnits(input(units, personFacts, {
        clusters,
        primaryParentages: [affinityParentage],
      }))[0].unitIds).toEqual([
        'unit:person:a',
        'unit:person:x',
        'unit:person:z',
      ])
    },
  )

  it('restores previous movement order for an isolated row without changedIds', () => {
    const units = [
      single('a'),
      couple('pair', ['b-left', 'b-right']),
      single('c'),
    ]
    const previousScene = sceneWithRows([{
      id: 'row:0',
      generation: 0,
      unitIds: [
        'unit:person:c',
        'unit:partnership:pair',
        'unit:person:a',
      ],
    }])

    const [row] = orderUnits(input(units, people([
      ['a', '1970-01-01'],
      ['b-left', '1980-01-01'],
      ['b-right', '1981-01-01'],
      ['c', '1990-01-01'],
    ]), { previousScene }))

    expect(row.unitIds).toEqual([
      'unit:person:c',
      'unit:partnership:pair',
      'unit:person:a',
    ])
    expect(row.unitIds.filter(id => id === 'unit:partnership:pair')).toHaveLength(1)
  })

  it('keeps a saved row ahead of conflicting previous movement order', () => {
    const units = [single('a'), single('b'), single('c')]
    const previousScene = sceneWithRows([{
      id: 'row:0',
      generation: 0,
      unitIds: ['unit:person:c', 'unit:person:b', 'unit:person:a'],
    }])
    const preferences: LayoutPreferences = {
      rowOrders: [{
        id: 'row-preference-1',
        unitIds: ['unit:person:a', 'unit:person:b', 'unit:person:c'],
      }],
      familyAccentAssignments: {},
    }

    expect(orderUnits(input(units, people([
      ['a', '1970-01-01'],
      ['b', '1980-01-01'],
      ['c', '1990-01-01'],
    ]), { preferences, previousScene }))[0].unitIds).toEqual([
      'unit:person:a',
      'unit:person:b',
      'unit:person:c',
    ])
  })

  it('preserves previous order for a component untouched by changed people and relatives', () => {
    const units = [
      single('parent', 0),
      single('a', 1),
      single('b', 1),
      single('changed', 1),
    ]
    const parentageGroups: ParentageGroup[] = [{
      id: 'parentage:parent',
      sourceUnitId: 'unit:person:parent',
      childPersonIds: ['a', 'b'],
    }]
    const primaryParentages: ParentageFact[] = [{
      id: 'parentage:parent',
      parentIds: ['parent'],
      childIds: ['a', 'b'],
      typeByChildId: { a: 'blood', b: 'blood' },
    }]
    const previousScene = sceneWithRows([
      { id: 'row:0', generation: 0, unitIds: ['unit:person:parent'] },
      {
        id: 'row:1',
        generation: 1,
        unitIds: ['unit:person:b', 'unit:person:a', 'unit:person:changed'],
      },
    ])

    const rows = orderUnits(input(units, people([
      ['parent'], ['a', '1980-01-01'], ['b', '1990-01-01'], ['changed'],
    ]), {
      parentageGroups,
      primaryParentages,
      previousScene,
      changedIds: ['changed'],
    }))

    expect(rows.find(row => row.generation === 1)?.unitIds).toEqual([
      'unit:person:b',
      'unit:person:a',
      'unit:person:changed',
    ])
  })

  it('preserves a remote descendant row inside the changed connected tree', () => {
    const units = [
      single('grandparent', 0),
      single('parent', 1),
      single('target', 2),
      single('child', 3),
      single('remote-a', 4),
      single('remote-b', 4),
    ]
    const parentageGroups: ParentageGroup[] = [{
      id: 'parentage:grandparent',
      sourceUnitId: 'unit:person:grandparent',
      childPersonIds: ['parent'],
    }, {
      id: 'parentage:parent',
      sourceUnitId: 'unit:person:parent',
      childPersonIds: ['target'],
    }, {
      id: 'parentage:target',
      sourceUnitId: 'unit:person:target',
      childPersonIds: ['child'],
    }, {
      id: 'parentage:child',
      sourceUnitId: 'unit:person:child',
      childPersonIds: ['remote-a', 'remote-b'],
    }]
    const primaryParentages: ParentageFact[] = parentageGroups.map(group => ({
      id: group.id,
      parentIds: [group.sourceUnitId.slice('unit:person:'.length)],
      childIds: [...group.childPersonIds],
      typeByChildId: Object.fromEntries(
        group.childPersonIds.map(childId => [childId, 'blood' as const]),
      ),
    }))
    const previousScene = sceneWithRows([
      { id: 'row:0', generation: 0, unitIds: ['unit:person:grandparent'] },
      { id: 'row:1', generation: 1, unitIds: ['unit:person:parent'] },
      { id: 'row:2', generation: 2, unitIds: ['unit:person:target'] },
      { id: 'row:3', generation: 3, unitIds: ['unit:person:child'] },
      {
        id: 'row:4',
        generation: 4,
        unitIds: ['unit:person:remote-b', 'unit:person:remote-a'],
      },
    ])

    const rows = orderUnits(input(units, people([
      ['grandparent'],
      ['parent'],
      ['target'],
      ['child'],
      ['remote-a', '2000-01-01'],
      ['remote-b', '2001-01-01'],
    ]), {
      parentageGroups,
      primaryParentages,
      previousScene,
      changedIds: ['parent', 'target', 'child'],
    }))

    expect(rows.find(row => row.generation === 4)?.unitIds).toEqual([
      'unit:person:remote-b',
      'unit:person:remote-a',
    ])
  })
})

function input(
  units: FamilyUnit[],
  personFacts: PersonFact[],
  patch: Partial<Parameters<typeof orderUnits>[0]> = {},
): Parameters<typeof orderUnits>[0] {
  return {
    units,
    people: personFacts,
    parentageGroups: [],
    primaryParentages: [],
    clusters: [],
    preferences: noPreferences,
    ...patch,
  }
}

function people(values: Array<[id: string, birthDate?: string]>): PersonFact[] {
  return values.map(([id, birthDate]) => ({ id, member: member(id, { birthDate }) }))
}

function single(id: string, generation = 0): FamilyUnit {
  return {
    id: `unit:person:${id}`,
    kind: 'single',
    memberIds: [id],
    generation,
    width: 168,
    lineageAffinity: {},
    accent: '',
  }
}

function couple(id: string, memberIds: string[]): FamilyUnit {
  return {
    id: `unit:partnership:${id}`,
    kind: 'couple',
    memberIds,
    generation: 0,
    width: 360,
    lineageAffinity: {},
    accent: '',
  }
}

function sceneWithRows(rows: LayoutScene['rows']): LayoutScene {
  return {
    units: [],
    cards: [],
    hubs: [],
    rows,
    routes: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    diagnostics: [],
  }
}
