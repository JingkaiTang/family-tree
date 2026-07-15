import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFamilyStore } from './family'
import { mk } from '@/__tests__/fixtures/families'

describe('family store relation invariants', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports current spouse conflicts before replacing a spouse', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    expect(family.getCurrentSpouseConflicts('a', 'c')).toEqual(['b'])
    expect(family.getCurrentSpouseConflicts('b', 'c')).toEqual(['a'])
  })

  it('does not replace a conflicting current spouse without explicit replacement', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    const result = family.linkCurrentSpouse('a', 'c')

    expect(result).toEqual({ ok: false, conflicts: ['b'] })
    expect(family.data.members.a.spouses).toEqual([{ id: 'b', type: 'married' }])
    expect(family.data.members.c.spouses).toEqual([])
  })

  it('replaces current spouse after confirmation path', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    const result = family.linkCurrentSpouse('a', 'c', { replaceConflicts: true })

    expect(result).toEqual({ ok: true, conflicts: ['b'] })
    expect(family.data.members.a.spouses).toEqual([{ id: 'c', type: 'married' }])
    expect(family.data.members.b.spouses).toEqual([])
    expect(family.data.members.c.spouses).toEqual([{ id: 'a', type: 'married' }])
  })

  it('stores child layout assignment and grid override', () => {
    const family = useFamilyStore()
    const parent = mk('parent')
    const spouse = mk('spouse')
    const child = mk('child')
    family.$patch((state) => {
      state.data.members = { parent, spouse, child }
    })

    family.setChildLayoutAssignment('child', {
      primaryParentId: 'parent',
      primarySpouseId: 'spouse',
    })
    family.setGridLayoutOverride('couple:parent+spouse', { order: 3 })

    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
      primarySpouseId: 'spouse',
    })
    expect(family.data.gridLayoutOverrides['couple:parent+spouse']).toEqual({ order: 3 })
  })

  it('stores unique semantic row order without writing legacy layout fields', () => {
    const family = useFamilyStore()

    family.setRowOrderPreference('row:0', [
      'unit:person:b',
      'unit:person:a',
      'unit:person:b',
    ])
    family.setRowOrderPreference('row:0', ['unit:person:a'])

    expect(family.data.layoutPreferences.rowOrders).toEqual([{
      id: 'row:0',
      domainId: 'legacy',
      generation: 0,
      unitIds: ['unit:person:a'],
    }])
    expect(family.data.manualPositions).toEqual({})
    expect(family.data.gridLayoutOverrides).toEqual({})
    expect(family.isDirty).toBe(true)
  })

  it('keeps the all-order reset idempotent when only a row order exists', () => {
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.members.child = mk('child')
      state.data.layoutPreferences = {
        rootOrders: [],
        rowOrders: [{
          id: 'row:0',
          domainId: 'legacy',
          generation: 0,
          unitIds: ['unit:person:b', 'unit:person:a'],
        }],
        bridgeOrders: [],
        rootAccentAssignments: {},
        familyAccentAssignments: {
          'unit:person:a': '#123456',
        },
      }
      state.data.childLayoutAssignments.child = {
        primaryParentId: 'parent',
      }
    })
    family.markClean()

    family.clearAllLayoutOrderPreferences()

    expect(family.data.layoutPreferences).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#123456',
      },
    })
    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
    })
    expect(family.isDirty).toBe(true)

    family.markClean()
    family.clearAllLayoutOrderPreferences()
    expect(family.isDirty).toBe(false)
  })

  it('clears every manual layout order and preserves accent assignments', () => {
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.layoutPreferences = {
        rootOrders: [{ componentId: 'component:a', rootIds: ['root:b', 'root:a'] }],
        rowOrders: [{
          id: 'root:a:0',
          domainId: 'domain:root:a',
          generation: 0,
          unitIds: ['unit:b', 'unit:a'],
        }],
        bridgeOrders: [{
          id: 'bridge:a+b:1',
          domainId: 'domain:bridge:a+b',
          generation: 1,
          unitIds: ['unit:cross-2', 'unit:cross-1'],
        }],
        rootAccentAssignments: { 'root:a': '#345678' },
        familyAccentAssignments: { 'unit:a': '#123456' },
      }
    })

    family.clearAllLayoutOrderPreferences()

    expect(family.data.layoutPreferences).toMatchObject({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: { 'root:a': '#345678' },
      familyAccentAssignments: { 'unit:a': '#123456' },
    })
  })

  it('stores root, domain-row and bridge order preferences idempotently', () => {
    const family = useFamilyStore()
    family.setRootOrderPreference('component:main', ['root:b', 'root:a', 'root:b'])
    family.setDomainRowOrderPreference({
      id: 'row:root:a:1',
      domainId: 'domain:root:a',
      generation: 1,
      unitIds: ['unit:b', 'unit:a', 'unit:b'],
    })
    family.setBridgeOrderPreference({
      id: 'row:bridge:a+b:2',
      domainId: 'domain:bridge:a+b',
      generation: 2,
      unitIds: ['unit:cross-b', 'unit:cross-a', 'unit:cross-b'],
    })

    expect(family.data.layoutPreferences).toMatchObject({
      rootOrders: [{
        componentId: 'component:main',
        rootIds: ['root:b', 'root:a'],
      }],
      rowOrders: [{
        id: 'row:root:a:1',
        domainId: 'domain:root:a',
        generation: 1,
        unitIds: ['unit:b', 'unit:a'],
      }],
      bridgeOrders: [{
        id: 'row:bridge:a+b:2',
        domainId: 'domain:bridge:a+b',
        generation: 2,
        unitIds: ['unit:cross-b', 'unit:cross-a'],
      }],
    })

    family.markClean()
    family.setRootOrderPreference('component:main', ['root:b', 'root:a'])
    expect(family.isDirty).toBe(false)
  })

  it('persists and clears family accent assignments', () => {
    const family = useFamilyStore()

    family.setFamilyAccentAssignment('unit:person:a', '#123456')
    expect(family.data.layoutPreferences.familyAccentAssignments).toEqual({
      'unit:person:a': '#123456',
    })

    family.setFamilyAccentAssignment('unit:person:a', null)
    expect(family.data.layoutPreferences.familyAccentAssignments).toEqual({})
  })

  it('reconciles semantic layout preferences after deleting a member', () => {
    const family = useFamilyStore()
    family.$patch((state) => {
      state.data.members = {
        a: mk('a'),
        b: mk('b'),
      }
      state.data.layoutPreferences = {
        rootOrders: [],
        rowOrders: [{
          id: 'row:dirty',
          domainId: 'legacy',
          generation: 0,
          unitIds: [
            'unit:person:b',
            'unit:person:a',
            'unit:person:b',
            'unit:person:unknown',
          ],
        }],
        bridgeOrders: [],
        rootAccentAssignments: {},
        familyAccentAssignments: {
          'unit:person:a': '#111111',
          'unit:person:b': '#222222',
          'unit:person:unknown': '#999999',
        },
      }
    })

    family.deleteMember('b')

    expect(family.data.layoutPreferences).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#111111',
      },
    })
  })
})
