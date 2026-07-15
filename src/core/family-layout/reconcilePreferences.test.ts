import { describe, expect, it } from 'vitest'
import {
  createEmptyFamily,
  type Member,
  type RowOrderPreference,
} from '@/core/schema'
import {
  convertLegacyGridPreferences,
  reconcileLayoutPreferences,
  withRowOrderPreference,
} from './reconcilePreferences'

function member(id: string, patch: Partial<Member> = {}): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkCurrentSpouses(left: Member, right: Member) {
  left.spouses.push({ id: right.id, type: 'married' })
  right.spouses.push({ id: left.id, type: 'married' })
}

function legacyRow(
  id: string,
  unitIds: string[],
  generation = 0,
): RowOrderPreference {
  return { id, domainId: 'legacy', generation, unitIds }
}

describe('convertLegacyGridPreferences', () => {
  it('expands one valid override into the complete current generation row', () => {
    const data = createEmptyFamily()
    data.members = {
      a: member('a'),
      b: member('b'),
    }
    data.gridLayoutOverrides = {
      'person:b': { order: -1 },
    }

    expect(convertLegacyGridPreferences(data)).toEqual({
      rootOrders: [],
      rowOrders: [legacyRow('row:v2:0', ['unit:person:b', 'unit:person:a'])],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {},
    })
  })

  it('sorts uncovered units with the legacy effective order zero', () => {
    const data = createEmptyFamily()
    data.members = {
      a: member('a'),
      b: member('b'),
    }
    data.gridLayoutOverrides = {
      'person:a': { order: 1 },
    }

    expect(convertLegacyGridPreferences(data).rowOrders).toEqual([{
      id: 'row:v2:0',
      domainId: 'legacy',
      generation: 0,
      unitIds: ['unit:person:b', 'unit:person:a'],
    }])
  })

  it('merges alternate legacy slots by minimum order and emits the unit once', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    a.spouses.push({ id: 'b', type: 'married' })
    b.spouses.push({ id: 'a', type: 'married' })
    const data = createEmptyFamily()
    data.members = { a, b, c }
    data.gridLayoutOverrides = {
      'couple:a+b': { order: 2 },
      'person:a': { order: -2 },
    }

    expect(convertLegacyGridPreferences(data).rowOrders).toEqual([{
      id: 'row:v2:0',
      domainId: 'legacy',
      generation: 0,
      unitIds: ['unit:partnership:current:a+b', 'unit:person:c'],
    }])
  })

  it('groups valid legacy slots by current unit generation and sorts rows deterministically', () => {
    const parentA = member('parent-a')
    const parentB = member('parent-b')
    const childA = member('child-a')
    const childB = member('child-b')
    linkParent(childA, parentA)
    linkParent(childB, parentB)
    const data = createEmptyFamily()
    data.members = Object.fromEntries(
      [childB, parentB, childA, parentA].map(value => [value.id, value]),
    )
    data.gridLayoutOverrides = {
      'person:child-a': { order: 2 },
      'person:child-b': { order: -2 },
      'single-parent:parent-b': { order: 4 },
      'single-parent:parent-a': { order: 4 },
      'person:missing': { order: -100 },
    }
    const before = structuredClone(data)

    const preferences = convertLegacyGridPreferences(data)

    expect(preferences).toEqual({
      rootOrders: [],
      rowOrders: [
        {
          id: 'row:v2:0',
          domainId: 'legacy',
          generation: 0,
          unitIds: ['unit:person:parent-a', 'unit:person:parent-b'],
        },
        {
          id: 'row:v2:1',
          domainId: 'legacy',
          generation: 1,
          unitIds: ['unit:person:child-b', 'unit:person:child-a'],
        },
      ],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {},
    })
    expect(data).toEqual(before)
  })

  it('falls back to empty preferences when no legacy slot can be interpreted', () => {
    const data = createEmptyFamily()
    data.members.a = member('a')
    data.gridLayoutOverrides = {
      'unknown:a': { order: Number.NaN },
      'person:missing': { order: 1 },
    }

    expect(convertLegacyGridPreferences(data)).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {},
    })
  })
})

