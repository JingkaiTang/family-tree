import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import { addParent, addSpouse, mk } from '@/__tests__/fixtures/families'
import { createEmptyFamily, FamilyData } from '@/core/schema'
import { useFamilyStore } from './family'

beforeEach(() => setActivePinia(createPinia()))

describe('member reactivity with prototype-named IDs', () => {
  it.each(['__proto__', 'constructor', 'toString'])('keeps layout assignments and legacy positions for %s as own JSON keys', id => {
    const family = useFamilyStore()
    family.data.members = Object.fromEntries([id, 'parent'].map(memberId => [memberId, mk(memberId)]))
    family.setChildLayoutAssignment(id, { primaryParentId: 'parent' })
    family.setManualPosition(id, 2, 3)
    const saved = FamilyData.parse(JSON.parse(JSON.stringify(family.data)))
    expect(Object.hasOwn(saved.childLayoutAssignments, id)).toBe(true)
    expect(saved.childLayoutAssignments[id]).toEqual({ primaryParentId: 'parent' })
    expect(Object.hasOwn(saved.manualPositions, id)).toBe(true)
    expect(saved.manualPositions[id]).toEqual({ cx: 2, top: 3 })

    family.setChildLayoutAssignment(id, null)
    family.clearManualPosition(id)
    expect(Object.keys(family.data.childLayoutAssignments)).toEqual([])
    expect(Object.keys(family.data.manualPositions)).toEqual([])
  })

  it.each(['normal', '__proto__', 'constructor', 'toString'])('publishes insert, profile replacement and deletion for %s', id => {
    const family = useFamilyStore()
    const projectData = family.data
    const member = computed(() => family.getMember(id))
    expect(member.value).toBeUndefined()
    expect(family.membersArray).toEqual([])

    family.upsertMember(mk(id, { firstName: 'before' }))
    expect(Object.hasOwn(family.data.members, id)).toBe(true)
    expect(Object.getPrototypeOf(family.data.members)).toBe(Object.prototype)
    expect(member.value?.firstName).toBe('before')
    expect(family.membersArray[0].firstName).toBe('before')
    family.updateMember(id, { firstName: 'after' })
    expect(member.value?.firstName).toBe('after')
    expect(family.membersArray[0].firstName).toBe('after')

    family.deleteMember(id)
    expect(member.value).toBeUndefined()
    expect(family.membersArray).toEqual([])
    expect(family.data).toBe(projectData)
  })

  for (const id of ['normal', '__proto__']) {
    for (const relation of ['parent', 'spouse'] as const) {
      it.each(['link', 'unlink', 'delete'] as const)(`${id} publishes ${relation} %s through nested computed views`, action => {
        const family = useFamilyStore()
        const person = mk(id)
        const other = mk('other')
        if (action !== 'link') {
          if (relation === 'parent') addParent(person, other)
          else addSpouse(person, other)
        }
        family.data = { ...createEmptyFamily(), members: Object.fromEntries([[id, person], ['other', other]]) }
        const projectData = family.data
        const key = relation === 'parent' ? 'parents' : 'spouses'
        const detailMember = computed(() => family.getMember(id))
        const detailRelations = computed(() => detailMember.value?.[key])
        const detailCount = computed(() => detailRelations.value?.length)
        const arrayMember = computed(() => family.membersArray.find(member => member.id === id))
        const arrayCount = computed(() => arrayMember.value?.[key].length)
        const initial = action === 'link' ? 0 : 1
        expect(detailCount.value).toBe(initial)
        expect(arrayCount.value).toBe(initial)

        if (action === 'link') family.linkRelation(id, 'other', relation)
        else if (action === 'unlink') family.unlinkRelation(id, 'other', relation)
        else family.deleteMember('other')

        expect(family.data.members[id][key]).toHaveLength(1 - initial)
        expect(detailCount.value).toBe(1 - initial)
        expect(arrayCount.value).toBe(1 - initial)
        expect(family.data).toBe(projectData)
      })
    }
  }
})
