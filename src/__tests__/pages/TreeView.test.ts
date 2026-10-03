/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const { copyProjectMock, connectDriveMock, prepareDriveMock, startAutosaveMock, driveState } = vi.hoisted(() => ({
  copyProjectMock: vi.fn(), connectDriveMock: vi.fn(), prepareDriveMock: vi.fn(), startAutosaveMock: vi.fn(),
  driveState: { configured: false, ready: false, busy: false, error: null as string | null },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('@/services/autosave', () => ({ flushNow: flushNowMock, startAutosave: startAutosaveMock }))
vi.mock('@/services/projectService', () => ({ copyProject: copyProjectMock }))
vi.mock('@/services/googleDriveConnection', () => ({
  connectGoogleDrive: connectDriveMock, prepareGoogleDrive: prepareDriveMock, googleDriveState: driveState,
}))
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
    exportProjectBundleMock.mockResolvedValue({ kind: 'saved' })
    prepareExportMock.mockReset()
    prepareExportMock.mockImplementation(async project => () => exportProjectBundleMock(project))
    authorizeProjectMock.mockReset()
    authorizeProjectMock.mockResolvedValue(undefined)
    routerPush.mockReset()
    gcMediaMock.mockReset()
    gcMediaMock.mockResolvedValue(0)
    supportsMediaGcMock.mockReset()
    supportsMediaGcMock.mockReturnValue(true)
    Object.assign(driveState, { configured: false, ready: false, busy: false, error: null })
    prepareDriveMock.mockReset().mockResolvedValue(undefined)
    connectDriveMock.mockReset().mockResolvedValue('google-drive:account')
    copyProjectMock.mockReset()
    startAutosaveMock.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

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
    const localProject = { ...project, providerId: 'browser-directory' }
    family.setProject(localProject, createEmptyMeta('原家族'), createEmptyFamily())
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

    family.setProject({ ...localProject, id }, createEmptyMeta('新会话'), createEmptyFamily())
    finishSave()
    await flushPromises()

    expect(exportProjectBundleMock).not.toHaveBeenCalled()
    expect(family.projectRef).toEqual({ ...localProject, id })
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

  it('exports an unsaved cloud snapshot even when cloud saving would conflict', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    const cloudProject = { ...project, providerId: 'google-drive:account' }
    const meta = { ...createEmptyMeta('云端家族'), updatedAt: '2020-01-01T00:00:00.000Z' }
    family.setProject(cloudProject, meta, createEmptyFamily())
    family.upsertMember(mk('unsaved'))
    flushNowMock.mockRejectedValue(new Error('conflicting remote revision'))
    const runExport = vi.fn().mockResolvedValue({ kind: 'saved' })
    prepareExportMock.mockResolvedValue(runExport)
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })

    await wrapper.findAll('button').find(button => button.text() === '导出备份')!.trigger('click')
    await flushPromises()

    expect(flushNowMock).not.toHaveBeenCalled()
    expect(runExport).toHaveBeenCalledWith({
      meta: { ...meta, updatedAt: expect.any(String) }, family: expect.objectContaining({ members: { unsaved: mk('unsaved') } }),
    })
    expect(runExport.mock.calls[0]![0].meta.updatedAt).not.toBe(meta.updatedAt)
    expect(family.projectMeta!.updatedAt).toBe(meta.updatedAt)
    expect(family.isDirty).toBe(true)
    expect(ui.toast?.text).toContain('保存状态未改变')
    wrapper.unmount()
  })

  it('offers an explicit download link and revokes prepared archives on replacement, session change and unmount', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second').mockReturnValueOnce('blob:third')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.setProject({ ...project, providerId: 'google-drive:account' }, createEmptyMeta('云端'), createEmptyFamily())
    const blob = new Blob(['zip'], { type: 'application/zip' })
    exportProjectBundleMock.mockResolvedValue({ kind: 'download', blob, filename: '云端.familybundle' })
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    const exportButton = () => wrapper.findAll('button').find(button => button.text() === '导出备份')!

    await exportButton().trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="download-bundle"]').attributes()).toMatchObject({ href: 'blob:first', download: '云端.familybundle' })
    expect(revokeUrl).not.toHaveBeenCalled()
    await exportButton().trigger('click')
    await flushPromises()
    expect(revokeUrl).toHaveBeenCalledWith('blob:first')
    expect(wrapper.get('[data-testid="download-bundle"]').attributes('href')).toBe('blob:second')

    family.setProject({ ...project, providerId: 'google-drive:account', id: 'other' }, createEmptyMeta('其他'), createEmptyFamily())
    await flushPromises()
    expect(revokeUrl).toHaveBeenCalledWith('blob:second')
    expect(wrapper.find('[data-testid="download-bundle"]').exists()).toBe(false)
    await exportButton().trigger('click')
    await flushPromises()
    expect(createUrl).toHaveBeenCalledTimes(3)
    wrapper.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:third')
  })

  it.each(['session change', 'unmount'] as const)('does not attach a stale download after %s during export', async mode => {
    const createUrl = vi.spyOn(URL, 'createObjectURL')
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.setProject({ ...project, providerId: 'google-drive:account' }, createEmptyMeta('云端'), createEmptyFamily())
    let finish!: (value: unknown) => void
    exportProjectBundleMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    await wrapper.findAll('button').find(button => button.text() === '导出备份')!.trigger('click')
    if (mode === 'session change') family.setProject({ ...project, id: 'new' }, createEmptyMeta('新项目'), createEmptyFamily())
    else wrapper.unmount()
    finish({ kind: 'download', blob: new Blob(['zip']), filename: 'old.familybundle' })
    await flushPromises()
    expect(createUrl).not.toHaveBeenCalled()
    if (mode === 'session change') {
      expect(wrapper.find('[data-testid="download-bundle"]').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('creates a Drive copy of unsaved local data and opens it only after a complete upload', async () => {
    Object.assign(driveState, { configured: true, ready: true })
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const source = { ...project, providerId: 'browser-directory' }
    family.setProject(source, createEmptyMeta('原家族'), createEmptyFamily())
    family.upsertMember(mk('draft'))
    const copied = { project: { providerId: 'google-drive:account', id: 'new-folder', displayName: '原家族（副本）' }, meta: createEmptyMeta('原家族（副本）'), family: JSON.parse(JSON.stringify(family.data)) }
    copyProjectMock.mockResolvedValue(copied)
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    await wrapper.get('[data-testid="copy-to-drive"]').trigger('click')
    await flushPromises()

    expect(connectDriveMock).toHaveBeenCalledOnce()
    expect(flushNowMock).not.toHaveBeenCalled()
    expect(copyProjectMock).toHaveBeenCalledWith(source,
      { providerId: 'google-drive:account', id: 'root', displayName: '原家族（副本）' },
      { meta: expect.objectContaining({ name: '原家族' }), family: expect.objectContaining({ members: { draft: mk('draft') } }) })
    expect(family.projectRef).toEqual(copied.project)
    expect(family.data.members.draft).toEqual(mk('draft'))
    expect(startAutosaveMock).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it.each(['success', 'failure'] as const)('retries loading Google authorization without opening a popup: %s', async outcome => {
    Object.assign(driveState, { configured: true, ready: false, error: '网络不可用' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.setProject(project, createEmptyMeta('本地家族'), createEmptyFamily())
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    expect(wrapper.get('[data-testid="copy-to-drive"]').attributes('disabled')).toBeDefined()
    prepareDriveMock.mockImplementationOnce(async () => {
      if (outcome === 'failure') throw new Error('仍然离线')
      driveState.ready = true
      driveState.error = null
    })

    await wrapper.get('[data-testid="retry-drive-preparation"]').trigger('click')
    await flushPromises()

    expect(prepareDriveMock).toHaveBeenCalledTimes(2)
    expect(connectDriveMock).not.toHaveBeenCalled()
    expect(copyProjectMock).not.toHaveBeenCalled()
    if (outcome === 'success') {
      expect(wrapper.find('[data-testid="retry-drive-preparation"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="copy-to-drive"]').attributes('disabled')).toBeUndefined()
    } else {
      expect(ui.toast?.text).toContain('仍然离线')
      expect(wrapper.get('[data-testid="retry-drive-preparation"]').attributes('disabled')).toBeUndefined()
    }
    wrapper.unmount()
  })

  it.each(['failure', 'edited', 'session'] as const)('preserves the editor when a Drive copy is %s', async mode => {
    Object.assign(driveState, { configured: true, ready: true })
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const ui = useUiStore()
    family.setProject(project, createEmptyMeta('原家族'), createEmptyFamily())
    family.upsertMember(mk('draft'))
    let finish!: (value: unknown) => void
    let reject!: (error: Error) => void
    copyProjectMock.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail }))
    const wrapper = mount(TreeView, {
      global: { plugins: [pinia], stubs: { TreeLayoutHost: TreeLayoutHostStub, SearchBar: true } },
    })
    await wrapper.get('[data-testid="copy-to-drive"]').trigger('click')
    expect(copyProjectMock).toHaveBeenCalledOnce()
    if (mode === 'failure') reject(new Error('照片上传失败'))
    else {
      if (mode === 'edited') family.upsertMember(mk('new-edit'))
      else family.setProject({ ...project, id: 'another' }, createEmptyMeta('其他'), createEmptyFamily())
      finish({ project: { ...project, providerId: 'google-drive:account', id: 'copy' }, meta: createEmptyMeta('副本'), family: createEmptyFamily() })
    }
    await flushPromises()
    expect(family.projectRef).toEqual({ ...project, id: mode === 'session' ? 'another' : project.id })
    expect(startAutosaveMock).not.toHaveBeenCalled()
    if (mode === 'failure') {
      expect(family.isDirty).toBe(true)
      expect(ui.toast?.text).toContain('照片上传失败')
    } else if (mode === 'edited') {
      expect(family.data.members['new-edit']).toBeDefined()
      expect(family.isDirty).toBe(true)
      expect(ui.toast?.text).toContain('又有修改')
    }
    wrapper.unmount()
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
