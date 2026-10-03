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

const { importPhotoMock, resolvePhotoUrlMock, deletePhotoMock } = vi.hoisted(() => ({
  importPhotoMock: vi.fn(),
  resolvePhotoUrlMock: vi.fn(),
  deletePhotoMock: vi.fn(),
}))

vi.mock('@/services/storage', () => ({
  importPhoto: importPhotoMock,
  resolvePhotoUrl: resolvePhotoUrlMock,
  deletePhoto: deletePhotoMock,
}))

const project = { providerId: 'test-storage', id: 'opaque-project', displayName: '测试家族' }

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
      project,
      createEmptyMeta('测试'),
      createEmptyFamily(),
    )
    importPhotoMock.mockReset()
    importPhotoMock.mockResolvedValue({ photoId: 'new-photo' })
    resolvePhotoUrlMock.mockReset()
    resolvePhotoUrlMock.mockResolvedValue('asset://photo')
    deletePhotoMock.mockReset()
    deletePhotoMock.mockResolvedValue(undefined)
  })

  it('stages an imported photo before changing the draft reference', async () => {
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })

    await wrapper.get('[data-testid="confirm-crop"]').trigger('click')
    await flushPromises()

    expect(importPhotoMock).toHaveBeenCalledOnce()
    expect(importPhotoMock).toHaveBeenCalledWith(project, expect.any(Uint8Array), 'image/png')
    expect(wrapper.emitted('stage')).toEqual([['new-photo']])
    expect(wrapper.emitted('change')).toEqual([['new-photo']])
  })

  it.each(['another-project', project.id])('does not apply an imported photo after switching to a new session (%s)', async (id) => {
    let finishImport!: (value: { photoId: string }) => void
    importPhotoMock.mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve }))
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })
    await wrapper.get('[data-testid="confirm-crop"]').trigger('click')
    await flushPromises()
    expect(importPhotoMock).toHaveBeenCalledOnce()

    useFamilyStore().setProject({ ...project, id }, createEmptyMeta('另一会话'), createEmptyFamily())
    finishImport({ photoId: 'old-session-photo' })
    await flushPromises()

    expect(wrapper.emitted('stage')).toBeUndefined()
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(deletePhotoMock).toHaveBeenCalledWith(project, 'old-session-photo')
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeUndefined()
  })

  it('cleans a late import in its original project after the picker unmounts', async () => {
    let finishImport!: (value: { photoId: string }) => void
    importPhotoMock.mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve }))
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })
    await wrapper.get('[data-testid="confirm-crop"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    finishImport({ photoId: 'late-photo' })
    await flushPromises()

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(deletePhotoMock).toHaveBeenCalledWith(project, 'late-photo')
  })

  it('does not import an old crop result into the next project session', async () => {
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })
    const oldCropper = wrapper.getComponent(PhotoCropperStub)
    useFamilyStore().setProject(
      { ...project, providerId: 'another-storage' }, createEmptyMeta('新会话'), createEmptyFamily(),
    )
    await flushPromises()

    oldCropper.vm.$emit('confirm', new Blob(['old crop'], { type: 'image/png' }))
    await flushPromises()

    expect(importPhotoMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not import if the session changes while reading crop bytes', async () => {
    let finishRead!: (value: ArrayBuffer) => void
    const blob = new Blob(['old crop'], { type: 'image/png' })
    vi.spyOn(blob, 'arrayBuffer').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    const wrapper = mount(PhotoPicker, {
      global: { stubs: { PhotoCropper: PhotoCropperStub } },
    })

    wrapper.getComponent(PhotoCropperStub).vm.$emit('confirm', blob)
    useFamilyStore().setProject(project, createEmptyMeta('重新打开'), createEmptyFamily())
    finishRead(new ArrayBuffer(8))
    await flushPromises()

    expect(importPhotoMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('revokes a late preview from the old session without replacing the current preview', async () => {
    let finishPreview!: (value: string) => void
    resolvePhotoUrlMock.mockImplementationOnce(() => new Promise(resolve => { finishPreview = resolve }))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const wrapper = mount(PhotoPicker, { props: { photoId: 'portrait' } })

    useFamilyStore().setProject(project, createEmptyMeta('重新打开'), createEmptyFamily())
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('asset://photo')

    finishPreview('blob:old-session-preview')
    await flushPromises()

    expect(revoke).toHaveBeenCalledWith('blob:old-session-preview')
    expect(wrapper.get('img').attributes('src')).toBe('asset://photo')
    wrapper.unmount()
    revoke.mockRestore()
  })

  it('revokes a preview that resolves after unmount', async () => {
    let finishPreview!: (value: string) => void
    resolvePhotoUrlMock.mockImplementationOnce(() => new Promise(resolve => { finishPreview = resolve }))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const wrapper = mount(PhotoPicker, { props: { photoId: 'portrait' } })
    wrapper.unmount()

    finishPreview('blob:unmounted-preview')
    await flushPromises()

    expect(revoke).toHaveBeenCalledWith('blob:unmounted-preview')
    revoke.mockRestore()
  })

  it('removes only the draft reference and leaves persisted media untouched', async () => {
    const wrapper = mount(PhotoPicker, { props: { photoId: 'old-photo' } })
    await flushPromises()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('change')).toEqual([[undefined]])
  })
})
