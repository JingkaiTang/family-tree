/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, isNavigationFailure, NavigationFailureType } from 'vue-router'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { createAppRouter } from './index'

const mocks = vi.hoisted(() => ({ flushNow: vi.fn(), memberLeave: vi.fn() }))
vi.mock('@/services/autosave', () => ({ flushNow: mocks.flushNow }))

vi.mock('@/pages/Welcome.vue', () => ({ default: { template: '<div>Welcome</div>' } }))
vi.mock('@/pages/TreeView.vue', () => ({ default: { template: '<div>Tree</div>' } }))
vi.mock('@/pages/MemberDetail.vue', () => ({
  default: { template: '<div>Member</div>', beforeRouteLeave: mocks.memberLeave },
}))

const project = { providerId: 'browser-directory', id: 'saved-directory', displayName: '本地家族' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.flushNow.mockResolvedValue(undefined)
  mocks.memberLeave.mockReturnValue(true)
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('project route restoration', () => {
  it.each(['/tree', '/member/member-1'])('redirects a fresh session at %s to Welcome', async (path) => {
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('welcome')
    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.redirectedFrom?.path).toBe(path)
    expect(useFamilyStore().projectRef).toBeNull()
  })

  it('does not treat a persisted reference as an already loaded project', async () => {
    localStorage.setItem('family-tree:lastProjectRef', JSON.stringify(project))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/tree')

    expect(router.currentRoute.value.name).toBe('welcome')
    expect(useFamilyStore().projectRef).toBeNull()
    expect(localStorage.getItem('family-tree:lastProjectRef')).toBe(JSON.stringify(project))
  })

  it('allows navigation after Welcome has hydrated the project without a redirect loop', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/member/member-1')
    expect(router.currentRoute.value.name).toBe('welcome')

    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    await router.push('/tree')
    expect(router.currentRoute.value.name).toBe('tree')
    await router.push('/member/member-1')
    expect(router.currentRoute.value.name).toBe('member')
    expect(router.currentRoute.value.params.id).toBe('member-1')
    expect(family.projectRef).toEqual(project)
  })

  it.each(['browser-directory', 'test-remote-provider'])(
    'allows an active %s project without assuming its storage location',
    async (providerId) => {
      const family = useFamilyStore()
      family.setProject({ ...project, providerId }, createEmptyMeta(project.displayName), createEmptyFamily())
      const router = createAppRouter(createMemoryHistory())
      await router.push('/tree')

      expect(router.currentRoute.value.name).toBe('tree')
      expect(family.projectRef?.providerId).toBe(providerId)
    },
  )

  it('checks the current project again after the session is closed', async () => {
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    const router = createAppRouter(createMemoryHistory())
    await router.push('/tree')
    family.closeProject()
    await router.push('/member/member-1')

    expect(router.currentRoute.value.name).toBe('welcome')
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('welcome')
  })
})

describe('leaving a project through browser history', () => {
  it('waits for pending edits before closing the session and returning to Welcome', async () => {
    const family = useFamilyStore()
    const ui = useUiStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    family.setDefaultViewpoint('edited-before-debounce')
    ui.setSelected('selected-member')
    ui.setViewpoint('viewpoint-member')
    ui.setShowAuxiliaryRelations(true)
    ui.setCanvasView({ x: 10, y: 20, scale: 2 })
    ui.setLayoutFocus('focus-member')
    const saved = deferred()
    mocks.flushNow.mockImplementationOnce(async () => {
      await saved.promise
      family.markClean()
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.push('/tree')
    router.back()
    await flushPromises()

    expect(mocks.flushNow).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.name).toBe('tree')
    expect(family.projectRef).toEqual(project)
    expect(family.isDirty).toBe(true)
    expect(family.data.defaultViewpointId).toBe('edited-before-debounce')
    expect(localStorage.getItem('family-tree:lastProjectRef')).not.toBeNull()
    saved.resolve()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('welcome')
    expect(family.projectRef).toBeNull()
    expect(localStorage.getItem('family-tree:lastProjectRef')).toBeNull()
    expect(ui.selectedId).toBeNull()
    expect(ui.viewpointId).toBeNull()
    expect(ui.showAuxiliaryRelations).toBe(false)
    expect(ui.canvasView).toBeNull()
    expect(ui.layoutFocusId).toBeNull()
  })

  it('blocks navigation and preserves unsaved data when the save fails', async () => {
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    family.setDefaultViewpoint('unsaved-edit')
    mocks.flushNow.mockRejectedValueOnce(new Error('目录权限失效'))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/tree')
    const failure = await router.push('/')

    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.name).toBe('tree')
    expect(family.projectRef).toEqual(project)
    expect(family.isDirty).toBe(true)
    expect(family.data.defaultViewpointId).toBe('unsaved-edit')
    expect(localStorage.getItem('family-tree:lastProjectRef')).not.toBeNull()
    expect(useUiStore().toast).toEqual({
      type: 'error', text: '保存失败，项目保持打开：目录权限失效',
    })
  })

  it('does not close a project if another navigation supersedes the pending departure', async () => {
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    family.setDefaultViewpoint('pending-edit')
    const saved = deferred()
    mocks.flushNow.mockReturnValueOnce(saved.promise)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/tree')
    const leaving = router.push('/')
    await flushPromises()
    await router.push('/member/member-1')
    saved.resolve()
    const failure = await leaving

    expect(isNavigationFailure(failure, NavigationFailureType.cancelled)).toBe(true)
    expect(router.currentRoute.value.name).toBe('member')
    expect(family.projectRef).toEqual(project)
    expect(family.data.defaultViewpointId).toBe('pending-edit')
    expect(localStorage.getItem('family-tree:lastProjectRef')).not.toBeNull()
  })

  it('honors a component draft guard before starting the project save', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    family.setDefaultViewpoint('unsaved-edit')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/member/member-1')
    const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, router] } })
    await flushPromises()
    mocks.memberLeave.mockReturnValueOnce(false)
    const failure = await router.push('/')

    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.name).toBe('member')
    expect(mocks.flushNow).not.toHaveBeenCalled()
    expect(family.projectRef).toEqual(project)
    await router.push('/')
    expect(mocks.flushNow).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.name).toBe('welcome')
    expect(family.projectRef).toBeNull()
    wrapper.unmount()
  })

  it('does not save twice after the page back action has already closed the project', async () => {
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta(project.displayName), createEmptyFamily())
    const router = createAppRouter(createMemoryHistory())
    await router.push('/tree')
    family.closeProject()
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('welcome')
    expect(mocks.flushNow).not.toHaveBeenCalled()
  })
})

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
