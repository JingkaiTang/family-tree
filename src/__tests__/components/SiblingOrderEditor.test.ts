/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SiblingOrderEditor from '@/components/member/SiblingOrderEditor.vue'
import { createEmptyFamily } from '@/core/schema'
import { addParent, mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'

describe('SiblingOrderEditor', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('updates one shared order and shows it from another sibling detail', async () => {
    const family = useFamilyStore()
    const parentA = mk('parent-a', { firstName: '父' })
    const parentB = mk('parent-b', { firstName: '母' })
    const childA = mk('child-a', { firstName: '大宝' })
    const childB = mk('child-b', { firstName: '二宝' })
    const childC = mk('child-c', { firstName: '三宝' })
    for (const child of [childA, childB, childC]) {
      addParent(child, parentA)
      addParent(child, parentB)
    }
    const data = createEmptyFamily()
    data.members = Object.fromEntries(
      [parentA, parentB, childA, childB, childC].map(member => [member.id, member]),
    )
    family.$patch(state => {
      state.data = data
    })
    const wrapper = mount(SiblingOrderEditor, {
      props: { memberId: 'child-a' },
    })

    await wrapper.get('[aria-label="下移大宝"]').trigger('click')

    expect(family.data.siblingOrders['parentage:parent-a+parent-b']).toEqual([
      'child-b',
      'child-a',
      'child-c',
    ])
    await wrapper.setProps({ memberId: 'child-c' })
    expect(orderedItemIds(wrapper)).toEqual(['child-b', 'child-a', 'child-c'])

    await wrapper.get('button').trigger('click')
    expect(family.data.siblingOrders).toEqual({})
    expect(orderedItemIds(wrapper)).toEqual(['child-a', 'child-b', 'child-c'])
  })
})

function orderedItemIds(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-testid^="sibling-order-item-"]')
    .map(item => item.attributes('data-testid')!.replace('sibling-order-item-', ''))
}