describe('reconcileLayoutPreferences', () => {
  it('keeps valid relative order, removes duplicates and unknowns, and fills the row', () => {
    const data = createEmptyFamily()
    data.members = {
      a: member('a'),
      b: member('b'),
      c: member('c'),
    }
    data.layoutPreferences = {
      rootOrders: [],
      rowOrders: [legacyRow('row:dirty', [
          'unit:person:b',
          'unit:person:a',
          'unit:person:b',
          'unit:person:unknown',
      ])],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#111111',
        'unit:person:unknown': '#999999',
      },
    }
    const before = structuredClone(data)

    expect(reconcileLayoutPreferences(data)).toEqual({
      rootOrders: [],
      rowOrders: [legacyRow('row:dirty', [
        'unit:person:b',
        'unit:person:a',
        'unit:person:c',
      ])],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#111111',
      },
    })
    expect(data).toEqual(before)
  })

  it('selects one best row per generation and removes cross-generation contamination', () => {
    const parent = member('parent')
    const other = member('other')
    const child = member('child')
    linkParent(child, parent)
    const data = createEmptyFamily()
    data.members = { child, other, parent }
    data.layoutPreferences.rowOrders = [
      legacyRow('row:z-parent', [
        'unit:person:other',
        'unit:person:parent',
        'unit:person:child',
      ]),
      legacyRow('row:z-child', ['unit:person:child']),
      legacyRow('row:a-parent', ['unit:person:parent', 'unit:person:other']),
    ]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      legacyRow('row:a-parent', ['unit:person:parent', 'unit:person:other']),
    ])
  })

  it('keeps a complete reordered source row isolated from another generation', () => {
    const parentA = member('parent-a')
    const parentB = member('parent-b')
    const child = member('child')
    linkParent(child, parentA)
    const data = createEmptyFamily()
    data.members = { parentA, parentB, child }
    data.layoutPreferences.rowOrders = [legacyRow('row:0', [
        'unit:person:parent-b',
        'unit:person:parent-a',
        'unit:person:child',
    ])]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      legacyRow('row:0', ['unit:person:parent-b', 'unit:person:parent-a']),
    ])
  })

  it('inherits the neighboring position when two singles become a couple', () => {
    const left = member('left')
    const a = member('a')
    const b = member('b')
    const right = member('right')
    linkCurrentSpouses(a, b)
    const data = createEmptyFamily()
    data.members = { left, a, b, right }
    data.layoutPreferences.rowOrders = [legacyRow('row:0', [
        'unit:person:left',
        'unit:person:a',
        'unit:person:b',
        'unit:person:right',
    ])]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      legacyRow('row:0', [
        'unit:person:left',
        'unit:partnership:current:a+b',
        'unit:person:right',
      ]),
    ])
  })

  it('keeps former spouses beside the old couple position when they become singles', () => {
    const data = createEmptyFamily()
    data.members = {
      left: member('left'),
      a: member('a'),
      b: member('b'),
      right: member('right'),
    }
    data.layoutPreferences.rowOrders = [legacyRow('row:0', [
        'unit:person:left',
        'unit:partnership:current:a+b',
        'unit:person:right',
    ])]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      legacyRow('row:0', [
        'unit:person:left',
        'unit:person:a',
        'unit:person:b',
        'unit:person:right',
      ]),
    ])
  })

  it('inherits member positions when the primary spouse changes', () => {
    const left = member('left')
    const a = member('a')
    const b = member('b')
    const c = member('c')
    const right = member('right')
    linkCurrentSpouses(a, c)
    const data = createEmptyFamily()
    data.members = { left, a, b, c, right }
    data.layoutPreferences.rowOrders = [legacyRow('row:0', [
        'unit:person:left',
        'unit:partnership:current:a+b',
        'unit:person:c',
        'unit:person:right',
    ])]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      legacyRow('row:0', [
        'unit:person:left',
        'unit:partnership:current:a+c',
        'unit:person:b',
        'unit:person:right',
      ]),
    ])
  })

  it('does not create default rows when there are no persisted rows', () => {
    const data = createEmptyFamily()
    data.members.a = member('a')
    data.layoutPreferences.familyAccentAssignments = {
      'unit:person:missing': '#999999',
    }

    expect(reconcileLayoutPreferences(data)).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {},
    })
  })

  it('reconciles stale root and bridge orders within one cross-root component', () => {
    const a0 = member('a0')
    const a0Spouse = member('a0-spouse')
    const b0 = member('b0')
    const b0Spouse = member('b0-spouse')
    const a1 = member('a1')
    const a2 = member('a2')
    const b1 = member('b1')
    const b2 = member('b2')
    linkCurrentSpouses(a0, a0Spouse)
    linkCurrentSpouses(b0, b0Spouse)
    linkParent(a1, a0)
    linkParent(a1, a0Spouse)
    linkParent(a2, a0)
    linkParent(a2, a0Spouse)
    linkParent(b1, b0)
    linkParent(b1, b0Spouse)
    linkParent(b2, b0)
    linkParent(b2, b0Spouse)
    linkCurrentSpouses(a1, b1)
    linkCurrentSpouses(a2, b2)
    const data = createEmptyFamily()
    data.members = Object.fromEntries(
      [a0, a0Spouse, b0, b0Spouse, a1, a2, b1, b2]
        .map(value => [value.id, value]),
    )
    const bridgeDomainId = [
      'domain:bridge:root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ].join('|')
    data.layoutPreferences.rootOrders = [{
      componentId: 'component:a0',
      rootIds: [
        'root:b0+b0-spouse',
        'root:unknown',
        'root:a0+a0-spouse',
      ],
    }]
    data.layoutPreferences.bridgeOrders = [{
      id: 'bridge:1',
      domainId: bridgeDomainId,
      generation: 1,
      unitIds: [
        'unit:partnership:current:a2+b2',
        'unit:unknown',
        'unit:partnership:current:a1+b1',
      ],
    }]
    data.layoutPreferences.rootAccentAssignments = {
      'root:a0+a0-spouse': '#111111',
      'root:unknown': '#999999',
    }

    const reconciled = reconcileLayoutPreferences(data)

    expect(reconciled.rootOrders).toEqual([{
      componentId: 'component:a0',
      rootIds: ['root:b0+b0-spouse', 'root:a0+a0-spouse'],
    }])
    expect(reconciled.bridgeOrders).toEqual([{
      id: 'bridge:1',
      domainId: bridgeDomainId,
      generation: 1,
      unitIds: [
        'unit:partnership:current:a2+b2',
        'unit:partnership:current:a1+b1',
      ],
    }])
    expect(reconciled.rootAccentAssignments).toEqual({
      'root:a0+a0-spouse': '#111111',
    })
  })
})

describe('withRowOrderPreference', () => {
  it('upserts a unique row order without mutating the input or legacy fields', () => {
    const data = createEmptyFamily()
    data.layoutPreferences.rowOrders = [legacyRow('row:other', ['unit:person:x'])]
    const before = structuredClone(data)

    const next = withRowOrderPreference(data, 'row:0', [
      'unit:person:b',
      'unit:person:a',
      'unit:person:b',
    ])

    expect(data).toEqual(before)
    expect(next.layoutPreferences.rowOrders).toEqual([
      legacyRow('row:other', ['unit:person:x']),
      legacyRow('row:0', ['unit:person:b', 'unit:person:a']),
    ])
    expect(next.manualPositions).toEqual({})
    expect(next.gridLayoutOverrides).toEqual({})
  })
})
