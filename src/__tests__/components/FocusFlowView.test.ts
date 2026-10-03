/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import FocusFlowView from '@/components/tree/focus-flow/FocusFlowView.vue'
import { createEmptyFamily } from '@/core/schema'
import { addParent, mk, multiUnionFamily, threeGenFamily } from '@/__tests__/fixtures/families'

vi.mock('@/services/storage', () => ({
  resolvePhotoUrl: vi.fn(),
}))

describe('FocusFlowView', () => {
  it('renders normal-flow family sections and mobile-safe member actions', async () => {
    const data = { ...createEmptyFamily(), members: threeGenFamily() }
    const wrapper = mount(FocusFlowView, {
      props: { data, focusId: 'self', selectedId: 'dad' },
      global: { plugins: [createPinia()] },
    })

    expect(wrapper.get('[data-testid="focus-flow-view"]').classes()).toContain('overflow-x-hidden')
    expect(wrapper.get('[data-testid="focus-flow-section-parents"]')).toBeDefined()
    expect(wrapper.findAll('[data-testid="focus-family-block"]').some(block => (
      block.attributes('data-block-kind') === 'couple'
    ))).toBe(true)

    await wrapper.get('[data-testid="focus-member-refocus-dad"]').trigger('click')
    await wrapper.get('[data-testid="focus-member-open-dad"]').trigger('click')
    await wrapper.get('[data-member-id="dad"] > button').trigger('click')
    expect(wrapper.emitted('focus-change')?.[0]).toEqual(['dad'])
    expect(wrapper.emitted('open')?.[0]).toEqual(['dad'])
    expect(wrapper.emitted('select')?.[0]).toEqual(['dad'])
  })

  it('emits branch toggles without mutating family data', async () => {
    const data = { ...createEmptyFamily(), members: multiUnionFamily() }
    const before = JSON.stringify(data)
    const wrapper = mount(FocusFlowView, {
      props: { data, focusId: 'parentA' },
      global: { plugins: [createPinia()] },
    })

    await wrapper.get('[data-testid="focus-flow-toggle-historical:parentA"]').trigger('click')
    expect(wrapper.emitted('branch-toggle')?.[0]).toEqual(['historical:parentA'])
    expect(JSON.stringify(data)).toBe(before)
  })

  it('previews and expands half-sibling families across parent groups', async () => {
    const members = multiUnionFamily()
    for (let index = 1; index <= 4; index += 1) {
      const child = mk(`half-${index}`, { birthDate: `201${index}-01-01` })
      addParent(child, members.parentA)
      addParent(child, members.parentC)
      members[child.id] = child
    }
    const data = { ...createEmptyFamily(), members }
    const wrapper = mount(FocusFlowView, {
      props: { data, focusId: 'childAB1' },
      global: { plugins: [createPinia()] },
    })
    const siblingSection = () => wrapper.get('[data-testid="focus-flow-section-siblings"]')

    expect(siblingSection().findAll('[data-member-id]').map(node => node.attributes('data-member-id')))
      .toEqual(['childAB2', 'childAC', 'half-1', 'half-2'])
    await wrapper.get('[data-testid="focus-flow-toggle-siblings:childAB1"]').trigger('click')
    expect(wrapper.emitted('branch-toggle')).toEqual([['siblings:childAB1']])

    await wrapper.setProps({ expandedBranchIds: ['siblings:childAB1'] })
    expect(siblingSection().findAll('[data-member-id]').map(node => node.attributes('data-member-id')))
      .toEqual(['childAB2', 'childAC', 'half-1', 'half-2', 'half-3', 'half-4'])
  })
})
