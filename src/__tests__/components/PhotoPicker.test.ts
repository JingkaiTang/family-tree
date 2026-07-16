/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import PhotoPicker from '@/components/member/PhotoPicker.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'

const { importPhotoMock, resolvePhotoUrlMock } = vi.hoisted(() => ({
  importPhotoMock: vi.fn(),
  resolvePhotoUrlMock: vi.fn(),
}))

vi.mock('@/services/tauriApi', () => ({
  importPhoto: importPhotoMock,
  resolvePhotoUrl: resolvePhotoUrlMock,
}))

const PhotoCropperStub = defineComponent({
  name: 'PhotoCropper',
  emits: ['confirm', 'cancel'],
  setup(_, { emit }) {
    return () => h('button', {
      'data-testid': 'confirm-crop',
      onClick: () => emit('confirm', new Blob(['image'], { type: 'image/png' })),
    })
  },
})

describe('PhotoPicker media staging', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useFamilyStore().setProject(
      '/tmp/test.family',
      createEmptyMeta('测试'),
      createEmptyFamily(),
    )
    importPhotoMock.mockReset()
    importPhotoMock.mockResolvedValue({ photoId: 'new-photo' })
    resolvePhotoUrlMock.mockReset()
    resolvePhotoUrlMock.mockResolvedValue('asset://photo')
  })

  it('stages an imported photo before changing the draft reference', async () => {
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })

    await wrapper.get('[data-testid="confirm-crop"]').trigger('click')
    await flushPromises()

    expect(importPhotoMock).toHaveBeenCalledOnce()
    expect(wrapper.emitted('stage')).toEqual([['new-photo']])
    expect(wrapper.emitted('change')).toEqual([['new-photo']])
  })

  it('removes only the draft reference and leaves persisted media untouched', async () => {
    const wrapper = mount(PhotoPicker, { props: { photoId: 'old-photo' } })
    await flushPromises()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('change')).toEqual([[undefined]])
  })
})
