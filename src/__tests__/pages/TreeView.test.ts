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

const { flushNowMock, routerPush } = vi.hoisted(() => ({
  flushNowMock: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('@/services/autosave', () => ({ flushNow: flushNowMock }))
vi.mock('@/services/tauriApi', () => ({ gcMedia: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-member') }))

const FamilyCanvasStub = defineComponent({
  name: 'FamilyCanvas',
  props: ['selectedId', 'viewpointId', 'showAuxiliaryRelations', 'layoutResetVersion'],
  emits: [
    'domain-row-order-change',
    'bridge-order-change',
    'root-order-change',
    'subtree-order-change',
  ],
  setup(_, { emit }) {
    return () => h('div', [
      h('button', {
        'data-testid': 'reorder-row',
        onClick: () => emit('domain-row-order-change', {
          id: 'row:domain:root:test:0',
          domainId: 'domain:root:test',
          generation: 0,
          unitIds: ['unit:person:b', 'unit:person:a'],
        }),
      }),
      h('button', {
        'data-testid': 'reorder-bridge',
        onClick: () => emit('bridge-order-change', {
          id: 'row:domain:bridge:a+b:1',
          domainId: 'domain:bridge:a+b',
          generation: 1,
          unitIds: ['unit:cross-2', 'unit:cross-1'],
        }),
      }),
      h('button', {
        'data-testid': 'reorder-roots',
        onClick: () => emit('root-order-change', 'component:main', [
          'root:b',
          'root:a',
        ]),
      }),
      h('button', {
        'data-testid': 'reorder-subtree',
        onClick: () => emit('subtree-order-change', {
          rowOrders: [{
            id: 'row:domain:root:test:2',
            domainId: 'domain:root:test',
            generation: 2,
            unitIds: ['unit:child'],
            columns: { 'unit:child': 8 },
          }],
          bridgeOrders: [{
            id: 'row:domain:bridge:a+b:3',
            domainId: 'domain:bridge:a+b',
            generation: 3,
            unitIds: ['unit:grandchild'],
            columns: { 'unit:grandchild': 10 },
          }],
        }),
      }),
    ])
  },
})

describe('TreeView row order integration', () => {
  beforeEach(() => {
    flushNowMock.mockReset()
    flushNowMock.mockResolvedValue(undefined)
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
      id: 'row:domain:root:test:0',
      domainId: 'domain:root:test',
      generation: 0,
      unitIds: ['unit:person:b', 'unit:person:a'],
    }])
    expect(wrapper.get('[data-testid="restore-default-layout"]')
      .attributes('disabled')).toBeUndefined()
  })

  it('forwards bridge and root order changes to their dedicated store actions', async () => {
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

    await wrapper.get('[data-testid="reorder-bridge"]').trigger('click')
    await wrapper.get('[data-testid="reorder-roots"]').trigger('click')

    expect(family.data.layoutPreferences.bridgeOrders).toEqual([{
      id: 'row:domain:bridge:a+b:1',
      domainId: 'domain:bridge:a+b',
      generation: 1,
      unitIds: ['unit:cross-2', 'unit:cross-1'],
    }])
    expect(family.data.layoutPreferences.rootOrders).toEqual([{
      componentId: 'component:main',
      rootIds: ['root:b', 'root:a'],
    }])
  })

  it('persists all subtree row preferences as one store update', async () => {
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

    await wrapper.get('[data-testid="reorder-subtree"]').trigger('click')

    expect(family.data.layoutPreferences.rowOrders).toEqual([{
      id: 'row:domain:root:test:2',
      domainId: 'domain:root:test',
      generation: 2,
      unitIds: ['unit:child'],
      columns: { 'unit:child': 8 },
    }])
    expect(family.data.layoutPreferences.bridgeOrders).toEqual([{
      id: 'row:domain:bridge:a+b:3',
      domainId: 'domain:bridge:a+b',
      generation: 3,
      unitIds: ['unit:grandchild'],
      columns: { 'unit:grandchild': 10 },
    }])
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
        rootOrders: [{
          componentId: 'component:main',
          rootIds: ['root:b', 'root:a'],
        }],
        rowOrders: [{
          id: 'row:0',
          domainId: 'legacy',
          generation: 0,
          unitIds: ['unit:person:viewpoint', 'unit:person:parent'],
        }],
        bridgeOrders: [{
          id: 'row:domain:bridge:a+b:1',
          domainId: 'domain:bridge:a+b',
          generation: 1,
          unitIds: ['unit:cross-2', 'unit:cross-1'],
        }],
        rootAccentAssignments: {},
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
    const clearAll = vi.spyOn(family, 'clearAllLayoutOrderPreferences')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')

    expect(clearAll).toHaveBeenCalledOnce()
    expect(family.data.layoutPreferences).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
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

  it.each([
    ['root order', {
      rootOrders: [{ componentId: 'component:main', rootIds: ['root:b', 'root:a'] }],
      rowOrders: [],
      bridgeOrders: [],
    }],
    ['bridge order', {
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [{
        id: 'row:domain:bridge:a+b:1',
        domainId: 'domain:bridge:a+b',
        generation: 1,
        unitIds: ['unit:cross-2', 'unit:cross-1'],
      }],
    }],
  ])('enables restore for a persisted %s', (_label, orders) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.layoutPreferences = {
        ...state.data.layoutPreferences,
        ...orders,
      }
    })
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { FamilyCanvas: FamilyCanvasStub, SearchBar: true },
      },
    })

    expect(wrapper.get('[data-testid="restore-default-layout"]')
      .attributes('disabled')).toBeUndefined()
  })

  it('does not enable restore for accent assignments alone', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.layoutPreferences.rootAccentAssignments = { 'root:a': '#345678' }
      state.data.layoutPreferences.familyAccentAssignments = { 'unit:a': '#123456' }
    })
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { FamilyCanvas: FamilyCanvasStub, SearchBar: true },
      },
    })

    expect(wrapper.get('[data-testid="restore-default-layout"]')
      .attributes('disabled')).toBeDefined()
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

    expect(flushNowMock).toHaveBeenCalledOnce()
    expect(ui.showAuxiliaryRelations).toBe(false)
    expect(routerPush).toHaveBeenCalledWith('/')
  })

  it('keeps the project open when the final save fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.setProject('/tmp/test.family', {
      name: '测试',
      schemaVersion: 4,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }, family.data)
    family.upsertMember(mk('a'))
    flushNowMock.mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { FamilyCanvas: FamilyCanvasStub, SearchBar: true },
      },
    })

    const back = wrapper.findAll('button').find(button => button.text() === '返回')!
    await back.trigger('click')

    expect(family.projectPath).toBe('/tmp/test.family')
    expect(routerPush).not.toHaveBeenCalled()
    expect(ui.toast?.text).toContain('项目保持打开')
  })
})
