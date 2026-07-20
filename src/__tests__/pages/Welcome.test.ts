/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Welcome from '@/pages/Welcome.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { managedProjectRef } from '@/services/projectRef'
import { useFamilyStore } from '@/stores/family'

const mocks = vi.hoisted(() => ({
  runtimePlatform: vi.fn(),
  listManagedProjects: vi.fn(),
  createManagedProject: vi.fn(),
  createProject: vi.fn(),
  openProject: vi.fn(),
  routerPush: vi.fn(),
  startAutosave: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))
vi.mock('@/services/runtime', () => ({
  getRuntimePlatform: mocks.runtimePlatform,
  isMobilePlatform: (platform: string) => platform === 'ios' || platform === 'android',
}))
vi.mock('@/services/projectService', () => ({
  listManagedProjects: mocks.listManagedProjects,
  createManagedProject: mocks.createManagedProject,
  createProject: mocks.createProject,
  openProject: mocks.openProject,
}))
vi.mock('@/services/autosave', () => ({ startAutosave: mocks.startAutosave }))
vi.mock('@/services/prefs', () => ({
  getLastProjectRef: () => null,
  setLastProjectRef: vi.fn(),
  getLayoutModePreference: () => 'auto',
  setLayoutModePreference: vi.fn(),
}))
vi.mock('@/services/tauriApi', () => ({ pickDirectory: vi.fn() }))

describe('Welcome mobile project library', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.routerPush.mockResolvedValue(undefined)
    mocks.listManagedProjects.mockResolvedValue([])
  })

  it('shows managed AppData projects instead of desktop folder actions', async () => {
    const project = managedProjectRef('00000000-0000-0000-0000-000000000001')
    mocks.runtimePlatform.mockResolvedValue('ios')
    mocks.listManagedProjects.mockResolvedValue([{
      project,
      meta: createEmptyMeta('移动家族'),
    }])

    const wrapper = mount(Welcome)
    await flushPromises()

    expect(wrapper.text()).toContain('移动家族')
    expect(wrapper.text()).not.toContain('打开已有家族')
    expect(mocks.listManagedProjects).toHaveBeenCalledOnce()
  })

  it('creates and opens a managed project from the mobile form', async () => {
    const project = managedProjectRef('00000000-0000-0000-0000-000000000002')
    const meta = createEmptyMeta('新家族')
    const familyData = createEmptyFamily()
    mocks.runtimePlatform.mockResolvedValue('android')
    mocks.createManagedProject.mockResolvedValue({ project, meta, family: familyData })

    const wrapper = mount(Welcome)
    await flushPromises()
    await wrapper.get('input[aria-label="家族名称"]').setValue('新家族')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createManagedProject).toHaveBeenCalledWith('新家族')
    expect(useFamilyStore().projectRef).toEqual(project)
    expect(mocks.startAutosave).toHaveBeenCalledOnce()
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })

  it('keeps desktop folder actions on desktop runtimes', async () => {
    mocks.runtimePlatform.mockResolvedValue('macos')

    const wrapper = mount(Welcome)
    await flushPromises()

    expect(wrapper.text()).toContain('打开已有家族')
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
  })
})
