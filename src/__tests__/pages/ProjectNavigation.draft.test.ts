// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, isNavigationFailure, NavigationFailureType } from 'vue-router'
import { createAppRouter } from '@/router'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'

const mocks = vi.hoisted(() => ({ flush: vi.fn() }))
vi.mock('@/services/autosave', () => ({ flushNow: mocks.flush, startAutosave: vi.fn() }))
vi.mock('@/services/googleDriveConnection', () => ({
  googleDriveState: { ready: false, configured: false, busy: false, error: null },
  prepareGoogleDrive: vi.fn().mockResolvedValue(undefined),
  connectGoogleDrive: vi.fn(),
}))
vi.mock('@/services/storage', () => ({
  authorizeProject: vi.fn().mockResolvedValue(undefined),
  deletePhoto: vi.fn(),
  supportsMediaGc: vi.fn().mockReturnValue(false),
  gcMedia: vi.fn(),
  renameProject: vi.fn(),
}))
vi.mock('@/pages/Welcome.vue', () => ({ default: { template: '<div>欢迎页</div>' } }))

const mounted: VueWrapper[] = []
const project = { providerId: 'test-storage', id: 'a-family', displayName: '家族' }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.flush.mockResolvedValue(undefined)
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(complete => { resolve = complete })
  return { promise, resolve }
}

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const data = createEmptyFamily()
  data.members.a = mk('a', { firstName: '原名字' })
  family.setProject(project, createEmptyMeta('家族'), data)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/tree')
  const wrapper = mount({ template: '<RouterView />' }, {
    global: {
      plugins: [pinia, router],
      stubs: { TreeLayoutHost: true, SearchBar: true, PhotoPicker: true, RelationEditor: true, SiblingOrderEditor: true },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return { family, router, wrapper }
}

function memberNameInput(wrapper: VueWrapper) {
  return wrapper.findAll('label')
    .find(label => label.find('span').exists() && label.find('span').text() === '名')!.get('input')
}

it('preserves a later member draft when navigation supersedes a pending tree departure', async () => {
  const { family, router, wrapper } = await setup()
  const saved = deferred()
  mocks.flush.mockReturnValueOnce(saved.promise)
  await wrapper.findAll('button').find(button => button.text() === '返回')!.trigger('click')
  await flushPromises()
  expect(mocks.flush).toHaveBeenCalledOnce()

  await router.push('/member/a')
  await flushPromises()
  const nameInput = memberNameInput(wrapper)
  await nameInput.setValue('保存等待期间写的新资料')
  expect(wrapper.get('header').text()).toContain('资料未保存')

  saved.resolve()
  await flushPromises()

  expect(router.currentRoute.value.path).toBe('/member/a')
  expect(family.projectRef).toEqual(project)
  expect(nameInput.element.value).toBe('保存等待期间写的新资料')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  const refreshing = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(refreshing)
  expect(refreshing.defaultPrevented).toBe(true)
})

it.each(['changed', 'reverted', 'unchanged'])(
  'checks %s member drafts again after a pending departure save', async edit => {
    const { family, router, wrapper } = await setup()
    await router.push('/member/a')
    await flushPromises()
    family.setDefaultViewpoint('a')
    const saved = deferred()
    mocks.flush.mockImplementationOnce(async () => {
      await saved.promise
      family.markClean()
    })
    const leaving = router.push('/')
    await flushPromises()
    expect(mocks.flush).toHaveBeenCalledOnce()

    if (edit !== 'unchanged') await memberNameInput(wrapper).setValue('等待关闭期间的新草稿')
    if (edit === 'reverted') await memberNameInput(wrapper).setValue('原名字')
    saved.resolve()
    const result = await leaving
    await flushPromises()

    if (edit === 'unchanged') {
      expect(result).toBeUndefined()
      expect(router.currentRoute.value.path).toBe('/')
      expect(family.projectRef).toBeNull()
    } else {
      expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
      expect(router.currentRoute.value.path).toBe('/member/a')
      expect(family.projectRef).toEqual(project)
      expect(family.isDirty).toBe(false)
      expect(memberNameInput(wrapper).element.value).toBe(edit === 'changed' ? '等待关闭期间的新草稿' : '原名字')
      expect(useUiStore().toast?.text).toContain('请先保存或放弃')
    }
  },
)

it.each(['draft', 'project'])(
  'preserves a newer %s while the destination page is still loading', async change => {
    const { family, router, wrapper } = await setup()
    await router.push('/member/a')
    await flushPromises()
    family.setDefaultViewpoint('a')
    let loadWelcome!: (component: { template: string }) => void
    router.addRoute({
      path: '/', name: 'welcome',
      component: () => new Promise<{ template: string }>(resolve => { loadWelcome = resolve }),
    })
    const leaving = router.push('/')
    await flushPromises()
    expect(mocks.flush).not.toHaveBeenCalled()

    if (change === 'draft') {
      await memberNameInput(wrapper).setValue('等待页面下载期间的新草稿')
    } else {
      const next = createEmptyFamily()
      next.members.a = mk('a', { firstName: '新项目成员' })
      family.setProject({ ...project, id: 'new-project' }, createEmptyMeta('新项目'), next)
    }
    loadWelcome({ template: '<div>欢迎页</div>' })
    const result = await leaving
    await flushPromises()

    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(family.projectRef?.id).toBe(change === 'draft' ? project.id : 'new-project')
    expect(memberNameInput(wrapper).element.value).toBe(change === 'draft' ? '等待页面下载期间的新草稿' : '新项目成员')
    expect(mocks.flush).not.toHaveBeenCalled()
  },
)
