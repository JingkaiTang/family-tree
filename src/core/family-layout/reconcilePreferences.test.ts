import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type Member } from '@/core/schema'
import {
  convertLegacyGridPreferences,
  reconcileLayoutPreferences,
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
      rowOrders: [{
        id: 'row:v2:0',
        unitIds: ['unit:person:b', 'unit:person:a'],
      }],
      familyAccentAssignments: {},
    })
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
      rowOrders: [
        {
          id: 'row:v2:0',
          unitIds: ['unit:person:parent-a', 'unit:person:parent-b'],
        },
        {
          id: 'row:v2:1',
          unitIds: ['unit:person:child-b', 'unit:person:child-a'],
        },
      ],
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
      rowOrders: [],
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
      rowOrders: [{
        id: 'row:dirty',
        unitIds: [
          'unit:person:b',
          'unit:person:a',
          'unit:person:b',
          'unit:person:unknown',
        ],
      }],
      familyAccentAssignments: {
        'unit:person:a': '#111111',
        'unit:person:unknown': '#999999',
      },
    }
    const before = structuredClone(data)

    expect(reconcileLayoutPreferences(data)).toEqual({
      rowOrders: [{
        id: 'row:dirty',
        unitIds: ['unit:person:b', 'unit:person:a', 'unit:person:c'],
      }],
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
      {
        id: 'row:z-parent',
        unitIds: ['unit:person:other', 'unit:person:parent', 'unit:person:child'],
      },
      {
        id: 'row:z-child',
        unitIds: ['unit:person:child'],
      },
      {
        id: 'row:a-parent',
        unitIds: ['unit:person:parent', 'unit:person:other'],
      },
    ]

    expect(reconcileLayoutPreferences(data).rowOrders).toEqual([
      {
        id: 'row:a-parent',
        unitIds: ['unit:person:parent', 'unit:person:other'],
      },
      {
        id: 'row:z-child',
        unitIds: ['unit:person:child'],
      },
    ])
  })

  it('does not create default rows when there are no persisted rows', () => {
    const data = createEmptyFamily()
    data.members.a = member('a')
    data.layoutPreferences.familyAccentAssignments = {
      'unit:person:missing': '#999999',
    }

    expect(reconcileLayoutPreferences(data)).toEqual({
      rowOrders: [],
      familyAccentAssignments: {},
    })
  })
})
