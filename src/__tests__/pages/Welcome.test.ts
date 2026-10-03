/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Welcome from '@/pages/Welcome.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { externalProjectRef, managedProjectRef } from '@/services/projectRef'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'

const mocks = vi.hoisted(() => ({
  runtimePlatform: vi.fn(),
  pickProject: vi.fn(),
  authorizeProject: vi.fn(),
  getDirectoryStorageAvailability: vi.fn(),
  getLastProjectRef: vi.fn(),
  setLastProjectRef: vi.fn(),
  listManagedProjects: vi.fn(),
  createManagedProject: vi.fn(),
  createProject: vi.fn(),
  openProject: vi.fn(),
  importProjectBundle: vi.fn(),
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
vi.mock('@/services/projectTransfer', () => ({
  importProjectBundle: mocks.importProjectBundle,
}))
vi.mock('@/services/prefs', () => ({
  getLastProjectRef: mocks.getLastProjectRef,
  setLastProjectRef: mocks.setLastProjectRef,
  getLayoutModePreference: () => 'auto',
  setLayoutModePreference: vi.fn(),
}))
vi.mock('@/services/storage', () => ({
  pickProject: mocks.pickProject,
  authorizeProject: mocks.authorizeProject,
  getDirectoryStorageAvailability: mocks.getDirectoryStorageAvailability,
}))

const selected = { providerId: 'tauri-local', id: 'opaque-location', displayName: '家族显示名' }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  mocks.runtimePlatform.mockResolvedValue('macos')
  mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: true, reason: null })
  mocks.getLastProjectRef.mockReturnValue(null)
  mocks.pickProject.mockResolvedValue(selected)
  mocks.createProject.mockResolvedValue({
    project: { ...selected, id: 'created-project' },
    meta: createEmptyMeta(selected.displayName),
    family: createEmptyFamily(),
  })
  mocks.openProject.mockResolvedValue({
    project: selected,
    meta: createEmptyMeta(selected.displayName),
    family: createEmptyFamily(),
  })
  mocks.routerPush.mockResolvedValue(undefined)
  mocks.listManagedProjects.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Welcome mobile project library', () => {
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
    expect(useUiStore().defaultLayoutMode).toBe('focus-flow')
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

  it('imports a backup into managed storage and opens it', async () => {
    const project = managedProjectRef('00000000-0000-0000-0000-000000000003')
    const meta = createEmptyMeta('导入家族')
    const familyData = createEmptyFamily()
    mocks.runtimePlatform.mockResolvedValue('ios')
    mocks.importProjectBundle.mockResolvedValue({ project, meta })
    mocks.openProject.mockResolvedValue({ project, meta, family: familyData })

    const wrapper = mount(Welcome)
    await flushPromises()
    const importButton = wrapper.findAll('button')
      .find(button => button.text() === '导入家族备份')!
    await importButton.trigger('click')
    await flushPromises()

    expect(mocks.importProjectBundle).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.listManagedProjects).toHaveBeenCalledTimes(2)
    expect(mocks.openProject).toHaveBeenCalledWith(project)
    expect(useFamilyStore().projectRef).toEqual(project)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })

  it('keeps desktop folder actions on desktop runtimes', async () => {
    mocks.runtimePlatform.mockResolvedValue('macos')

    const wrapper = mount(Welcome)
    await flushPromises()

    expect(wrapper.text()).toContain('打开已有家族')
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
    expect(useUiStore().defaultLayoutMode).toBe('family-grid')
  })
})

