import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mk } from '@/__tests__/fixtures/families'
import { FamilyData, createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { getKinship } from '@/core/kinship'
import { useFamilyStore } from './family'

const specialIds = ['__proto__', 'constructor', 'toString']

beforeEach(() => setActivePinia(createPinia()))

describe('nickname overrides with arbitrary member IDs', () => {
  it.each(specialIds)('persists, reloads and clears an override from %s without changing inherited objects', fromId => {
    const toId = 'override-target'
    const inherited = Reflect.get({}, fromId)
    const descriptor = Object.getOwnPropertyDescriptor(inherited, toId)
    const family = useFamilyStore()
    family.setProject({ providerId: 'test', id: 'nicknames', displayName: '称谓' }, createEmptyMeta('称谓'), {
      ...createEmptyFamily(), members: Object.fromEntries([fromId, toId].map(id => [id, mk(id)])),
    })
    try {
      family.setNicknameOverride(fromId, toId, '自定义称谓')
      const saved = FamilyData.parse(JSON.parse(JSON.stringify(family.data)))

      expect(Object.hasOwn(saved.nicknameOverrides, fromId)).toBe(true)
      expect(getKinship(fromId, toId, saved.members, saved.nicknameOverrides)).toBe('自定义称谓')
      expect(Object.getOwnPropertyDescriptor(inherited, toId)).toEqual(descriptor)
      expect(family.isDirty).toBe(true)
      family.setProject(family.projectRef!, createEmptyMeta('称谓'), saved)
      expect(getKinship(fromId, toId, family.data.members, family.data.nicknameOverrides)).toBe('自定义称谓')

      family.setNicknameOverride(fromId, toId, null)

      expect(Object.hasOwn(family.data.nicknameOverrides, fromId)).toBe(false)
      expect(getKinship(fromId, toId, family.data.members, family.data.nicknameOverrides)).toBeNull()
    } finally {
      // Keep the failing regression safe to run against the old inherited-property write.
      if (descriptor) Object.defineProperty(inherited, toId, descriptor)
      else Reflect.deleteProperty(inherited, toId)
    }
  })

  it.each(specialIds)('preserves an override to %s and clears only that own key', toId => {
    const family = useFamilyStore()
    family.data.members = Object.fromEntries(['from', 'other', toId].map(id => [id, mk(id)]))
    family.setNicknameOverride('from', 'other', '保留')
    family.setNicknameOverride('from', toId, '特殊成员')
    const saved = FamilyData.parse(JSON.parse(JSON.stringify(family.data)))

    expect(Object.hasOwn(saved.nicknameOverrides.from, toId)).toBe(true)
    expect(getKinship('from', toId, saved.members, saved.nicknameOverrides)).toBe('特殊成员')
    family.setNicknameOverride('from', toId, '')
    expect(Object.keys(family.data.nicknameOverrides.from)).toEqual(['other'])
    expect(family.data.nicknameOverrides.from.other).toBe('保留')
    expect(getKinship('from', toId, family.data.members, family.data.nicknameOverrides)).toBeNull()
  })

  it.each(specialIds)('does not return an inherited %s member after deletion', id => {
    const family = useFamilyStore()
    family.data.members = Object.fromEntries([[id, mk(id)]])
    family.deleteMember(id)
    expect(family.getMember(id)).toBeUndefined()
  })
})
