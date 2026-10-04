/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { createEmptyFamily, createEmptyMeta, type Member } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'

const mocks = vi.hoisted(() => ({ flushNow: vi.fn(), deletePhoto: vi.fn() }))
vi.mock('@/services/autosave', () => ({ flushNow: mocks.flushNow }))
vi.mock('@/services/storage', () => ({ deletePhoto: mocks.deletePhoto }))
vi.mock('@/pages/Welcome.vue', () => ({ default: { template: '<div>欢迎页</div>' } }))
vi.mock('@/pages/TreeView.vue', () => ({ default: { template: '<div>家族树</div>' } }))

const project = { providerId: 'test-storage', id: 'draft-project', displayName: '测试家族' }
const mounted: VueWrapper[] = []

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocks.flushNow.mockImplementation(async () => { useFamilyStore().markClean() })
  mocks.deletePhoto.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('MemberDetail profile drafts', () => {
  it('shows an unsaved profile without reporting the clean project as saved', async () => {
    const { family, wrapper } = await mountedMember()
    expect(wrapper.get('header').text()).toContain('已保存')

    await inputFor(wrapper, '名').setValue('草稿名字')

    expect(wrapper.get('header').text()).toContain('未保存')
    expect(wrapper.get('header').text()).not.toContain('已保存')
    expect(family.data.members.a.firstName).toBe('原名字')
    expect(family.isDirty).toBe(false)
    expect(mocks.flushNow).not.toHaveBeenCalled()
  })

  it('guards Back with save, discard, and keep-editing choices, preserving the draft until discarded', async () => {
    const { family, router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('待确认修改')
    await clickButton(wrapper, '返回')

    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(wrapper.get('dialog[open], [role="dialog"]').text()).toContain('有未保存修改')
    expect(wrapper.get('dialog[open], [role="dialog"]').findAll('button').map(button => button.text()))
      .toEqual(expect.arrayContaining(['保存并离开', '放弃修改', '继续编辑']))
    await clickButton(wrapper, '继续编辑')
    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(wrapper.find('dialog[open], [role="dialog"]').exists()).toBe(false)
    expect(inputFor(wrapper, '名').element.value).toBe('待确认修改')

    await clickButton(wrapper, '返回')
    await clickButton(wrapper, '放弃修改')

    expect(router.currentRoute.value.path).toBe('/tree')
    expect(family.data.members.a.firstName).toBe('原名字')
    expect(mocks.flushNow).not.toHaveBeenCalled()
  })

  it('waits for profile persistence before completing Save and leave', async () => {
    const { family, router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('确认保存')
    const saved = deferred()
    mocks.flushNow.mockImplementationOnce(async () => {
      await saved.promise
      family.markClean()
    })
    const leaving = router.push('/tree')
    await flushPromises()
    await clickButton(wrapper, '保存并离开')

    expect(mocks.flushNow).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(family.data.members.a.firstName).toBe('确认保存')
    saved.resolve()
    await leaving
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/tree')
    expect(family.isDirty).toBe(false)
  })

  it('keeps the route and edited inputs when Save and leave fails', async () => {
    const { router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('不能丢失的输入')
    mocks.flushNow.mockRejectedValueOnce(new Error('磁盘已满'))
    void router.push('/tree')
    await flushPromises()
    await clickButton(wrapper, '保存并离开')

    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(inputFor(wrapper, '名').element.value).toBe('不能丢失的输入')
    expect(wrapper.get('header').text()).not.toContain('已保存')
    expect(wrapper.text()).toContain('磁盘已满')
  })

  it('continues protecting a failed profile save from refresh and a later navigation attempt', async () => {
    const { router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('保存失败后仍要保护')
    mocks.flushNow.mockRejectedValueOnce(new Error('离线'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const refreshing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refreshing)
    expect(refreshing.defaultPrevented).toBe(true)
    const leaving = router.push('/tree')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/member/a')
    expect(wrapper.get('dialog[open], [role="dialog"]').text()).toContain('有未保存修改')
    await clickButton(wrapper, '继续编辑')
    await leaving
    expect(inputFor(wrapper, '名').element.value).toBe('保存失败后仍要保护')
  })

  it('warns on browser unload only while the local profile is unsaved', async () => {
    const { wrapper } = await mountedMember()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await inputFor(wrapper, '名').setValue('刷新前的草稿')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const saved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(saved)
    expect(saved.defaultPrevented).toBe(false)
  })

  it('recognizes a successful external save retry without losing edits made after the failed submission', async () => {
    const { family, wrapper } = await mountedMember()
    mocks.flushNow.mockRejectedValueOnce(new Error('授权过期'))
    await inputFor(wrapper, '名').setValue('已提交的名字')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await inputFor(wrapper, '名').setValue('重连期间的新输入')

    // The Drive reconnect action saves the current store snapshot independently.
    family.markSaved(family.projectToken, family.revision)
    await flushPromises()
    expect(inputFor(wrapper, '名').element.value).toBe('重连期间的新输入')
    expect(wrapper.get('header').text()).toContain('资料未保存')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)

    await inputFor(wrapper, '名').setValue('已提交的名字')
    expect(wrapper.get('header').text()).toContain('已保存')
    const refreshing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refreshing)
    expect(refreshing.defaultPrevented).toBe(false)
  })

  it('guards member-parameter changes and initializes the next member only after discarding', async () => {
    const { family, router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('第一位的草稿')
    const firstAttempt = router.push('/member/b')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/member/a')
    await clickButton(wrapper, '继续编辑')
    await firstAttempt
    expect(inputFor(wrapper, '名').element.value).toBe('第一位的草稿')

    const nextAttempt = router.push('/member/b')
    await flushPromises()
    await clickButton(wrapper, '放弃修改')
    await nextAttempt
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/member/b')
    expect(inputFor(wrapper, '名').element.value).toBe('第二位')
    expect(family.data.members.a.firstName).toBe('原名字')
    expect(wrapper.get('header').text()).toContain('已保存')
  })

  it('creates the first new member and root only after the draft is saved, without duplicate creation', async () => {
    const { family, router, wrapper } = await mountedMember('/members/new', [])

    expect(router.currentRoute.value.name).toBe('member-new')
    expect(inputFor(wrapper, '名').element.value).toBe('新成员')
    expect(inputFor(wrapper, '姓').element.value).toBe('')
    expect(family.memberCount).toBe(0)
    expect(family.isDirty).toBe(false)
    expect(wrapper.get('header').text()).not.toContain('已保存')
    await inputFor(wrapper, '名').setValue('第一位成员')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(family.memberCount).toBe(1)
    const created = family.membersArray[0]
    expect(created.firstName).toBe('第一位成员')
    expect(family.data.rootMemberId).toBe(created.id)
    expect(router.currentRoute.value.name).toBe('member')
    expect(router.currentRoute.value.params.id).toBe(created.id)
    expect(mocks.flushNow).toHaveBeenCalledOnce()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(family.memberCount).toBe(1)
  })

  it('explicit Cancel discards a new draft without creating or saving a member or asking again', async () => {
    const { family, router, wrapper } = await mountedMember('/members/new', [])
    await inputFor(wrapper, '名').setValue('决定不添加')
    await clickButton(wrapper, '取消')

    expect(router.currentRoute.value.path).toBe('/tree')
    expect(wrapper.find('dialog[open], [role="dialog"]').exists()).toBe(false)
    expect(family.memberCount).toBe(0)
    expect(family.data.rootMemberId).toBeUndefined()
    expect(family.isDirty).toBe(false)
    expect(mocks.flushNow).not.toHaveBeenCalled()
  })

  it('keeps profile guard independent from a relationship that was saved immediately', async () => {
    const { family, router, wrapper } = await mountedMember()
    await inputFor(wrapper, '名').setValue('尚未提交的资料')
    family.linkRelation('a', 'b', 'parent')
    family.markClean()
    await flushPromises()
    expect(inputFor(wrapper, '名').element.value).toBe('尚未提交的资料')
    expect(wrapper.get('header').text()).not.toContain('已保存')

    const leaving = router.push('/tree')
    await flushPromises()
    await clickButton(wrapper, '放弃修改')
    await leaving

    expect(family.data.members.a.firstName).toBe('原名字')
    expect(family.data.members.a.parents).toEqual([{ id: 'b', type: 'blood' }])
    expect(family.data.members.b.children).toEqual([{ id: 'a', type: 'blood' }])
  })

  it('does not let an old project save reset or unlock a newer project draft and save', async () => {
    const { family, router, wrapper } = await mountedMember()
    const oldSave = deferred()
    const newSave = deferred()
    mocks.flushNow.mockReturnValueOnce(oldSave.promise)
    mocks.flushNow.mockImplementationOnce(async () => {
      await newSave.promise
      family.markClean()
    })
    await inputFor(wrapper, '名').setValue('旧项目保存中的名字')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const newProject = createEmptyFamily()
    newProject.members.a = mk('a', { firstName: '新项目原名字' })
    family.setProject({ ...project, id: 'next-project' }, createEmptyMeta('下一项目'), newProject)
    await flushPromises()
    expect(inputFor(wrapper, '名').element.value).toBe('新项目原名字')
    await inputFor(wrapper, '名').setValue('新项目独立草稿')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.flushNow).toHaveBeenCalledTimes(2)

    oldSave.resolve()
    await flushPromises()
    expect(inputFor(wrapper, '名').element.value).toBe('新项目独立草稿')
    expect(wrapper.get('header').text()).toContain('保存中')
    await wrapper.get('form').trigger('submit')
    await router.push('/tree')
    expect(mocks.flushNow).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe('/member/a')

    newSave.resolve()
    await flushPromises()
    expect(wrapper.get('header').text()).toContain('已保存')
    expect(family.data.members.a.firstName).toBe('新项目独立草稿')
    expect(family.projectRef?.id).toBe('next-project')
  })
})

async function mountedMember(
  path = '/member/a',
  members: Member[] = [mk('a', { firstName: '原名字' }), mk('b', { firstName: '第二位' })],
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const data = createEmptyFamily()
  data.members = Object.fromEntries(members.map(member => [member.id, member]))
  family.setProject(project, createEmptyMeta('测试'), data)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/tree')
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, {
    global: {
      plugins: [pinia, router],
      stubs: { PhotoPicker: true, RelationEditor: true, SiblingOrderEditor: true },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return { family, router, wrapper }
}

function inputFor(wrapper: VueWrapper, label: string) {
  const field = wrapper.findAll('label').find(value => value.find('span').text() === label)
  if (!field) throw new Error(`Missing visible form label: ${label}`)
  return field.get<HTMLInputElement>('input')
}

async function clickButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find(value => value.text() === text)
  if (!button) throw new Error(`Missing visible button: ${text}`)
  await button.trigger('click')
  await flushPromises()
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
