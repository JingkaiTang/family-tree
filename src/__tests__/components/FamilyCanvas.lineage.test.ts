/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import FamilyCanvas from '@/components/tree/FamilyCanvas.vue'
import { createEmptyFamily } from '@/core/schema'
import { layoutFamilyTreeSync } from '@/core/treeLayoutCore'
import { addParent, addSpouse, mk } from '@/__tests__/fixtures/families'

const { layoutFamilyTree, focusStagePoint } = vi.hoisted(() => ({
  layoutFamilyTree: vi.fn(),
  focusStagePoint: vi.fn(),
}))
vi.mock('@/core/treeLayout', () => ({ layoutFamilyTree }))

const PanZoomStub = defineComponent({
  name: 'PanZoomWrapper',
  emits: ['view-change', 'scale-change'],
  setup(_, { expose, slots }) {
    expose({ focusStagePoint, getScale: () => 1 })
    return () => h('div', slots.default?.())
  },
})

function lineageFamily() {
  const ids = ['grandparent', 'parent', 'aunt', 'other-parent', 'self', 'sibling',
    'partner', 'partner-parent', 'child', 'grandchild']
  const members = Object.fromEntries(ids.map(id => [id, mk(id)]))
  addParent(members.parent, members.grandparent)
  addParent(members.aunt, members.grandparent)
  for (const id of ['self', 'sibling']) {
    addParent(members[id], members.parent)
    addParent(members[id], members['other-parent'])
  }
  addSpouse(members.parent, members['other-parent'])
  addSpouse(members.self, members.partner)
  addParent(members.partner, members['partner-parent'])
  addParent(members.child, members.self)
  addParent(members.child, members.partner)
  addParent(members.grandchild, members.child)
  return { ...createEmptyFamily(), members }
}

async function mountLineage(selectedId?: string, data = lineageFamily(), showAuxiliaryRelations = false) {
  layoutFamilyTree.mockResolvedValue(layoutFamilyTreeSync(Object.values(data.members), {
    data,
    auxiliaryFocusPersonId: selectedId,
    view: {
      showHistoricalPartnerships: showAuxiliaryRelations,
      showSecondaryParentage: showAuxiliaryRelations,
      showGodparentRelations: showAuxiliaryRelations,
    },
  }))
  const wrapper = mount(FamilyCanvas, {
    props: { data, selectedId, showAuxiliaryRelations },
    global: { plugins: [createPinia()], stubs: { PanZoomWrapper: PanZoomStub } },
  })
  await flushPromises()
  return wrapper
}

describe('FamilyCanvas direct lineage', () => {
  beforeEach(() => {
    layoutFamilyTree.mockReset()
    focusStagePoint.mockReset()
  })

  it('highlights every ancestor and descendant without spreading into collateral or spouse families', async () => {
    const wrapper = await mountLineage('self')
    const activeIds = wrapper.findAll('[data-testid="member-node"][data-lineage-state="active"]')
      .map(node => node.attributes('data-member-id')).sort()
    expect(activeIds).toEqual(['child', 'grandchild', 'grandparent', 'other-parent', 'parent', 'self'])
    for (const id of ['aunt', 'sibling', 'partner', 'partner-parent']) {
      expect(wrapper.get(`[data-member-id="${id}"][data-testid="member-node"]`)
        .attributes('data-lineage-state')).toBe('muted')
    }
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('祖先 3 人')
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('后代 2 人')
    wrapper.unmount()
  })

  it('lights only the traversed child branches on shared parent buses', async () => {
    const wrapper = await mountLineage('self')
    const highlightedChildren = [...new Set(wrapper.findAll('[data-testid="lineage-route"]')
      .map(path => path.attributes('data-child-person-id')))].sort()
    expect(highlightedChildren).toEqual(['child', 'grandchild', 'parent', 'self'])
    wrapper.unmount()
  })

  it('previews on hover and keyboard focus, locks on selection, and never relayouts on highlighting', async () => {
    const wrapper = await mountLineage()
    const person = wrapper.get('[data-testid="member-node"][data-member-id="self"]')
    focusStagePoint.mockClear()
    await person.trigger('pointerenter')
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('self · 直系关系')
    expect(wrapper.get('[data-testid="lineage-summary"]').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.get('[data-testid="lineage-summary"]').findAll('button')).toHaveLength(0)
    await person.trigger('pointerleave')
    expect(wrapper.find('[data-testid="lineage-summary"]').exists()).toBe(false)
    await person.trigger('focus')
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('预览')
    await person.trigger('keydown', { key: 'Enter' })
    await person.trigger('blur')
    await wrapper.get('[data-testid="member-node"][data-member-id="sibling"]').trigger('pointerenter')
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('self · 直系关系')
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('已锁定')
    expect(wrapper.emitted('select')).toEqual([['self']])
    await wrapper.setProps({ selectedId: 'sibling' })
    expect(wrapper.get('[data-testid="lineage-summary"]').text()).toContain('sibling · 直系关系')
    expect(layoutFamilyTree).toHaveBeenCalledTimes(1)
    expect(focusStagePoint).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clears with Escape or a blank click, but preserves the highlight when panning', async () => {
    const wrapper = await mountLineage('self')
    const canvas = wrapper.get('[data-testid="family-canvas"]')
    await canvas.trigger('pointerdown', { clientX: 10, clientY: 10 })
    await canvas.trigger('pointermove', { clientX: 50, clientY: 10 })
    await canvas.trigger('click')
    expect(wrapper.find('[data-testid="lineage-summary"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="lineage-summary"]').exists()).toBe(false)
    expect(wrapper.emitted('clear-selection')).toHaveLength(1)
    await wrapper.get('[data-testid="member-node"][data-member-id="self"]').trigger('click')
    await canvas.trigger('pointerdown', { clientX: 10, clientY: 10 })
    await canvas.trigger('click')
    expect(wrapper.find('[data-testid="lineage-summary"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('includes visible adoptive parent paths while leaving godparents unhighlighted', async () => {
    const data = lineageFamily()
    data.members.adoptive = mk('adoptive')
    data.members.godparent = mk('godparent')
    addParent(data.members.self, data.members.adoptive, 'adopted')
    data.members.self.godparents.push({ id: 'godparent', type: 'godparent' })
    const wrapper = await mountLineage('self', data, true)
    const owners = wrapper.findAll('[data-testid="lineage-route"]')
      .map(path => path.attributes('data-route-id'))
    expect(owners).toContain('route:aux:parentage:adoptive:adoptive:self')
    expect(owners.some(id => id?.includes('godparent'))).toBe(false)
    wrapper.unmount()
  })

  it('does not leave a stale hover preview when the pointer leaves during a drag', async () => {
    const wrapper = await mountLineage()
    const person = wrapper.get('[data-testid="member-node"][data-member-id="self"]')
    await person.trigger('pointerenter')
    await person.trigger('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 100 })
    await person.trigger('pointermove', { pointerId: 1, clientX: 130, clientY: 100 })
    await person.trigger('pointerleave')
    await person.trigger('pointercancel', { pointerId: 1 })
    expect(wrapper.find('[data-testid="lineage-summary"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
