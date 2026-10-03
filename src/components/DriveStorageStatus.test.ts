// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DriveStorageStatus from './DriveStorageStatus.vue'
import { useFamilyStore } from '@/stores/family'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'

const mocks = vi.hoisted(() => ({
  state: {
    configured: true, ready: true, busy: false, mediaEpoch: 0,
    error: null as string | null,
    providerId: 'google-drive:client:account',
    account: { permissionId: 'account', displayName: '我的账号' },
  },
  authorize: vi.fn(), prepare: vi.fn(), flush: vi.fn(), list: vi.fn(), select: vi.fn(), resolve: vi.fn(), push: vi.fn(),
}))
vi.mock('@/services/googleDriveConnection', async () => {
  const { reactive } = await import('vue')
  mocks.state = reactive(mocks.state)
  return {
    googleDriveState: mocks.state,
    prepareGoogleDrive: mocks.prepare,
    isGoogleDriveProvider: (id: string) => id.startsWith('google-drive:'),
    listGoogleDriveVersions: mocks.list,
    selectGoogleDriveVersion: mocks.select,
    resolveGoogleDriveConflict: mocks.resolve,
  }
})
vi.mock('@/services/storage', () => ({ authorizeProject: mocks.authorize }))
vi.mock('@/services/autosave', () => ({ flushNow: mocks.flush }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/services/prefs', () => ({
  getLayoutModePreference: () => 'auto', setLayoutModePreference: vi.fn(), setLastProjectRef: vi.fn(),
}))

const project = { providerId: 'google-drive:client:account', id: 'folder', displayName: '云端家族' }
const versions = [
  { id: 'head-a', createdTime: '2026-10-01', isHead: true },
  { id: 'head-b', createdTime: '2026-10-02', isHead: true },
  { id: 'old', createdTime: '2026-09-30', isHead: false },
]

beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(mocks.state, { ready: true, busy: false, error: null, mediaEpoch: 0 })
  setActivePinia(createPinia())
  useFamilyStore().setProject(project, createEmptyMeta('云端家族'), createEmptyFamily())
  mocks.authorize.mockResolvedValue(undefined)
  mocks.prepare.mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue(versions)
  mocks.resolve.mockResolvedValue(undefined)
  mocks.push.mockResolvedValue(undefined)
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find(value => value.text() === text)!
}

