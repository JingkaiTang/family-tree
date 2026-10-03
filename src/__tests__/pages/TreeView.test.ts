/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import TreeView from '@/pages/TreeView.vue'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { mk } from '@/__tests__/fixtures/families'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'

const { exportProjectBundleMock, prepareExportMock, authorizeProjectMock, flushNowMock, routerPush, gcMediaMock, supportsMediaGcMock } = vi.hoisted(() => ({
  exportProjectBundleMock: vi.fn(),
  prepareExportMock: vi.fn(),
  authorizeProjectMock: vi.fn(),
  flushNowMock: vi.fn(),
  routerPush: vi.fn(),
  gcMediaMock: vi.fn(),
  supportsMediaGcMock: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('@/services/autosave', () => ({ flushNow: flushNowMock }))
vi.mock('@/services/projectTransfer', () => ({
  prepareProjectBundleExport: prepareExportMock,
}))
vi.mock('@/services/storage', () => ({
  gcMedia: gcMediaMock,
  authorizeProject: authorizeProjectMock,
  supportsMediaGc: supportsMediaGcMock,
}))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-member') }))

const project = { providerId: 'test-storage', id: 'opaque-project', displayName: '项目显示名' }

const TreeLayoutHostStub = defineComponent({
  name: 'TreeLayoutHost',
  props: [
    'mode',
    'selectedId',
    'viewpointId',
    'layoutFocusId',
    'showAuxiliaryRelations',
    'layoutResetVersion',
    'initialGridView',
    'initialFocusScrollTop',
    'expandedBranchIds',
  ],
  emits: [
    'grid-view-change',
    'focus-scroll-change',
    'layout-focus-change',
    'focus-branch-toggle',
    'domain-row-order-change',
    'bridge-order-change',
    'root-order-change',
    'subtree-order-change',
  ],
  setup(_, { emit }) {
    return () => h('div', [
      h('button', {
        'data-testid': 'change-grid-view',
        onClick: () => emit('grid-view-change', { x: 24, y: -12, scale: 1.4 }),
      }),
      h('button', {
        'data-testid': 'change-focus-scroll',
        onClick: () => emit('focus-scroll-change', 320),
      }),
      h('button', {
        'data-testid': 'change-layout-focus',
        onClick: () => emit('layout-focus-change', 'focus-target'),
      }),
      h('button', {
        'data-testid': 'toggle-focus-branch',
        onClick: () => emit('focus-branch-toggle', 'ancestors:focus-target'),
      }),
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
    exportProjectBundleMock.mockReset()
    exportProjectBundleMock.mockResolvedValue(true)
    prepareExportMock.mockReset()
    prepareExportMock.mockImplementation(async project => () => exportProjectBundleMock(project))
    authorizeProjectMock.mockReset()
    authorizeProjectMock.mockResolvedValue(undefined)
    routerPush.mockReset()
    gcMediaMock.mockReset()
    gcMediaMock.mockResolvedValue(0)
    supportsMediaGcMock.mockReset()
    supportsMediaGcMock.mockReturnValue(true)
  })

  it('persists the row order emitted by FamilyCanvas through the family store', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          TreeLayoutHost: TreeLayoutHostStub,
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
          TreeLayoutHost: TreeLayoutHostStub,
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
          TreeLayoutHost: TreeLayoutHostStub,
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
          TreeLayoutHost: TreeLayoutHostStub,
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
    expect(wrapper.getComponent(TreeLayoutHostStub).props('layoutResetVersion')).toBe(1)
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
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
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
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
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
          TreeLayoutHost: TreeLayoutHostStub,
          SearchBar: true,
        },
      },
    })

    const toggle = wrapper.get('[data-testid="auxiliary-relations-toggle"]')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    await toggle.setValue(true)

    expect(ui.showAuxiliaryRelations).toBe(true)
    const canvas = wrapper.getComponent(TreeLayoutHostStub)
    expect(canvas.props()).toMatchObject({
      selectedId: 'selected',
      viewpointId: 'viewpoint',
      showAuxiliaryRelations: true,
    })
  })

  it('switches layouts without dirtying the project and preserves each layout state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.$patch(state => {
      state.data.members = {
        selected: mk('selected'),
        'focus-target': mk('focus-target'),
      }
    })
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
      },
    })

    expect(wrapper.get('[data-testid="layout-mode-select"] option[value="auto"]').text())
      .toBe('自动（网格）')

    await wrapper.get('[data-testid="change-grid-view"]').trigger('click')
    await wrapper.get('[data-testid="layout-mode-select"]').setValue('focus-flow')
    await wrapper.get('[data-testid="change-layout-focus"]').trigger('click')
    await wrapper.get('[data-testid="toggle-focus-branch"]').trigger('click')
    await wrapper.get('[data-testid="change-focus-scroll"]').trigger('click')

    expect(ui.resolvedLayoutMode).toBe('focus-flow')
    expect(wrapper.get('[data-testid="layout-mode-select"] option[value="auto"]').text())
      .toBe('自动（网格）')
    expect(ui.canvasView).toEqual({ x: 24, y: -12, scale: 1.4 })
    expect(ui.layoutFocusId).toBe('focus-target')
    expect(ui.focusFlowExpandedBranchIds).toEqual(['ancestors:focus-target'])
    expect(ui.focusFlowScrollTop).toBe(320)
    expect(family.isDirty).toBe(false)
    expect(wrapper.getComponent(TreeLayoutHostStub).props()).toMatchObject({
      mode: 'focus-flow',
      layoutFocusId: 'focus-target',
      initialGridView: { x: 24, y: -12, scale: 1.4 },
      initialFocusScrollTop: 320,
      expandedBranchIds: ['ancestors:focus-target'],
    })

    await wrapper.get('[data-testid="layout-mode-select"]').setValue('family-grid')
    expect(ui.resolvedLayoutMode).toBe('family-grid')
    expect(ui.focusFlowScrollTop).toBe(320)
    expect(family.isDirty).toBe(false)
  })

  it('resolves the initial layout focus without conflating selection and viewpoint', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.$patch(state => {
      state.data.members = {
        root: mk('root'),
        selected: mk('selected'),
        viewpoint: mk('viewpoint'),
      }
      state.data.rootMemberId = 'root'
    })
    ui.setSelected('selected')
    ui.setViewpoint('viewpoint')

    mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
      },
    })

    expect(ui.layoutFocusId).toBe('selected')
    expect(ui.selectedId).toBe('selected')
    expect(ui.viewpointId).toBe('viewpoint')
    expect(family.isDirty).toBe(false)
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
          TreeLayoutHost: TreeLayoutHostStub,
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

  it('flushes pending changes before exporting a project backup', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const project = { providerId: 'browser-directory', id: 'test-project', displayName: 'test.family' }
    family.setProject(project, {
      name: '测试',
      schemaVersion: 4,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }, family.data)
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
      },
    })

    const exportButton = wrapper.findAll('button')
      .find(button => button.text() === '导出备份')!
    await exportButton.trigger('click')

    expect(flushNowMock).toHaveBeenCalledOnce()
    expect(exportProjectBundleMock).toHaveBeenCalledWith(project)
    expect(flushNowMock.mock.invocationCallOrder[0])
      .toBeLessThan(exportProjectBundleMock.mock.invocationCallOrder[0]!)
  })

  it.each(['another-project', project.id])('does not export after the session changes while saving (%s)', async (id) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.setProject(project, createEmptyMeta('原家族'), createEmptyFamily())
    let finishSave!: () => void
    flushNowMock.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve }))
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
      },
    })

    await wrapper.findAll('button').find(button => button.text() === '导出备份')!.trigger('click')
    expect(flushNowMock).toHaveBeenCalledOnce()
    expect(exportProjectBundleMock).not.toHaveBeenCalled()

    family.setProject({ ...project, id }, createEmptyMeta('新会话'), createEmptyFamily())
    finishSave()
    await flushPromises()

    expect(exportProjectBundleMock).not.toHaveBeenCalled()
    expect(family.projectRef).toEqual({ ...project, id })
    wrapper.unmount()
  })

  it('keeps the project open when the final save fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.setProject({ providerId: 'browser-directory', id: 'test-project', displayName: 'test.family' }, {
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
        stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true },
      },
    })

    const back = wrapper.findAll('button').find(button => button.text() === '返回')!
    await back.trigger('click')

    expect(family.projectRef).toEqual({ providerId: 'browser-directory', id: 'test-project', displayName: 'test.family' })
    expect(routerPush).not.toHaveBeenCalled()
    expect(ui.toast?.text).toContain('项目保持打开')
  })

  it('shows the project display name and only offers media cleanup when supported', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const data = createEmptyFamily()
    data.members.a = { ...mk('a'), photoId: 'used-photo' }
    family.setProject(project, createEmptyMeta('家族名称'), data)
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    expect(wrapper.text()).toContain(project.displayName)
    expect(wrapper.text()).not.toContain(project.id)
    const cleanup = wrapper.findAll('button').find(button => button.text() === '清理未用照片')!
    await cleanup.trigger('click')
    await flushPromises()
    expect(gcMediaMock).toHaveBeenCalledWith(project, ['used-photo'])

    supportsMediaGcMock.mockReturnValue(false)
    family.setProject({ ...project, providerId: 'cloud-without-gc' }, createEmptyMeta('云端'), data)
    await flushPromises()
    expect(wrapper.findAll('button').some(button => button.text() === '清理未用照片')).toBe(false)
    expect(gcMediaMock).toHaveBeenCalledTimes(1)
  })
})
