/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Welcome from '@/pages/Welcome.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'

const mocks = vi.hoisted(() => ({
  pickProject: vi.fn(),
  authorizeProject: vi.fn(),
  getDirectoryStorageAvailability: vi.fn(),
  hasProvider: vi.fn(),
  getLastProjectRef: vi.fn(),
  setLastProjectRef: vi.fn(),
  createProject: vi.fn(),
  openProject: vi.fn(),
  importProjectBundle: vi.fn(),
  routerPush: vi.fn(),
  startAutosave: vi.fn(),
  driveState: {
    configured: false, ready: false, busy: false, mediaEpoch: 0,
    error: null as string | null,
    providerId: null as string | null,
    account: null as { permissionId: string; displayName: string; emailAddress?: string } | null,
  },
  prepareGoogleDrive: vi.fn(),
  connectGoogleDrive: vi.fn(),
  disconnectGoogleDrive: vi.fn(),
  listGoogleDriveProjects: vi.fn(),
  isGoogleDriveProvider: vi.fn(),
  listGoogleDriveVersions: vi.fn(),
  selectGoogleDriveVersion: vi.fn(),
}))

vi.mock('@/services/googleDriveConnection', async () => {
  const { reactive } = await import('vue')
  mocks.driveState = reactive(mocks.driveState)
  return {
    googleDriveState: mocks.driveState,
    prepareGoogleDrive: mocks.prepareGoogleDrive,
    connectGoogleDrive: mocks.connectGoogleDrive,
    disconnectGoogleDrive: mocks.disconnectGoogleDrive,
    listGoogleDriveProjects: mocks.listGoogleDriveProjects,
    isGoogleDriveProvider: mocks.isGoogleDriveProvider,
    listGoogleDriveVersions: mocks.listGoogleDriveVersions,
    selectGoogleDriveVersion: mocks.selectGoogleDriveVersion,
  }
})

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))
vi.mock('@/services/projectService', () => ({
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
  hasProvider: mocks.hasProvider,
}))

const selected = { providerId: 'browser-directory', id: 'opaque-handle-id', displayName: '家族显示名' }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  Object.assign(mocks.driveState, { configured: false, ready: false, busy: false, mediaEpoch: 0, error: null, providerId: null, account: null })
  mocks.prepareGoogleDrive.mockResolvedValue(undefined)
  mocks.isGoogleDriveProvider.mockImplementation((id: string) => id.startsWith('google-drive:'))
  mocks.listGoogleDriveProjects.mockResolvedValue([])
  mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: true, reason: null })
  mocks.hasProvider.mockImplementation((id: string) => ['browser-directory', 'test-cloud'].includes(id))
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
})

