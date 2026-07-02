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
})