describe('Welcome storage connections', () => {
  it('creates through the local provider using its display name and adopts the returned project reference', async () => {
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '新建家族')!.trigger('click')
    await flushPromises()

    expect(mocks.pickProject).toHaveBeenCalledWith('tauri-local', 'create')
    expect(mocks.createProject).toHaveBeenCalledWith(selected, selected.displayName)
    expect(family.projectRef).toEqual({ ...selected, id: 'created-project' })
    expect(mocks.startAutosave).toHaveBeenCalledOnce()
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })

  it('opens the reference returned by the provider picker', async () => {
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '打开已有家族')!.trigger('click')
    await flushPromises()

    expect(mocks.pickProject).toHaveBeenCalledWith('tauri-local', 'open')
    expect(mocks.openProject).toHaveBeenCalledWith(selected)
    expect(family.projectRef).toEqual(selected)
  })

  it.each(['新建家族', '打开已有家族'])('reports picker failures and restores the controls for %s', async (label) => {
    mocks.pickProject.mockRejectedValueOnce(new Error('无法访问存储位置'))
    const { wrapper } = await mountedWelcome()
    const button = wrapper.findAll('button').find(value => value.text() === label)!
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('无法访问存储位置')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(mocks.createProject).not.toHaveBeenCalled()
    expect(mocks.openProject).not.toHaveBeenCalled()
  })

  it.each(['新建家族', '打开已有家族'])('treats a cancelled picker as no change for %s', async (label) => {
    mocks.pickProject.mockResolvedValueOnce(null)
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()

    expect(family.projectRef).toBeNull()
    expect(wrapper.find('.border-rose-200').exists()).toBe(false)
    expect(mocks.startAutosave).not.toHaveBeenCalled()
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('treats a browser AbortError as a cancelled picker', async () => {
    mocks.pickProject.mockRejectedValueOnce(new DOMException('用户取消选择', 'AbortError'))
    const { wrapper } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '打开已有家族')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('用户取消选择')
    expect(mocks.openProject).not.toHaveBeenCalled()
  })

  it('preserves a recent reference after restore fails and allows a retry', async () => {
    const recent = { providerId: 'other-provider', id: 'opaque-remote-id', displayName: '最近的家族' }
    mocks.getLastProjectRef.mockReturnValue(recent)
    mocks.openProject.mockRejectedValueOnce(new Error('需要重新授权'))
    const { wrapper } = await mountedWelcome()
    await flushPromises()

    expect(wrapper.text()).toContain(recent.displayName)
    expect(wrapper.text()).toContain('需要重新授权')
    expect(mocks.setLastProjectRef).not.toHaveBeenCalled()

    mocks.openProject.mockResolvedValueOnce({
      project: recent, meta: createEmptyMeta(recent.displayName), family: createEmptyFamily(),
    })
    await wrapper.findAll('button').find(button => button.text() === recent.displayName)!.trigger('click')
    await flushPromises()
    expect(mocks.openProject).toHaveBeenNthCalledWith(2, recent)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
    expect(mocks.setLastProjectRef).not.toHaveBeenCalledWith(null)
  })

  it('clears a failed recent connection only when the user chooses to forget it', async () => {
    mocks.getLastProjectRef.mockReturnValue(selected)
    mocks.openProject.mockRejectedValueOnce(new Error('暂时离线'))
    const { wrapper } = await mountedWelcome()
    await flushPromises()
    await wrapper.get('button[title="清除记录"]').trigger('click')

    expect(mocks.setLastProjectRef).toHaveBeenCalledExactlyOnceWith(null)
    expect(wrapper.text()).not.toContain('最近：')
  })

  it.each([
    ['ios', managedProjectRef('managed-project'), true],
    ['android', externalProjectRef('/tmp/desktop.family'), false],
    ['macos', externalProjectRef('/tmp/desktop.family'), true],
    ['web', externalProjectRef('/tmp/desktop.family'), false],
    ['macos', managedProjectRef('managed-project'), false],
    ['web', { providerId: 'browser-directory', id: 'stored-handle-id', displayName: '网页目录' }, true],
    ['macos', { providerId: 'browser-directory', id: 'stored-handle-id', displayName: '网页目录' }, false],
    ['android', { providerId: 'browser-directory', id: 'stored-handle-id', displayName: '网页目录' }, false],
    ['ios', { providerId: 'cloud', id: 'remote-id', displayName: '云端家族' }, true],
    ['macos', { providerId: 'cloud', id: 'remote-id', displayName: '云端家族' }, true],
  ] as const)('restores only compatible recent storage on %s: %o', async (platform, recent, shouldRestore) => {
    mocks.runtimePlatform.mockResolvedValue(platform)
    mocks.getLastProjectRef.mockReturnValue(recent)
    mocks.openProject.mockResolvedValue({
      project: recent, meta: createEmptyMeta(recent.displayName), family: createEmptyFamily(),
    })

    const { wrapper } = await mountedWelcome()

    if (shouldRestore) {
      expect(mocks.openProject).toHaveBeenCalledExactlyOnceWith(recent)
      expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
    } else {
      expect(mocks.openProject).not.toHaveBeenCalled()
      expect(mocks.routerPush).not.toHaveBeenCalled()
    }
    expect(mocks.setLastProjectRef).not.toHaveBeenCalledWith(null)
    wrapper.unmount()
  })

  it('lets mobile users retry and forget a failed connection from another provider', async () => {
    const recent = { providerId: 'cloud', id: 'remote-id', displayName: '云端家族' }
    mocks.runtimePlatform.mockResolvedValue('ios')
    mocks.getLastProjectRef.mockReturnValue(recent)
    mocks.openProject.mockRejectedValue(new Error('需要重新授权'))
    const { wrapper } = await mountedWelcome()

    expect(wrapper.text()).toContain(recent.displayName)
    expect(wrapper.text()).toContain('需要重新授权')
    expect(mocks.setLastProjectRef).not.toHaveBeenCalled()

    await wrapper.findAll('button').find(button => button.text() === recent.displayName)!.trigger('click')
    await flushPromises()
    expect(mocks.openProject).toHaveBeenNthCalledWith(2, recent)

    await wrapper.get('button[title="清除记录"]').trigger('click')
    expect(mocks.setLastProjectRef).toHaveBeenCalledExactlyOnceWith(null)
    expect(wrapper.text()).not.toContain('最近：')
  })
})


