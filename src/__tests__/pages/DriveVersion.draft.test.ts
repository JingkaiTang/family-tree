// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import DriveStorageStatus from '@/components/DriveStorageStatus.vue'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import type { OpenResult } from '@/services/projectService'
import type { ProjectRef } from '@/services/storage/types'

const mocks = vi.hoisted(() => ({ select: vi.fn(), list: vi.fn(), accepted: vi.fn() }))
vi.mock('@/services/autosave', () => ({ flushNow: vi.fn(), startAutosave: vi.fn() }))
vi.mock('@/services/googleDriveConnection', () => ({
  googleDriveState: { ready: true, configured: true, busy: false, error: null },
  prepareGoogleDrive: vi.fn(),
  isGoogleDriveProvider: (id: string) => id.startsWith('google-drive:'),
  getGoogleDriveProjectAccess: vi.fn(),
  listGoogleDriveVersions: mocks.list,
  selectGoogleDriveVersion: async (project: ProjectRef, revisionId: string, accept: (result: OpenResult) => undefined) => {
    accept(await mocks.select(project, revisionId))
    mocks.accepted()
  },
  resolveGoogleDriveConflict: vi.fn(),
}))
vi.mock('@/services/storage', () => ({
  authorizeProject: vi.fn().mockResolvedValue(undefined),
  deletePhoto: vi.fn(),
}))
vi.mock('@/pages/Welcome.vue', () => ({ default: { template: '<div>欢迎页</div>' } }))
vi.mock('@/pages/TreeView.vue', () => ({ default: { template: '<div>家族树</div>' } }))

const mounted: VueWrapper[] = []
const project = { providerId: 'google-drive:account', id: 'a-family', displayName: '家族' }
function historicalProject() {
  const family = createEmptyFamily()
  family.members.a = mk('a', { firstName: '历史名字' })
  return { project, meta: createEmptyMeta('历史家族'), family }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.list.mockResolvedValue([{ id: 'old', createdTime: '历史版本', isHead: false }])
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const data = createEmptyFamily()
  data.members.a = mk('a', { firstName: '原名字' })
  data.members.b = mk('b')
  family.setProject(project, createEmptyMeta('家族'), data)
  useUiStore().setViewpoint('b')
  const router = createAppRouter(createMemoryHistory())
  await router.push('/member/a')
  const wrapper = mount({
    components: { DriveStorageStatus },
    template: '<RouterView /><DriveStorageStatus />',
  }, {
    global: {
      plugins: [pinia, router],
      stubs: { PhotoPicker: true, RelationEditor: true, SiblingOrderEditor: true },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return { family, router, wrapper }
}

function nameInput(wrapper: VueWrapper) {
  return wrapper.findAll('label')
    .find(label => label.find('span').exists() && label.find('span').text() === '名')!.get('input')
}

async function click(wrapper: VueWrapper, text: string) {
  await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click')
  await flushPromises()
}

it.each(['profile', 'override', 'media', 'reverted-profile', 'unmounted-editor'])(
  'keeps the current project when %s changes after confirming a historical version', async change => {
    const { family, router, wrapper } = await setup()
    const token = family.projectToken
    await click(wrapper, '查看历史与冲突版本')
    let finishRead!: (result: ReturnType<typeof historicalProject>) => void
    mocks.select.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    await click(wrapper, '历史版本')

    if (change === 'profile' || change === 'reverted-profile') {
      await nameInput(wrapper).setValue('确认切换之后才写的新资料')
      if (change === 'reverted-profile') await nameInput(wrapper).setValue('原名字')
    } else if (change === 'override') {
      await wrapper.get('input[placeholder="例如：二叔 / 表姨婆"]').setValue('新称呼')
    } else if (change === 'media') {
      wrapper.findComponent({ name: 'PhotoPicker' }).vm.$emit('pending', true)
      await flushPromises()
    } else {
      await router.push('/tree')
      await flushPromises()
    }
    expect(family.revision).toBe(0)

    finishRead(historicalProject())
    await flushPromises()

    expect(family.projectToken).toBe(token)
    expect(family.data.members.a.firstName).toBe('原名字')
    expect(router.currentRoute.value.path).toBe(change === 'unmounted-editor' ? '/tree' : '/member/a')
    expect(wrapper.text()).toContain('未切换版本')
    expect(mocks.accepted).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    if (change === 'profile') expect(nameInput(wrapper).element.value).toBe('确认切换之后才写的新资料')
    if (change === 'override') {
      expect(wrapper.get<HTMLInputElement>('input[placeholder="例如：二叔 / 表姨婆"]').element.value).toBe('新称呼')
    }
  },
)

it('allows discarding the already confirmed draft when no further edits occur', async () => {
  const { family, router, wrapper } = await setup()
  await nameInput(wrapper).setValue('明确放弃的旧草稿')
  await click(wrapper, '查看历史与冲突版本')
  mocks.select.mockResolvedValueOnce(historicalProject())

  await click(wrapper, '历史版本')

  expect(family.data.members.a.firstName).toBe('历史名字')
  expect(mocks.accepted).toHaveBeenCalledOnce()
  expect(router.currentRoute.value.path).toBe('/tree')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})
