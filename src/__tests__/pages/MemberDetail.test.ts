/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import MemberDetail from '@/pages/MemberDetail.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'

const { deletePhotoMock, flushNowMock, routerBack, routerPush } = vi.hoisted(() => ({
  deletePhotoMock: vi.fn(),
  flushNowMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ back: routerBack, push: routerPush }),
}))
vi.mock('@/services/autosave', () => ({ flushNow: flushNowMock }))
vi.mock('@/services/tauriApi', () => ({ deletePhoto: deletePhotoMock }))

const MemberFormStub = defineComponent({
  name: 'MemberForm',
  props: ['modelValue'],
  emits: ['update:modelValue', 'save', 'cancel', 'delete', 'media-stage'],
  setup(props, { emit }) {
    const stage = (photoId: string) => {
      emit('media-stage', photoId)
      emit('update:modelValue', { ...props.modelValue, photoId })
    }
    return () => h('div', [
      h('button', { 'data-testid': 'stage-one', onClick: () => stage('new-photo-1') }),
      h('button', { 'data-testid': 'stage-two', onClick: () => stage('new-photo-2') }),
      h('button', { 'data-testid': 'save', onClick: () => emit('save') }),
      h('button', { 'data-testid': 'cancel', onClick: () => emit('cancel') }),
    ])
  },
})

describe('MemberDetail photo transaction', () => {
  beforeEach(() => {
    flushNowMock.mockReset()
    flushNowMock.mockResolvedValue(undefined)
    deletePhotoMock.mockReset()
    deletePhotoMock.mockResolvedValue(undefined)
    routerBack.mockReset()
    routerPush.mockReset()
  })

  it('discards staged media and preserves the persisted photo on cancel', async () => {
    const { family, wrapper } = mountedMember()

    await wrapper.get('[data-testid="stage-one"]').trigger('click')
    await wrapper.get('[data-testid="cancel"]').trigger('click')
    await flushPromises()

    expect(deletePhotoMock).toHaveBeenCalledWith('/tmp/test.family', 'new-photo-1')
    expect(deletePhotoMock).not.toHaveBeenCalledWith('/tmp/test.family', 'old-photo')
    expect(family.data.members.a.photoId).toBe('old-photo')
    expect(routerBack).toHaveBeenCalledOnce()
  })

  it('keeps the committed photo and cleans superseded staged media after save', async () => {
    const { family, wrapper } = mountedMember()

    await wrapper.get('[data-testid="stage-one"]').trigger('click')
    await wrapper.get('[data-testid="stage-two"]').trigger('click')
    await wrapper.get('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(flushNowMock).toHaveBeenCalledOnce()
    expect(family.data.members.a.photoId).toBe('new-photo-2')
    expect(deletePhotoMock).toHaveBeenCalledTimes(1)
    expect(deletePhotoMock).toHaveBeenCalledWith('/tmp/test.family', 'new-photo-1')
  })

  it('does not delete a staged photo that remains referenced after a failed save', async () => {
    const { family, wrapper } = mountedMember()
    flushNowMock.mockRejectedValueOnce(new Error('disk full'))

    await wrapper.get('[data-testid="stage-one"]').trigger('click')
    await wrapper.get('[data-testid="save"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    await flushPromises()

    expect(family.data.members.a.photoId).toBe('new-photo-1')
    expect(family.isDirty).toBe(true)
    expect(deletePhotoMock).not.toHaveBeenCalled()
  })
})

function mountedMember() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const data = createEmptyFamily()
  data.members.a = { ...mk('a'), photoId: 'old-photo' }
  family.setProject('/tmp/test.family', createEmptyMeta('测试'), data)
  const wrapper = mount(MemberDetail, {
    props: { id: 'a' },
    global: {
      plugins: [pinia],
      stubs: {
        MemberForm: MemberFormStub,
        RelationEditor: true,
      },
    },
  })
  return { family, wrapper }
}