describe('Welcome browser directory storage', () => {
  const browserProject = {
    providerId: 'browser-directory', id: 'browser-handle-id', displayName: '本地目录家族',
  }

  beforeEach(() => {
    mocks.runtimePlatform.mockResolvedValue('web')
    mocks.pickProject.mockResolvedValue(browserProject)
    mocks.createProject.mockResolvedValue({
      project: browserProject,
      meta: createEmptyMeta(browserProject.displayName),
      family: createEmptyFamily(),
    })
    mocks.openProject.mockResolvedValue({
      project: browserProject,
      meta: createEmptyMeta(browserProject.displayName),
      family: createEmptyFamily(),
    })
  })

  it.each([
    ['新建家族', 'create'],
    ['打开已有家族', 'open'],
  ] as const)('starts the directory picker directly from the click for %s', async (label, mode) => {
    const { wrapper, family } = await mountedWelcome()
    const runtimeCalls = mocks.runtimePlatform.mock.calls.length
    const button = wrapper.findAll('button').find(value => value.text() === label)!

    button.element.click()
    // 在同一个用户事件中调用选择器，不能先等待异步平台检测而丢失浏览器激活状态。
    expect(mocks.pickProject).toHaveBeenCalledExactlyOnceWith('browser-directory', mode)
    expect(mocks.runtimePlatform).toHaveBeenCalledTimes(runtimeCalls)
    await flushPromises()

    expect(family.projectRef).toEqual(browserProject)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
    expect(mocks.createManagedProject).not.toHaveBeenCalled()
    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('数据直接保存在你授权的本地目录')
    if (mode === 'create') {
      expect(mocks.createProject).toHaveBeenCalledWith(browserProject, browserProject.displayName)
    } else {
      expect(mocks.openProject).toHaveBeenCalledWith(browserProject)
    }
  })

  it.each([
    '当前浏览器不支持本地目录 API，请使用支持此功能的浏览器。',
    '本地目录需要安全连接，请使用 HTTPS 或 localhost 打开本站。',
    '请在独立页面中打开本站，嵌入页面无法访问本地目录。',
  ])('explains unavailable directory storage without invoking any provider: %s', async (reason) => {
    mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: false, reason })
    const { wrapper } = await mountedWelcome()

    expect(wrapper.get('[role="status"]').text()).toBe(reason)
    for (const label of ['新建家族', '打开已有家族']) {
      const button = wrapper.findAll('button').find(value => value.text() === label)!
      expect(button.attributes('disabled')).toBeDefined()
      await button.trigger('click')
    }
    expect(mocks.pickProject).not.toHaveBeenCalled()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
    expect(mocks.createManagedProject).not.toHaveBeenCalled()
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  })

  it('restores a previously authorized directory without prompting', async () => {
    mocks.getLastProjectRef.mockReturnValue(browserProject)
    const { family } = await mountedWelcome()

    expect(mocks.openProject).toHaveBeenCalledExactlyOnceWith(browserProject)
    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(mocks.pickProject).not.toHaveBeenCalled()
    expect(family.projectRef).toEqual(browserProject)
  })

  it('requests authorization only after the recent directory is clicked, then retries opening', async () => {
    mocks.getLastProjectRef.mockReturnValue(browserProject)
    mocks.openProject.mockRejectedValueOnce(new Error('请重新授权本地目录'))
    const { wrapper } = await mountedWelcome()

    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请重新授权本地目录')
    const button = wrapper.findAll('button').find(value => value.text() === browserProject.displayName)!
    button.element.click()
    expect(mocks.authorizeProject).toHaveBeenCalledExactlyOnceWith(browserProject)
    expect(mocks.openProject).toHaveBeenCalledTimes(1)
    await flushPromises()

    expect(mocks.openProject).toHaveBeenNthCalledWith(2, browserProject)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
    expect(mocks.setLastProjectRef).not.toHaveBeenCalledWith(null)
  })

  it('retains a recent directory when permission is denied and restores the retry control', async () => {
    mocks.getLastProjectRef.mockReturnValue(browserProject)
    mocks.openProject.mockRejectedValueOnce(new Error('请重新授权本地目录'))
    mocks.authorizeProject.mockRejectedValueOnce(new Error('未获得读写权限'))
    const { wrapper } = await mountedWelcome()
    const button = wrapper.findAll('button').find(value => value.text() === browserProject.displayName)!
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('未获得读写权限')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(mocks.openProject).toHaveBeenCalledTimes(1)
    expect(mocks.setLastProjectRef).not.toHaveBeenCalled()
  })

  it('keeps a recent directory visible but does not restore it in an unsupported browser', async () => {
    mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: false, reason: '需要 HTTPS' })
    mocks.getLastProjectRef.mockReturnValue(browserProject)
    const { wrapper } = await mountedWelcome()
    const button = wrapper.findAll('button').find(value => value.text() === browserProject.displayName)!

    expect(button.attributes('disabled')).toBeDefined()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(mocks.setLastProjectRef).not.toHaveBeenCalled()
    await wrapper.get('button[title="清除记录"]').trigger('click')
    expect(mocks.setLastProjectRef).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('chooses a backup file first and imports only from a second explicit click', async () => {
    const file = new File(['bundle'], '我的家族.familybundle')
    mocks.importProjectBundle.mockResolvedValue({
      project: browserProject, meta: createEmptyMeta(browserProject.displayName),
    })
    const { wrapper, family } = await mountedWelcome()
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    const openFilePicker = vi.spyOn(input.element, 'click').mockImplementation(() => {})
    wrapper.findAll('button').find(value => value.text() === '导入家族备份')!.element.click()
    expect(openFilePicker).toHaveBeenCalledOnce()
    expect(input.attributes('accept')).toBe('.familybundle')
    expect(mocks.importProjectBundle).not.toHaveBeenCalled()

    await selectBundleFile(wrapper, file)
    expect(wrapper.text()).toContain(file.name)
    expect(mocks.importProjectBundle).not.toHaveBeenCalled()
    expect(mocks.pickProject).not.toHaveBeenCalled()

    wrapper.findAll('button').find(value => value.text() === '选择空文件夹并导入')!.element.click()
    expect(mocks.importProjectBundle).toHaveBeenCalledExactlyOnceWith(file)
    await flushPromises()

    expect(mocks.openProject).toHaveBeenCalledWith(browserProject)
    expect(family.projectRef).toEqual(browserProject)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain(file.name)
    expect(wrapper.text()).not.toContain('选择空文件夹并导入')
  })

  it('can cancel a selected backup before choosing or writing a directory', async () => {
    const file = new File(['bundle'], 'cancel.familybundle')
    const { wrapper } = await mountedWelcome()
    await selectBundleFile(wrapper, file)
    await wrapper.findAll('button').find(value => value.text() === '取消导入')!.trigger('click')

    expect(wrapper.text()).not.toContain(file.name)
    expect(wrapper.text()).not.toContain('选择空文件夹并导入')
    expect(mocks.importProjectBundle).not.toHaveBeenCalled()
    expect(mocks.pickProject).not.toHaveBeenCalled()
    expect(mocks.openProject).not.toHaveBeenCalled()
  })

  it('retains the backup after cancelling either file replacement or directory selection', async () => {
    const file = new File(['bundle'], 'retained.familybundle')
    mocks.importProjectBundle.mockResolvedValue(null)
    const { wrapper } = await mountedWelcome()
    await selectBundleFile(wrapper, file)
    await selectBundleFile(wrapper, null)
    expect(wrapper.text()).toContain(file.name)
    const confirm = wrapper.findAll('button').find(value => value.text() === '选择空文件夹并导入')!
    await confirm.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(file.name)
    expect(confirm.attributes('disabled')).toBeUndefined()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(wrapper.find('.border-rose-200').exists()).toBe(false)
  })

  it('retains the selected backup after an import error and retries with the same file', async () => {
    const file = new File(['bundle'], 'retry.familybundle')
    mocks.importProjectBundle.mockRejectedValueOnce(new Error('请选择空文件夹'))
    mocks.importProjectBundle.mockResolvedValueOnce({
      project: browserProject, meta: createEmptyMeta(browserProject.displayName),
    })
    const { wrapper } = await mountedWelcome()
    await selectBundleFile(wrapper, file)
    const confirm = wrapper.findAll('button').find(value => value.text() === '选择空文件夹并导入')!
    await confirm.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('请选择空文件夹')
    expect(wrapper.text()).toContain(file.name)
    expect(confirm.attributes('disabled')).toBeUndefined()
    expect(mocks.openProject).not.toHaveBeenCalled()
    await confirm.trigger('click')
    await flushPromises()
    expect(mocks.importProjectBundle).toHaveBeenNthCalledWith(2, file)
    expect(mocks.openProject).toHaveBeenCalledWith(browserProject)
    expect(wrapper.text()).not.toContain(file.name)
  })

  it('prevents duplicate imports while a directory import is pending', async () => {
    let completeImport: (value: null) => void = () => {}
    mocks.importProjectBundle.mockReturnValue(new Promise<null>((resolve) => {
      completeImport = resolve
    }))
    const { wrapper } = await mountedWelcome()
    await selectBundleFile(wrapper, new File(['bundle'], 'pending.familybundle'))
    const confirm = wrapper.findAll('button').find(value => value.text() === '选择空文件夹并导入')!
    confirm.element.click()
    confirm.element.click()
    await wrapper.vm.$nextTick()

    expect(mocks.importProjectBundle).toHaveBeenCalledOnce()
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
    completeImport(null)
    await flushPromises()
    expect(confirm.attributes('disabled')).toBeUndefined()
  })

  it('uses focus-flow in a narrow browser without substituting native storage', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 1023px)',
    })))
    const { wrapper } = await mountedWelcome()

    expect(useUiStore().defaultLayoutMode).toBe('focus-flow')
    expect(wrapper.text()).toContain('打开已有家族')
    expect(wrapper.text()).toContain('导入家族备份')
    await wrapper.findAll('button').find(value => value.text() === '打开已有家族')!.trigger('click')
    await flushPromises()
    expect(mocks.pickProject).toHaveBeenCalledWith('browser-directory', 'open')
    expect(mocks.listManagedProjects).not.toHaveBeenCalled()
  })
})

async function mountedWelcome() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const wrapper = mount(Welcome, { global: { plugins: [pinia] } })
  await flushPromises()
  return { family, wrapper }
}

async function selectBundleFile(wrapper: VueWrapper, file: File | null) {
  const input = wrapper.get<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: file ? [file] : [], configurable: true,
  })
  await input.trigger('change')
}
