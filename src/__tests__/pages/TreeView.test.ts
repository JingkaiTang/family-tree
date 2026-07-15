/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import TreeView from '@/pages/TreeView.vue'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { mk } from '@/__tests__/fixtures/families'

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('@/services/autosave', () => ({ flushNow: vi.fn() }))
vi.mock('@/services/tauriApi', () => ({ gcMedia: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-member') }))

const FamilyCanvasStub = defineComponent({
  name: 'FamilyCanvas',
  props: ['selectedId', 'viewpointId', 'showAuxiliaryRelations', 'layoutResetVersion'],
  emits: ['row-order-change'],
  setup(_, { emit }) {
    return () => h('button', {
      'data-testid': 'reorder-row',
      onClick: () => emit('row-order-change', 'row:0', [
        'unit:person:b',
        'unit:person:a',
      ]),
    })
  },
})

describe('TreeView row order integration', () => {
  beforeEach(() => {
    routerPush.mockReset()
  })

  it('persists the row order emitted by FamilyCanvas through the family store', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          FamilyCanvas: FamilyCanvasStub,
          SearchBar: true,
        },
      },
    })

    expect(wrapper.get('[data-testid="restore-default-layout"]')
      .attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="reorder-row"]').trigger('click')

    expect(family.data.layoutPreferences.rowOrders).toEqual([{
      id: 'row:0',
      unitIds: ['unit:person:b', 'unit:person:a'],
    }])
    expect(wrapper.get('[data-testid="restore-default-layout"]')
      .attributes('disabled')).toBeUndefined()
  })

  it('restores the algorithm layout and the default canvas view without changing semantic state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.$patch(state => {
      state.data.members = {
        child: mk('child'),
        parent: mk('parent'),
        viewpoint: mk('viewpoint'),
      }
      state.data.layoutPreferences = {
        rowOrders: [{
          id: 'row:0',
          unitIds: ['unit:person:viewpoint', 'unit:person:parent'],
        }],
        familyAccentAssignments: {
          'unit:person:parent': '#123456',
        },
      }
      state.data.childLayoutAssignments.child = {
        primaryParentId: 'parent',
      }
    })
    ui.setSelected('child')
    ui.setViewpoint('viewpoint')
    ui.setCanvasView({ x: 120, y: -80, scale: 1.75 })
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          FamilyCanvas: FamilyCanvasStub,
          SearchBar: true,
        },
      },
    })

    const button = wrapper.get('[data-testid="restore-default-layout"]')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')

    expect(family.data.layoutPreferences).toEqual({
      rowOrders: [],
      familyAccentAssignments: {
        'unit:person:parent': '#123456',
      },
    })
    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
    })
    expect(ui.selectedId).toBe('child')
    expect(ui.viewpointId).toBe('viewpoint')
    expect(ui.canvasView).toBeNull()
    expect(wrapper.getComponent(FamilyCanvasStub).props('layoutResetVersion')).toBe(1)
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('toggles auxiliary relations without using selection as viewpoint', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const ui = useUiStore()
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.members = {
        selected: mk('selected'),
        viewpoint: mk('viewpoint'),
      }
    })
    ui.setSelected('selected')
    ui.setViewpoint('viewpoint')
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          FamilyCanvas: FamilyCanvasStub,
          SearchBar: true,
        },
      },
    })

    const toggle = wrapper.get('[data-testid="auxiliary-relations-toggle"]')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    await toggle.setValue(true)

    expect(ui.showAuxiliaryRelations).toBe(true)
    const canvas = wrapper.getComponent(FamilyCanvasStub)
    expect(canvas.props()).toMatchObject({
      selectedId: 'selected',
      viewpointId: 'viewpoint',
      showAuxiliaryRelations: true,
    })
  })

  it('resets auxiliary visibility when closing the project', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const ui = useUiStore()
    ui.setShowAuxiliaryRelations(true)
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          FamilyCanvas: FamilyCanvasStub,
          SearchBar: true,
        },
      },
    })

    const back = wrapper.findAll('button').find(button => button.text() === '返回')!
    await back.trigger('click')

    expect(ui.showAuxiliaryRelations).toBe(false)
    expect(routerPush).toHaveBeenCalledWith('/')
  })
})
