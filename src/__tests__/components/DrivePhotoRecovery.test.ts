// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MemberNode from '@/components/tree/MemberNode.vue'
import FocusFlowMemberCard from '@/components/tree/focus-flow/FocusFlowMemberCard.vue'
import PhotoPicker from '@/components/member/PhotoPicker.vue'
import { useFamilyStore } from '@/stores/family'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'

const mocks = vi.hoisted(() => ({ state: { mediaEpoch: 0 }, read: vi.fn() }))
vi.mock('@/services/googleDriveConnection', async () => {
  const { reactive } = await import('vue')
  mocks.state = reactive(mocks.state)
  return { googleDriveState: mocks.state }
})
vi.mock('@/services/storage', () => ({ resolvePhotoUrl: mocks.read, importPhoto: vi.fn(), deletePhoto: vi.fn() }))
vi.mock('@/services/prefs', () => ({ getLayoutModePreference: () => 'auto', setLayoutModePreference: vi.fn(), setLastProjectRef: vi.fn() }))

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.state.mediaEpoch = 0
  mocks.read.mockReset()
  mocks.read.mockRejectedValueOnce(new Error('Google token expired'))
  mocks.read.mockResolvedValue('blob:restored-private-photo')
  useFamilyStore().setProject(
    { providerId: 'google-drive:client:account', id: 'folder', displayName: '云端家族' },
    createEmptyMeta('云端家族'), createEmptyFamily(),
  )
  useFamilyStore().markDirty()
})
afterEach(() => vi.restoreAllMocks())

describe('private photos after Google reauthorization', () => {
  const member = { ...mk('member'), photoId: 'private-photo' }
  const cases = [
    { name: 'desktop grid', render: () => mount(MemberNode, { props: { member, left: 0, top: 0, width: 110, height: 210 } }) },
    { name: 'mobile flow', render: () => mount(FocusFlowMemberCard, { props: { member } }) },
    { name: 'member photo form', render: () => mount(PhotoPicker, { props: { photoId: member.photoId }, global: { stubs: { PhotoCropper: true } } }) },
  ]
  it.each(cases)('reloads $name without resetting unsaved family data', async ({ render }) => {
    const family = useFamilyStore()
    const token = family.projectToken
    const revision = family.revision
    const wrapper = render()
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    mocks.state.mediaEpoch++
    await flushPromises()
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(wrapper.get('img').attributes('src')).toBe('blob:restored-private-photo')
    expect(family.projectToken).toBe(token)
    expect(family.revision).toBe(revision)
    expect(family.isDirty).toBe(true)
    wrapper.unmount()
  })
})
