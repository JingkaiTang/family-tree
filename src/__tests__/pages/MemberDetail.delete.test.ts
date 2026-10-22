/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'

const mocks = vi.hoisted(() => ({
  flushNow: vi.fn(),
  deletePhoto: vi.fn(),
  importPhoto: vi.fn(),
  resolvePhotoUrl: vi.fn(),
}))
vi.mock('@/services/autosave', () => ({ flushNow: mocks.flushNow }))
vi.mock('@/services/storage', () => ({
  deletePhoto: mocks.deletePhoto,
  importPhoto: mocks.importPhoto,
  resolvePhotoUrl: mocks.resolvePhotoUrl,
}))
vi.mock('@/pages/Welcome.vue', () => ({ default: { template: '<div>欢迎页</div>' } }))
vi.mock('@/pages/TreeView.vue', () => ({ default: { template: '<div>家族树</div>' } }))

// Keep the actual photo staging, member form and router; only decoded crop/IO are substitutes.
const PhotoCropperStub = defineComponent({
  name: 'PhotoCropper',
  emits: ['confirm'],
  setup(_, { emit }) {
    return () => h('button', {
      type: 'button',
      'data-testid': 'confirm-crop',
      onClick: () => emit('confirm', new Blob(['decoded crop'], { type: 'image/png' })),
    }, '确认裁剪')
  },
})

const project = { providerId: 'test-storage', id: 'delete-project', displayName: '测试家族' }
const mounted: VueWrapper[] = []
const storedPhotos = new Set<string>()

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  storedPhotos.clear()
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
  mocks.flushNow.mockImplementation(async () => { useFamilyStore().markClean() })
  mocks.deletePhoto.mockImplementation(async (_, photoId: string) => { storedPhotos.delete(photoId) })
  let photoSequence = 0
  mocks.importPhoto.mockImplementation(async () => {
    const photoId = `new-photo-${++photoSequence}`
    storedPhotos.add(photoId)
    return { photoId }
  })
  mocks.resolvePhotoUrl.mockResolvedValue('data:image/png;base64,aQ==')
})

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  await flushPromises()
  vi.unstubAllGlobals()
})

describe('MemberDetail deletion sessions', () => {
  it('cleans only its original staged photos when a later member stages a photo during deletion', async () => {
    const { family, router, wrapper } = await mountedMember()
    await stagePhoto(wrapper)
    const saved = deferred()
    mocks.flushNow.mockImplementationOnce(async () => {
      await saved.promise
      family.markClean()
    })
    await clickButton(wrapper, '删除此成员')
    expect(family.data.members.a).toBeUndefined()

    await router.push('/member/b')
    await flushPromises()
    await stagePhoto(wrapper)
    expect(family.data.members.b.photoId).toBeUndefined()
    expect(mocks.deletePhoto).not.toHaveBeenCalled()

    saved.resolve()
    await flushPromises()

    expect(mocks.deletePhoto).toHaveBeenCalledExactlyOnceWith(project, 'new-photo-1')
    expect(storedPhotos.has('new-photo-2')).toBe(true)
    expect(router.currentRoute.value.path).toBe('/member/b')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(family.data.members.b.photoId).toBe('new-photo-2')
    expect(storedPhotos.has(family.data.members.b.photoId!)).toBe(true)
    expect(family.isDirty).toBe(false)
  })

  it.each(['success', 'failure'] as const)('does not navigate or notify a later project after old cleanup %s', async outcome => {
    const { family, router, wrapper } = await mountedMember()
    await stagePhoto(wrapper)
    const cleaned = deferred()
    mocks.deletePhoto.mockImplementation(() => cleaned.promise)
    await clickButton(wrapper, '删除此成员')
    expect(mocks.deletePhoto).toHaveBeenCalledWith(project, 'new-photo-1')

    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)
    const nextData = createEmptyFamily()
    nextData.members.b = mk('b')
    family.setProject({ ...project, id: 'later-project' }, createEmptyMeta('后来项目'), nextData)
    await router.push('/member/b')
    const ui = useUiStore()
    ui.showToast('info', '后来项目的提示')

    if (outcome === 'success') cleaned.resolve()
    else cleaned.reject(new Error('旧照片清理失败'))
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/member/b')
    expect(ui.toast).toEqual({ type: 'info', text: '后来项目的提示' })
  })

  it('does not show an old deletion failure in a later member editor', async () => {
    const { router, wrapper } = await mountedMember()
    const saved = deferred()
    mocks.flushNow.mockReturnValueOnce(saved.promise)
    await clickButton(wrapper, '删除此成员')
    await router.push('/member/b')
    await flushPromises()
    const ui = useUiStore()
    ui.showToast('info', '正在编辑第二位')

    saved.reject(new Error('旧删除保存失败'))
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/member/b')
    expect(ui.toast).toEqual({ type: 'info', text: '正在编辑第二位' })
  })

  it('still completes cleanup and returns to the tree for its current editor', async () => {
    const { family, router, wrapper } = await mountedMember()
    await stagePhoto(wrapper)
    const saved = deferred()
    mocks.flushNow.mockReturnValueOnce(saved.promise)
    await clickButton(wrapper, '删除此成员')
    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(mocks.deletePhoto).not.toHaveBeenCalled()

    saved.resolve()
    await flushPromises()

    expect(family.data.members.a).toBeUndefined()
    expect(mocks.deletePhoto).toHaveBeenCalledExactlyOnceWith(project, 'new-photo-1')
    expect(storedPhotos.size).toBe(0)
    expect(router.currentRoute.value.path).toBe('/tree')
  })

  it('still reports a deletion persistence failure in its current editor', async () => {
    const { family, router, wrapper } = await mountedMember()
    mocks.flushNow.mockRejectedValueOnce(new Error('磁盘已满'))
    await clickButton(wrapper, '删除此成员')

    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(family.isDirty).toBe(true)
    expect(useUiStore().toast).toEqual({ type: 'error', text: '删除保存失败：磁盘已满' })
  })
})

async function mountedMember() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const data = createEmptyFamily()
  data.members.a = mk('a')
  data.members.b = mk('b')
  family.setProject(project, createEmptyMeta('测试'), data)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/member/a')
  const wrapper = mount({ template: '<RouterView />' }, {
    global: {
      plugins: [pinia, router],
      stubs: { PhotoCropper: PhotoCropperStub, RelationEditor: true, SiblingOrderEditor: true },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return { family, router, wrapper }
}

async function stagePhoto(wrapper: VueWrapper) {
  const file = wrapper.get<HTMLInputElement>('input[type=file]')
  Object.defineProperty(file.element, 'files', { value: [new File(['original'], 'portrait.png')], configurable: true })
  await file.trigger('change')
  await wrapper.get('[data-testid="confirm-crop"]').trigger('click')
  await flushPromises()
}

async function clickButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find(value => value.text() === text)
  if (!button) throw new Error(`Missing visible button: ${text}`)
  await button.trigger('click')
  await flushPromises()
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
