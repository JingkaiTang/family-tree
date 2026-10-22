/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RelationEditor from '@/components/member/RelationEditor.vue'
import { useFamilyStore } from '@/stores/family'
import { addParent, addSpouse, mk } from '@/__tests__/fixtures/families'

describe('RelationEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stores child primary layout assignment', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const child = mk('child')
    const parent = mk('parent')
    addParent(child, parent)
    family.$patch((state) => {
      state.data.members = { child, parent }
    })

    const wrapper = mount(RelationEditor, {
      props: { memberId: 'child' },
      global: { plugins: [pinia] },
    })

    const select = wrapper.find('[data-testid="child-layout-assignment"]')
    await select.setValue('parent')

    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
    })
  })

  it('keeps a single parent named a+b distinct from the a and b couple', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const child = mk('child')
    const joined = mk('a+b', { firstName: '单独父母' })
    const a = mk('a', { firstName: '父母甲' })
    const b = mk('b', { firstName: '配偶乙' })
    addParent(child, joined)
    addParent(child, a)
    addSpouse(a, b)
    family.$patch(state => {
      state.data.members = Object.fromEntries([child, joined, a, b].map(value => [value.id, value]))
    })
    const wrapper = mount(RelationEditor, {
      props: { memberId: 'child' },
      global: { plugins: [pinia] },
    })
    const select = wrapper.get<HTMLSelectElement>('[data-testid="child-layout-assignment"]')
    const single = select.findAll('option').find(option => option.text() === '单独父母')!
    const couple = select.findAll('option').find(option => option.text() === '父母甲 + 配偶乙')!

    expect(single.element.value).not.toBe(couple.element.value)
    await select.setValue(single.element.value)
    expect(family.data.childLayoutAssignments.child).toEqual({ primaryParentId: 'a+b' })
    await select.setValue(couple.element.value)
    expect(family.data.childLayoutAssignments.child).toEqual({ primaryParentId: 'a', primarySpouseId: 'b' })
    await select.setValue('')
    expect(family.data.childLayoutAssignments.child).toBeUndefined()
    wrapper.unmount()
  })

  it.each([
    ['parent+part', 'spouse+part'],
    ['parent%2b', 'spouse|part'],
    ['父母:一', '配偶:二'],
  ])('round-trips parent %s and spouse %s and restores the selected assignment', async (parentId, spouseId) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const child = mk('child')
    const parent = mk(parentId, { firstName: '父母' })
    const spouse = mk(spouseId, { firstName: '配偶' })
    addParent(child, parent)
    addSpouse(parent, spouse)
    family.$patch(state => {
      state.data.members = Object.fromEntries([child, parent, spouse].map(value => [value.id, value]))
      state.data.childLayoutAssignments.child = { primaryParentId: parentId, primarySpouseId: spouseId }
    })
    const wrapper = mount(RelationEditor, {
      props: { memberId: 'child' },
      global: { plugins: [pinia] },
    })
    const select = wrapper.get<HTMLSelectElement>('[data-testid="child-layout-assignment"]')
    const single = select.findAll('option').find(option => option.text() === '父母')!
    const couple = select.findAll('option').find(option => option.text() === '父母 + 配偶')!

    expect(select.element.selectedOptions[0].textContent).toBe('父母 + 配偶')
    await select.setValue(single.element.value)
    expect(family.data.childLayoutAssignments.child).toEqual({ primaryParentId: parentId })
    await select.setValue(couple.element.value)
    expect(family.data.childLayoutAssignments.child).toEqual({ primaryParentId: parentId, primarySpouseId: spouseId })
    expect(select.element.selectedOptions[0].textContent).toBe('父母 + 配偶')
    wrapper.unmount()
  })

  it.each(['parent+spouse+extra', 'parent%', 'parent%ZZ', 'missing'])('ignores invalid or unavailable layout selection %s', async invalidValue => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const child = mk('child')
    const parent = mk('parent')
    const spouse = mk('spouse')
    const extra = mk('extra')
    addParent(child, parent)
    addSpouse(parent, spouse)
    family.$patch(state => {
      state.data.members = { child, parent, spouse, extra }
      state.data.childLayoutAssignments.child = { primaryParentId: 'parent' }
    })
    const before = JSON.stringify(family.data)
    const revision = family.revision
    const wrapper = mount(RelationEditor, {
      props: { memberId: 'child' },
      global: { plugins: [pinia] },
    })
    const select = wrapper.get<HTMLSelectElement>('[data-testid="child-layout-assignment"]')
    const invalidOption = document.createElement('option')
    invalidOption.value = invalidValue
    select.element.append(invalidOption)

    await select.setValue(invalidValue)

    expect(JSON.stringify(family.data)).toBe(before)
    expect(family.revision).toBe(revision)
    expect(family.isDirty).toBe(false)
    wrapper.unmount()
  })

  it('confirms before replacing a current spouse', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mount(RelationEditor, {
      props: { memberId: 'a' },
      global: { plugins: [pinia] },
    })

    await wrapper.find('select').setValue('spouse')
    const selects = wrapper.findAll('select')
    await selects[1].setValue('c')
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1].trigger('click')

    expect(confirm).toHaveBeenCalled()
    expect(family.data.members.a.spouses).toEqual([{ id: 'c', type: 'married' }])
  })

  it('shows an ancestry error without changing the family and lets the user choose another parent', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ancestor = mk('ancestor')
    const descendant = mk('descendant')
    const unrelated = mk('unrelated')
    addParent(descendant, ancestor)
    family.$patch(state => {
      state.data.members = { ancestor, descendant, unrelated }
    })
    const before = JSON.stringify(family.data)
    const revision = family.revision
    const wrapper = mount(RelationEditor, {
      props: { memberId: 'ancestor' },
      global: { plugins: [pinia] },
    })
    const targetSelect = wrapper.findAll('select')[1]
    await targetSelect.setValue('descendant')
    const add = wrapper.findAll('button').find(button => button.text() === '添加')!

    await add.trigger('click')

    expect(wrapper.get('[role="alert"]').text()).toContain('祖先')
    expect(JSON.stringify(family.data)).toBe(before)
    expect(family.revision).toBe(revision)
    expect(family.isDirty).toBe(false)
    expect(targetSelect.element.value).toBe('descendant')

    await targetSelect.setValue('unrelated')
    await add.trigger('click')

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(family.data.members.ancestor.parents).toEqual([{ id: 'unrelated', type: 'blood' }])
    expect(family.data.members.unrelated.children).toEqual([{ id: 'ancestor', type: 'blood' }])
    expect(family.isDirty).toBe(true)
    wrapper.unmount()
  })
})
