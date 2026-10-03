/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FocusFlowMemberCard from '@/components/tree/focus-flow/FocusFlowMemberCard.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import type { ProjectRef } from '@/services/storage'

const { resolvePhotoUrlMock } = vi.hoisted(() => ({ resolvePhotoUrlMock: vi.fn() }))
vi.mock('@/services/storage', () => ({ resolvePhotoUrl: resolvePhotoUrlMock }))

const project: ProjectRef = {
  providerId: 'private-cloud',
  id: 'opaque-project-id',
  displayName: '云端家族',
}

function mountedCard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
  const member = { ...mk('member', { gender: 'female' }), photoId: 'private-photo' }
  const wrapper = mount(FocusFlowMemberCard, {
    props: { member },
    global: { plugins: [pinia] },
  })
  return { family, member, wrapper }
}

describe('FocusFlowMemberCard photo lifecycle', () => {
  beforeEach(() => {
    resolvePhotoUrlMock.mockReset()
    resolvePhotoUrlMock.mockResolvedValue('blob:private-photo')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the opaque project to storage and releases current photos on replacement and unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { member, wrapper } = mountedCard()
    await flushPromises()

    expect(resolvePhotoUrlMock).toHaveBeenCalledExactlyOnceWith(project, 'private-photo', true)
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-photo')

    resolvePhotoUrlMock.mockResolvedValueOnce('blob:replacement-photo')
    await wrapper.setProps({ member: { ...member, photoId: 'replacement-photo' } })
    await flushPromises()

    expect(resolvePhotoUrlMock).toHaveBeenLastCalledWith(project, 'replacement-photo', true)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private-photo')
    expect(wrapper.get('img').attributes('src')).toBe('blob:replacement-photo')

    wrapper.unmount()
    expect(revoke).toHaveBeenLastCalledWith('blob:replacement-photo')
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it.each([project.id, 'another-project-id'])('rejects a late photo after opening a new session (%s)', async (id) => {
    let finishPhoto!: (url: string) => void
    resolvePhotoUrlMock.mockImplementationOnce(() => new Promise<string>(resolve => { finishPhoto = resolve }))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { family, wrapper } = mountedCard()
    const nextProject = { ...project, id }

    family.setProject(nextProject, createEmptyMeta('新会话'), createEmptyFamily())
    await flushPromises()
    expect(resolvePhotoUrlMock).toHaveBeenNthCalledWith(2, nextProject, 'private-photo', true)
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-photo')

    finishPhoto('blob:old-session-photo')
    await flushPromises()

    expect(revoke).toHaveBeenCalledWith('blob:old-session-photo')
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-photo')
    wrapper.unmount()
  })

  it('releases a photo that finishes loading after unmount', async () => {
    let finishPhoto!: (url: string) => void
    resolvePhotoUrlMock.mockImplementationOnce(() => new Promise<string>(resolve => { finishPhoto = resolve }))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { wrapper } = mountedCard()
    wrapper.unmount()

    finishPhoto('blob:unmounted-photo')
    await flushPromises()

    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:unmounted-photo')
  })

  it('falls back to the default avatar if the current photo cannot be read', async () => {
    resolvePhotoUrlMock.mockRejectedValueOnce(new Error('需要重新授权'))
    const { wrapper } = mountedCard()
    await flushPromises()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('svg[role="img"]').attributes('data-gender')).toBe('female')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('默认头像')
    wrapper.unmount()
  })
})
