/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RelationEditor from '@/components/member/RelationEditor.vue'
import { useFamilyStore } from '@/stores/family'
import { addParent, mk } from '@/__tests__/fixtures/families'

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
})