describe('Drive editing recovery', () => {
  it('does not display or authorize a local project', () => {
    useFamilyStore().setProject({ ...project, providerId: 'browser-directory' }, createEmptyMeta('本地'), createEmptyFamily())
    const wrapper = mount(DriveStorageStatus)
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(mocks.authorize).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps a persistent authorization failure visible and retries only from a click', async () => {
    const family = useFamilyStore()
    family.markDirty()
    mocks.state.error = 'Google 授权已过期，当前修改尚未保存'
    const wrapper = mount(DriveStorageStatus)
    expect(wrapper.get('[role="alert"]').text()).toContain('授权已过期')
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    expect(mocks.authorize).not.toHaveBeenCalled()
    button(wrapper, '重新连接并保存').element.click()
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(project)
    await flushPromises()
    expect(mocks.flush).toHaveBeenCalledOnce()
    // The UI itself must not clear dirty state before the real save controller does.
    expect(family.isDirty).toBe(true)
    wrapper.unmount()
  })

  it('preserves the editing session when the wrong Google account is selected', async () => {
    const family = useFamilyStore()
    family.markDirty()
    const token = family.projectToken
    mocks.authorize.mockRejectedValue(new Error('请连接原来的 Google 账号'))
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '重新连接并保存').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请连接原来的 Google 账号')
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(family.projectRef).toEqual(project)
    expect(family.projectToken).toBe(token)
    expect(family.isDirty).toBe(true)
    wrapper.unmount()
  })

  it('allows a failed OAuth script to retry without implicitly authorizing', async () => {
    mocks.state.ready = false
    mocks.state.error = 'Google 授权加载失败'
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '重试加载 Google 授权').trigger('click')
    await flushPromises()
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('requires confirmation and submits the exact observed heads to resolve a conflict', async () => {
    const family = useFamilyStore()
    family.markDirty()
    mocks.flush.mockRejectedValue(Object.assign(new Error('存在多个版本'), { name: 'GoogleDriveConflictError' }))
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '查看历史与冲突版本').trigger('click')
    await flushPromises()
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await button(wrapper, '以当前内容解决冲突').trigger('click')
    await flushPromises()
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(family.isDirty).toBe(true)
    await button(wrapper, '以当前内容解决冲突').trigger('click')
    await flushPromises()
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(project, family.data, ['head-a', 'head-b'])
    expect(family.isDirty).toBe(false)
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('不会自动合并'))
    wrapper.unmount()
  })

  it('does not mark newer edits saved while conflict resolution is uploading', async () => {
    const family = useFamilyStore()
    family.markDirty()
    let complete!: () => void
    mocks.resolve.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '查看历史与冲突版本').trigger('click')
    await flushPromises()
    await button(wrapper, '以当前内容解决冲突').trigger('click')
    await flushPromises()
    family.markDirty()
    complete()
    await flushPromises()
    expect(family.isDirty).toBe(true)
    wrapper.unmount()
  })

  it('does not attempt conflict resolution when the pending save failed for a network reason', async () => {
    mocks.flush.mockRejectedValue(new Error('网络中断'))
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '查看历史与冲突版本').trigger('click')
    await flushPromises()
    await button(wrapper, '以当前内容解决冲突').trigger('click')
    await flushPromises()
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('网络中断')
    wrapper.unmount()
  })

  it('opens historical content only after explicit confirmation', async () => {
    const family = useFamilyStore()
    family.markDirty()
    mocks.select.mockResolvedValue({ project, meta: createEmptyMeta('历史家族'), family: createEmptyFamily() })
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '查看历史与冲突版本').trigger('click')
    await flushPromises()
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await button(wrapper, '2026-09-30').trigger('click')
    expect(mocks.select).not.toHaveBeenCalled()
    expect(family.isDirty).toBe(true)
    await button(wrapper, '2026-09-30').trigger('click')
    await flushPromises()
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(project, 'old')
    expect(family.projectMeta?.name).toBe('历史家族')
    expect(mocks.push).toHaveBeenCalledWith('/tree')
    wrapper.unmount()
  })

  it('retains edits made while a historical version is loading', async () => {
    const family = useFamilyStore()
    let complete!: (result: { project: typeof project; meta: ReturnType<typeof createEmptyMeta>; family: ReturnType<typeof createEmptyFamily> }) => void
    mocks.select.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '查看历史与冲突版本').trigger('click')
    await flushPromises()
    await button(wrapper, '2026-09-30').trigger('click')
    await flushPromises()
    family.markDirty()
    complete({ project, meta: createEmptyMeta('历史家族'), family: createEmptyFamily() })
    await flushPromises()
    expect(family.projectMeta?.name).toBe('云端家族')
    expect(family.isDirty).toBe(true)
    expect(wrapper.text()).toContain('读取版本期间又产生了修改')
    wrapper.unmount()
  })

  it('prepares a downloadable JSON snapshot offline without authorizing or saving', async () => {
    mocks.state.error = '离线'
    useFamilyStore().markDirty()
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const wrapper = mount(DriveStorageStatus)
    await button(wrapper, '生成草稿 JSON（不含照片）').trigger('click')
    expect(wrapper.get('a').attributes('href')).toBe('blob:rescue')
    expect(wrapper.get('a').attributes('download')).toBe('云端家族-草稿.json')
    const blob = createUrl.mock.calls[0]![0] as Blob
    const contents = JSON.parse(await blob.text())
    expect(contents).toEqual({ draftVersion: 1, meta: useFamilyStore().projectMeta, family: useFamilyStore().data })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(useFamilyStore().isDirty).toBe(true)
    wrapper.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:rescue')
  })
})