describe('Welcome Google Drive connections', () => {
  const driveProject = { providerId: 'google-drive:client:account', id: 'drive-folder', displayName: '云端家族' }
  beforeEach(() => {
    Object.assign(mocks.driveState, { configured: true, ready: true })
    mocks.connectGoogleDrive.mockImplementation(async () => {
      mocks.driveState.providerId = driveProject.providerId
      mocks.driveState.account = { permissionId: 'account', displayName: '我的账号', emailAddress: 'me@example.test' }
      return driveProject.providerId
    })
    mocks.listGoogleDriveProjects.mockResolvedValue([driveProject])
    mocks.openProject.mockResolvedValue({ project: driveProject, meta: createEmptyMeta('云端家族'), family: createEmptyFamily() })
  })

  it('connects directly from a user click and opens projects without a local directory API', async () => {
    mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: false, reason: '不支持目录 API' })
    const { wrapper, family } = await mountedWelcome()
    expect(mocks.connectGoogleDrive).not.toHaveBeenCalled()
    wrapper.findAll('button').find(button => button.text() === '连接 Google Drive')!.element.click()
    expect(mocks.connectGoogleDrive).toHaveBeenCalledOnce()
    await flushPromises()
    expect(wrapper.text()).toContain('me@example.test')
    expect(mocks.listGoogleDriveProjects).toHaveBeenCalledWith(driveProject.providerId)
    await wrapper.findAll('button').find(button => button.text() === '云端家族')!.trigger('click')
    await flushPromises()
    expect(family.projectRef).toEqual(driveProject)
    expect(mocks.pickProject).not.toHaveBeenCalled()
  })

  it('creates a named project in the connected account and adopts the returned folder ID', async () => {
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '连接 Google Drive')!.trigger('click')
    await flushPromises()
    mocks.createProject.mockResolvedValue({ project: driveProject, meta: createEmptyMeta('我的家谱'), family: createEmptyFamily() })
    await wrapper.get('input[aria-label="Google Drive 家族名称"]').setValue(' 我的家谱 ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.createProject).toHaveBeenCalledWith({ providerId: driveProject.providerId, id: 'root', displayName: '我的家谱' }, '我的家谱')
    expect(family.projectRef).toEqual(driveProject)
  })

  it('retains an unconnected recent Drive project without opening an authorization popup on mount', async () => {
    mocks.getLastProjectRef.mockReturnValue(driveProject)
    const { wrapper } = await mountedWelcome()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(mocks.connectGoogleDrive).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === driveProject.displayName)!.trigger('click')
    await flushPromises()
    expect(mocks.authorizeProject).toHaveBeenCalledExactlyOnceWith(driveProject)
    expect(mocks.openProject).toHaveBeenCalledExactlyOnceWith(driveProject)
  })

  it('keeps local actions available while the OAuth script is not ready', async () => {
    mocks.driveState.ready = false
    const { wrapper } = await mountedWelcome()
    expect(wrapper.findAll('button').find(button => button.text() === '连接 Google Drive')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === '打开已有家族')!.attributes('disabled')).toBeUndefined()
  })

  it('retries a failed authorization script without opening OAuth until a separate connect click', async () => {
    mocks.driveState.ready = false
    mocks.prepareGoogleDrive.mockImplementationOnce(async () => {
      mocks.driveState.error = 'Google 授权加载失败'
      throw new Error('Google 授权加载失败')
    }).mockImplementationOnce(async () => {
      mocks.driveState.ready = true
      mocks.driveState.error = null
    })
    const { wrapper } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '重试加载 Google 授权')!.trigger('click')
    await flushPromises()
    expect(mocks.prepareGoogleDrive).toHaveBeenCalledTimes(2)
    expect(mocks.connectGoogleDrive).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').find(button => button.text() === '连接 Google Drive')!.attributes('disabled')).toBeUndefined()
  })

  it('offers retained conflict versions instead of trapping an unopened project', async () => {
    const conflict = Object.assign(new Error('存在多个远端分支'), { name: 'GoogleDriveConflictError', heads: ['a', 'b'] })
    mocks.getLastProjectRef.mockReturnValue(driveProject)
    mocks.openProject.mockRejectedValue(conflict)
    mocks.listGoogleDriveVersions.mockResolvedValue([{ id: 'a', createdTime: '2026-10-01', isHead: true }, { id: 'b', createdTime: '2026-10-02', isHead: true }])
    mocks.selectGoogleDriveVersion.mockResolvedValue({ project: driveProject, meta: createEmptyMeta('云端家族'), family: createEmptyFamily() })
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === driveProject.displayName)!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('此家族存在多个版本')
    await wrapper.findAll('button').find(button => button.text() === '2026-10-02（当前分支）')!.trigger('click')
    await flushPromises()
    expect(mocks.selectGoogleDriveVersion).toHaveBeenCalledWith(driveProject, 'b')
    expect(family.projectRef).toEqual(driveProject)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Welcome storage connections', () => {
  it('creates through the local provider using its display name and adopts the returned project reference', async () => {
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '新建家族')!.trigger('click')
    await flushPromises()

    expect(mocks.pickProject).toHaveBeenCalledWith('browser-directory', 'create')
    expect(mocks.createProject).toHaveBeenCalledWith(selected, selected.displayName)
    expect(family.projectRef).toEqual({ ...selected, id: 'created-project' })
    expect(mocks.startAutosave).toHaveBeenCalledOnce()
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })

  it('opens the reference returned by the provider picker', async () => {
    const { wrapper, family } = await mountedWelcome()
    await wrapper.findAll('button').find(button => button.text() === '打开已有家族')!.trigger('click')
    await flushPromises()

    expect(mocks.pickProject).toHaveBeenCalledWith('browser-directory', 'open')
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
    const recent = { providerId: 'test-cloud', id: 'opaque-remote-id', displayName: '最近的家族' }
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

  it('ignores recent storage that no longer has a registered provider', async () => {
    mocks.getLastProjectRef.mockReturnValue({
      providerId: 'removed-provider', id: 'old-project', displayName: '旧项目',
    })
    const { wrapper } = await mountedWelcome()

    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.authorizeProject).not.toHaveBeenCalled()
    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('最近：')
    expect(mocks.setLastProjectRef).not.toHaveBeenCalled()
  })

  it('restores an independently registered provider when directory storage is unavailable', async () => {
    const recent = { providerId: 'test-cloud', id: 'remote-id', displayName: '云端家族' }
    mocks.getLastProjectRef.mockReturnValue(recent)
    mocks.getDirectoryStorageAvailability.mockReturnValue({ supported: false, reason: '需要目录 API' })
    mocks.openProject.mockResolvedValue({
      project: recent, meta: createEmptyMeta(recent.displayName), family: createEmptyFamily(),
    })
    await mountedWelcome()

    expect(mocks.openProject).toHaveBeenCalledExactlyOnceWith(recent)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
  })

  it('lets users retry and forget a failed connection from another registered provider', async () => {
    const recent = { providerId: 'test-cloud', id: 'remote-id', displayName: '云端家族' }
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
    const button = wrapper.findAll('button').find(value => value.text() === label)!

    button.element.click()
    // 在同一个用户事件中调用选择器，不能先等待异步操作而丢失浏览器激活状态。
    expect(mocks.pickProject).toHaveBeenCalledExactlyOnceWith('browser-directory', mode)
    await flushPromises()

    expect(family.projectRef).toEqual(browserProject)
    expect(mocks.routerPush).toHaveBeenCalledWith('/tree')
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

  it('uses the original mobile layout and browser directory storage on a touch phone', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' || query === '(max-width: 1023px)',
    })))
    const { wrapper } = await mountedWelcome()

    expect(useUiStore().defaultLayoutMode).toBe('focus-flow')
    expect(wrapper.text()).toContain('打开已有家族')
    expect(wrapper.text()).toContain('导入家族备份')
    await wrapper.findAll('button').find(value => value.text() === '打开已有家族')!.trigger('click')
    await flushPromises()
    expect(mocks.pickProject).toHaveBeenCalledWith('browser-directory', 'open')
  })

  it('keeps the original desktop layout in a narrow desktop browser', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 1023px)',
    })))
    await mountedWelcome()

    expect(useUiStore().defaultLayoutMode).toBe('family-grid')
    expect(useUiStore().resolvedLayoutMode).toBe('family-grid')
  })

  it('keeps the original mobile layout when a phone opens in landscape', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Mobile')
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)',
    })))
    await mountedWelcome()

    expect(useUiStore().defaultLayoutMode).toBe('focus-flow')
    expect(useUiStore().resolvedLayoutMode).toBe('focus-flow')
  })

  it('does not change a session default or explicit choice when reopening Welcome after resizing', async () => {
    const matchMedia = vi.fn(() => ({ matches: false }))
    vi.stubGlobal('matchMedia', matchMedia)
    const pinia = createPinia()
    const firstWelcome = mount(Welcome, { global: { plugins: [pinia] } })
    await flushPromises()
    const ui = useUiStore(pinia)
    expect(ui.defaultLayoutMode).toBe('family-grid')

    ui.setLayoutModePreference('focus-flow')
    firstWelcome.unmount()
    matchMedia.mockImplementation(() => ({ matches: true }))
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
    const nextWelcome = mount(Welcome, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(ui.defaultLayoutMode).toBe('family-grid')
    expect(ui.resolvedLayoutMode).toBe('focus-flow')
    ui.setLayoutModePreference('auto')
    expect(ui.resolvedLayoutMode).toBe('family-grid')
    nextWelcome.unmount()
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
