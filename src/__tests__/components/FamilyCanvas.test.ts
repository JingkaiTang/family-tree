/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import FamilyCanvas from '@/components/tree/FamilyCanvas.vue'
import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'
import type { LayoutScene } from '@/core/family-layout/types'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'

const { focusStagePoint, getScale, layoutFamilyTree } = vi.hoisted(() => ({
  focusStagePoint: vi.fn(),
  getScale: vi.fn(() => 1),
  layoutFamilyTree: vi.fn(),
}))

vi.mock('@/core/treeLayout', () => ({ layoutFamilyTree }))

const PanZoomStub = defineComponent({
  name: 'PanZoomWrapper',
  props: ['initialView'],
  emits: ['view-change'],
  setup(_, { expose, slots }) {
    expose({
      focusStagePoint,
      getScale,
    })
    return () => h('div', slots.default?.())
  },
})

const familyAccent = '#2f9d7e'
const coupleScene: LayoutScene = {
  units: [{
    id: 'unit:parents',
    kind: 'couple',
    memberIds: ['A', 'B'],
    generation: 0,
    width: 360,
    lineageAffinity: {},
    accent: familyAccent,
    rect: { x: 48, y: 24, width: 360, height: 216 },
    order: 0,
  }],
  cards: [{
    id: 'A',
    unitId: 'unit:parents',
    generation: 0,
    rect: { x: 48, y: 24, width: 168, height: 216 },
  }, {
    id: 'B',
    unitId: 'unit:parents',
    generation: 0,
    rect: { x: 240, y: 24, width: 168, height: 216 },
  }],
  hubs: [{
    id: 'hub:unit:parents',
    unitId: 'unit:parents',
    point: { x: 228, y: 132 },
  }],
  rows: [{ id: 'row:0', generation: 0, unitIds: ['unit:parents'] }],
  routes: [{
    id: 'route:parents',
    routeOwnerId: 'parentage:parents',
    kind: 'primary',
    accent: familyAccent,
    segments: [
      { orientation: 'vertical', points: [{ x: 228, y: 132 }, { x: 228, y: 300 }] },
      { orientation: 'bridge', points: [
        { x: 228, y: 300 },
        { x: 240, y: 288 },
        { x: 252, y: 300 },
      ] },
    ],
  }, {
    id: 'route:other',
    routeOwnerId: 'parentage:other',
    kind: 'primary',
    accent: '#d6578b',
    segments: [
      { orientation: 'horizontal', points: [{ x: 0, y: 360 }, { x: 100, y: 360 }] },
    ],
  }],
  bounds: { x: 0, y: 0, width: 408, height: 400 },
  diagnostics: [],
}

const emptyScene: LayoutScene = {
  units: [],
  cards: [],
  hubs: [],
  rows: [],
  routes: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  diagnostics: [],
}

const sortableScene: LayoutScene = {
  units: [
    {
      id: 'unit:person:A',
      kind: 'single',
      memberIds: ['A'],
      generation: 0,
      width: 168,
      lineageAffinity: {},
      accent: '#111111',
      rect: { x: 0, y: 0, width: 168, height: 216 },
      order: 0,
    },
    {
      id: 'unit:person:B',
      kind: 'single',
      memberIds: ['B'],
      generation: 0,
      width: 168,
      lineageAffinity: {},
      accent: '#222222',
      rect: { x: 240, y: 0, width: 168, height: 216 },
      order: 1,
    },
    {
      id: 'unit:person:C',
      kind: 'single',
      memberIds: ['C'],
      generation: 0,
      width: 168,
      lineageAffinity: {},
      accent: '#333333',
      rect: { x: 480, y: 0, width: 168, height: 216 },
      order: 2,
    },
    {
      id: 'unit:person:D',
      kind: 'single',
      memberIds: ['D'],
      generation: 1,
      width: 168,
      lineageAffinity: {},
      accent: '#444444',
      rect: { x: 0, y: 360, width: 168, height: 216 },
      order: 0,
    },
  ],
  cards: [
    { id: 'A', unitId: 'unit:person:A', generation: 0, rect: { x: 0, y: 0, width: 168, height: 216 } },
    { id: 'B', unitId: 'unit:person:B', generation: 0, rect: { x: 240, y: 0, width: 168, height: 216 } },
    { id: 'C', unitId: 'unit:person:C', generation: 0, rect: { x: 480, y: 0, width: 168, height: 216 } },
    { id: 'D', unitId: 'unit:person:D', generation: 1, rect: { x: 0, y: 360, width: 168, height: 216 } },
  ],
  hubs: [],
  rows: [
    { id: 'row:0', generation: 0, unitIds: ['unit:person:A', 'unit:person:B', 'unit:person:C'] },
    { id: 'row:1', generation: 1, unitIds: ['unit:person:D'] },
  ],
  routes: [
    {
      id: 'route:C',
      routeOwnerId: 'parentage:C',
      kind: 'primary',
      accent: '#333333',
      segments: [{ orientation: 'vertical', points: [{ x: 564, y: 0 }, { x: 564, y: 300 }] }],
    },
    {
      id: 'route:other',
      routeOwnerId: 'parentage:other',
      kind: 'primary',
      accent: '#333333',
      segments: [{ orientation: 'vertical', points: [{ x: 324, y: 300 }, { x: 324, y: 360 }] }],
    },
  ],
  bounds: { x: 0, y: 0, width: 648, height: 576 },
  diagnostics: [],
}

function familyData(members: Member[]): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(member => [member.id, member])),
  }
}

function mountCanvas(data: FamilyData, props = {}) {
  return mount(FamilyCanvas, {
    props: { data, ...props },
    global: {
      plugins: [createPinia()],
      stubs: { PanZoomWrapper: PanZoomStub },
    },
  })
}

function mountStoreCanvas(data: FamilyData, props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  Object.assign(family.data, data)
  let wrapper!: ReturnType<typeof mountCanvas>
  wrapper = mount(FamilyCanvas, {
    props: {
      data: family.data,
      ...props,
      onRowOrderChange(rowId: string, unitIds: string[]) {
        family.setRowOrderPreference(rowId, unitIds)
        void wrapper.setProps({ data: family.data })
      },
    },
    global: {
      plugins: [pinia],
      stubs: { PanZoomWrapper: PanZoomStub },
    },
  })
  return { family, wrapper }
}

function mountDetachedCanvas(data: FamilyData, storeData: FamilyData) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  Object.assign(family.data, storeData)
  const wrapper = mount(FamilyCanvas, {
    props: { data },
    global: {
      plugins: [pinia],
      stubs: { PanZoomWrapper: PanZoomStub },
    },
  })
  return { family, wrapper }
}

async function beginDrag(
  wrapper: ReturnType<typeof mountCanvas>,
  memberIndex: number,
  dx: number,
  dy: number,
) {
  const node = wrapper.findAll('[data-testid="member-node"]')[memberIndex]
  await node.trigger('pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 600,
    clientY: 100,
  })
  await node.trigger('pointermove', {
    pointerId: 1,
    clientX: 600 + dx,
    clientY: 100 + dy,
  })
  return node
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

describe('FamilyCanvas', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    focusStagePoint.mockReset()
    getScale.mockReset()
    getScale.mockReturnValue(1)
    layoutFamilyTree.mockReset()
    layoutFamilyTree.mockResolvedValue(structuredClone(coupleScene))
  })

  it('renders a couple as one family background with two local member cards and its hub', async () => {
    const members = [mk('A'), mk('B')]
    const wrapper = mountCanvas(familyData(members))
    await flushPromises()

    const units = wrapper.findAll('[data-testid="family-unit"]')
    const nodes = wrapper.findAll('[data-testid="member-node"]')
    const hub = wrapper.find('[data-testid="union-hub"]')

    expect(units).toHaveLength(1)
    expect(nodes).toHaveLength(2)
    expect(hub.exists()).toBe(true)
    expect(units[0].element.contains(nodes[0].element)).toBe(true)
    expect(units[0].element.contains(nodes[1].element)).toBe(true)
    expect(units[0].attributes('style')).toContain('translate(48px, 24px)')
    expect(wrapper.find('[data-testid="spouse-axis"]').attributes('style')).toContain(familyAccent)
  })

  it('keeps every route owner in its own SVG group and preserves segment accents', async () => {
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    const owners = wrapper.findAll('g[data-route-owner]')
    expect(owners).toHaveLength(2)
    expect(owners.map(owner => owner.attributes('data-route-owner'))).toEqual([
      'parentage:other',
      'parentage:parents',
    ])
    const parentRoute = wrapper.find('g[data-route-owner="parentage:parents"]')
    expect(parentRoute.findAll('path')).toHaveLength(2)
    expect(parentRoute.find('path').attributes('stroke')).toBe(familyAccent)
    expect(wrapper.find('g[data-route-owner="parentage:other"] path').attributes('stroke'))
      .toBe('#d6578b')
    expect(parentRoute.findAll('path')[1].attributes('d')).toBe(
      'M 228 300 Q 240 288 252 300',
    )
  })

  it('groups multiple routes for one owner into one stable SVG group', async () => {
    const scene = structuredClone(coupleScene)
    scene.routes = [{
      id: 'route:z',
      routeOwnerId: 'owner:z',
      kind: 'primary',
      accent: '#999999',
      segments: [{ orientation: 'horizontal', points: [{ x: 0, y: 30 }, { x: 10, y: 30 }] }],
    }, {
      id: 'route:a-2',
      routeOwnerId: 'owner:a',
      kind: 'primary',
      accent: '#222222',
      segments: [{ orientation: 'horizontal', points: [{ x: 0, y: 20 }, { x: 10, y: 20 }] }],
    }, {
      id: 'route:a-1',
      routeOwnerId: 'owner:a',
      kind: 'primary',
      accent: '#111111',
      segments: [{ orientation: 'horizontal', points: [{ x: 0, y: 10 }, { x: 10, y: 10 }] }],
    }]
    layoutFamilyTree.mockResolvedValueOnce(scene)

    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    const owners = wrapper.findAll('g[data-route-owner]')
    expect(owners.map(owner => owner.attributes('data-route-owner'))).toEqual([
      'owner:a',
      'owner:z',
    ])
    expect(owners[0].findAll('path').map(path => path.attributes('stroke'))).toEqual([
      '#111111',
      '#222222',
    ])
    expect(owners[0].findAll('path')).toHaveLength(2)
  })

  it('preserves select and open events from member cards', async () => {
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    const nodes = wrapper.findAll('[data-testid="member-node"]')
    await nodes[0].trigger('click')
    await nodes[1].trigger('dblclick')

    expect(wrapper.emitted('select')).toEqual([['A']])
    expect(wrapper.emitted('open')).toEqual([['B']])
  })

  it('shows the empty state for an empty scene', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(emptyScene))
    const wrapper = mountCanvas(familyData([]))
    await flushPromises()

    expect(wrapper.text()).toContain('暂无成员')
    expect(wrapper.find('[data-testid="family-unit"]').exists()).toBe(false)
  })

  it('shows dismissible layout diagnostics instead of silently hiding failed routes', async () => {
    const scene = structuredClone(coupleScene)
    scene.routes = []
    scene.diagnostics = [{
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: ['parentage:A+B'],
      message: 'Unable to route parentage:A+B without crossing a card',
    }]
    layoutFamilyTree.mockResolvedValueOnce(scene)

    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    const banner = wrapper.get('[data-testid="layout-diagnostics"]')
    expect(banner.text()).toContain('连线路由已降级')
    expect(banner.text()).toContain('Unable to route parentage:A+B without crossing a card')

    await banner.get('button').trigger('click')
    expect(wrapper.find('[data-testid="layout-diagnostics"]').exists()).toBe(false)
  })

  it('passes complete family data to the facade', async () => {
    const members = [mk('A')]
    const data = familyData(members)
    mountCanvas(data)
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledWith(members, {
      data,
      view: {
        showHistoricalPartnerships: false,
        showSecondaryParentage: false,
        showGodparentRelations: false,
      },
    })
  })

  it('recomputes only auxiliary routing when its toggle or selected focus changes', async () => {
    const data = familyData([mk('A'), mk('B')])
    const wrapper = mountCanvas(data, {
      selectedId: 'A',
      viewpointId: 'B',
      showAuxiliaryRelations: false,
    })
    await flushPromises()
    focusStagePoint.mockClear()

    expect(layoutFamilyTree).toHaveBeenLastCalledWith(Object.values(data.members), {
      data,
      view: {
        showHistoricalPartnerships: false,
        showSecondaryParentage: false,
        showGodparentRelations: false,
      },
    })

    await wrapper.setProps({ showAuxiliaryRelations: true })
    await flushPromises()
    expect(layoutFamilyTree).toHaveBeenLastCalledWith(Object.values(data.members), {
      data,
      view: {
        showHistoricalPartnerships: true,
        showSecondaryParentage: true,
        showGodparentRelations: true,
      },
      auxiliaryFocusPersonId: 'A',
    })

    await wrapper.setProps({ selectedId: 'B' })
    await flushPromises()
    expect(layoutFamilyTree).toHaveBeenLastCalledWith(Object.values(data.members), {
      data,
      view: {
        showHistoricalPartnerships: true,
        showSecondaryParentage: true,
        showGodparentRelations: true,
      },
      auxiliaryFocusPersonId: 'B',
    })
    expect(focusStagePoint).not.toHaveBeenCalled()
  })

  it('queues one auxiliary refresh until a pending drop scene is accepted', async () => {
    const dropped = deferred<LayoutScene>()
    const auxiliary = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(dropped.promise)
      .mockReturnValueOnce(auxiliary.promise)
    const { wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
      { viewpointId: 'A' },
    )
    await flushPromises()
    focusStagePoint.mockClear()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    await wrapper.setProps({ showAuxiliaryRelations: true, selectedId: 'A' })
    await wrapper.setProps({ selectedId: 'B' })
    await nextTick()
    expect(layoutFamilyTree).toHaveBeenCalledTimes(2)

    const droppedScene = structuredClone(sortableScene)
    droppedScene.rows[0].unitIds = [
      'unit:person:C',
      'unit:person:A',
      'unit:person:B',
    ]
    droppedScene.units[0].rect.x = 240
    droppedScene.units[1].rect.x = 480
    droppedScene.units[2].rect.x = 0
    droppedScene.cards[0].rect.x = 240
    droppedScene.cards[1].rect.x = 480
    droppedScene.cards[2].rect.x = 0
    dropped.resolve(droppedScene)
    await flushPromises()
    expect(focusStagePoint).not.toHaveBeenCalled()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
    expect(layoutFamilyTree.mock.calls[2][1]).toMatchObject({
      previousScene: droppedScene,
      changedIds: [],
      auxiliaryFocusPersonId: 'B',
      view: {
        showHistoricalPartnerships: true,
        showSecondaryParentage: true,
        showGodparentRelations: true,
      },
    })
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)

    const auxiliaryScene = structuredClone(droppedScene)
    auxiliaryScene.routes.push({
      id: 'route:aux:A+B',
      routeOwnerId: 'aux:A+B',
      kind: 'historical-partnership',
      accent: '#64748b',
      segments: [{
        orientation: 'horizontal',
        points: [{ x: 0, y: 104 }, { x: 48, y: 104 }],
      }],
    })
    auxiliary.resolve(auxiliaryScene)
    await flushPromises()
    expect(focusStagePoint).not.toHaveBeenCalled()

    expect(wrapper.findAll('[data-testid="family-unit"]')
      .map(unit => unit.attributes('style'))).toEqual([
      expect.stringContaining('translate(240px, 0px)'),
      expect.stringContaining('translate(480px, 0px)'),
      expect.stringContaining('translate(0px, 0px)'),
      expect.stringContaining('translate(0px, 360px)'),
    ])
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('flushes one queued auxiliary refresh after an active drag is cancelled', async () => {
    const auxiliary = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(auxiliary.promise)
    const { wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await wrapper.setProps({ showAuxiliaryRelations: true, selectedId: 'B' })
    await nextTick()
    expect(layoutFamilyTree).toHaveBeenCalledTimes(1)

    await node.trigger('pointercancel', { pointerId: 1 })
    await nextTick()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(2)
    expect(layoutFamilyTree.mock.calls[1][1]).toMatchObject({
      previousScene: sortableScene,
      changedIds: [],
      auxiliaryFocusPersonId: 'B',
    })
    auxiliary.resolve(structuredClone(sortableScene))
    await flushPromises()
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('dashes only auxiliary routes with the specified pattern', async () => {
    const scene = structuredClone(coupleScene)
    scene.routes.push({
      id: 'route:aux:A+B',
      routeOwnerId: 'aux:A+B',
      kind: 'historical-partnership',
      accent: '#64748b',
      segments: [{
        orientation: 'horizontal',
        points: [{ x: 0, y: 108 }, { x: 48, y: 108 }],
      }],
    })
    layoutFamilyTree.mockResolvedValueOnce(scene)

    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    expect(wrapper.get('[data-route-id="route:aux:A+B"]').attributes('stroke-dasharray'))
      .toBe('8 6')
    expect(wrapper.get('[data-route-id="route:parents"]').attributes('stroke-dasharray'))
      .toBeUndefined()
  })

  it('renders every member from the single data source', async () => {
    const members = [mk('A'), mk('B')]
    const wrapper = mountCanvas(familyData(members))
    await flushPromises()

    expect(wrapper.findAll('[data-testid="member-node"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('B')
  })

  it('uses data members rather than pending scene state for the empty message', async () => {
    const pending = deferred<LayoutScene>()
    layoutFamilyTree.mockReturnValueOnce(pending.promise)
    const data = familyData([mk('A'), mk('B')])

    const wrapper = mountCanvas(data)
    await nextTick()

    expect(wrapper.text()).not.toContain('暂无成员')
  })

  it('ignores stale async layout results', async () => {
    const first = deferred<LayoutScene>()
    const second = deferred<LayoutScene>()
    layoutFamilyTree
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const firstMembers = [mk('A'), mk('B')]
    const wrapper = mountCanvas(familyData(firstMembers))
    await nextTick()

    const nextMembers = [mk('C')]
    const nextData = familyData(nextMembers)
    await wrapper.setProps({ data: nextData })
    const nextScene = structuredClone(coupleScene)
    nextScene.units[0].memberIds = ['C']
    nextScene.units[0].kind = 'single'
    nextScene.cards = [{
      id: 'C',
      unitId: nextScene.units[0].id,
      generation: 0,
      rect: { x: 48, y: 24, width: 168, height: 216 },
    }]
    second.resolve(nextScene)
    await flushPromises()
    first.resolve(structuredClone(coupleScene))
    await flushPromises()

    expect(wrapper.findAll('[data-testid="member-node"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('C')
    expect(wrapper.text()).not.toContain('A')
  })

  it('focuses a changed viewpoint at the pixel card center', async () => {
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]))
    await flushPromises()

    await wrapper.setProps({ viewpointId: 'B' })
    await nextTick()

    expect(focusStagePoint).toHaveBeenCalledWith(364, 172)
  })

  it('focuses the latest viewpoint after the accepted async scene and never from a stale scene', async () => {
    const stale = deferred<LayoutScene>()
    const accepted = deferred<LayoutScene>()
    layoutFamilyTree
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(accepted.promise)
    const firstData = familyData([mk('A'), mk('B')])
    const wrapper = mountCanvas(firstData, { viewpointId: 'A' })
    await nextTick()

    await wrapper.setProps({ viewpointId: 'B' })
    await wrapper.setProps({ data: structuredClone(firstData) })
    stale.resolve(structuredClone(coupleScene))
    await flushPromises()
    expect(focusStagePoint).not.toHaveBeenCalled()

    accepted.resolve(structuredClone(coupleScene))
    await flushPromises()
    expect(focusStagePoint).toHaveBeenCalledTimes(1)
    expect(focusStagePoint).toHaveBeenCalledWith(364, 172)
  })

  it('does not override a restored initial pan and zoom when the first scene arrives', async () => {
    const pending = deferred<LayoutScene>()
    layoutFamilyTree.mockReturnValueOnce(pending.promise)
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]), {
      viewpointId: 'A',
      initialView: { x: 10, y: 20, scale: 1.5 },
    })
    await nextTick()

    pending.resolve(structuredClone(coupleScene))
    await flushPromises()

    expect(focusStagePoint).not.toHaveBeenCalled()

    await wrapper.setProps({ viewpointId: 'B' })
    await nextTick()

    expect(focusStagePoint).toHaveBeenCalledTimes(1)
    expect(focusStagePoint).toHaveBeenCalledWith(364, 172)
  })

  it('focuses the first viewpoint chosen after restoring with no initial viewpoint', async () => {
    const pending = deferred<LayoutScene>()
    layoutFamilyTree.mockReturnValueOnce(pending.promise)
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]), {
      viewpointId: null,
      initialView: { x: 10, y: 20, scale: 1.5 },
    })
    await nextTick()

    pending.resolve(structuredClone(coupleScene))
    await flushPromises()
    expect(focusStagePoint).not.toHaveBeenCalled()

    await wrapper.setProps({ viewpointId: 'B' })
    await nextTick()

    expect(focusStagePoint).toHaveBeenCalledTimes(1)
    expect(focusStagePoint).toHaveBeenCalledWith(364, 172)
  })

  it('preserves viewpoint kinship labels on member cards', async () => {
    const getKinship = vi.fn((fromId: string, toId: string) => (
      fromId === 'A' && toId === 'B' ? '配偶' : null
    ))
    const wrapper = mountCanvas(familyData([mk('A'), mk('B')]), {
      viewpointId: 'A',
      getKinship,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('配偶')
    expect(getKinship).toHaveBeenCalledWith('A', 'B')
  })

  it('previews a same-row insertion with a dragged overlay and only incident route fading', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(sortableScene))
    const { wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()

    await beginDrag(wrapper, 2, -500, 0)

    const units = wrapper.findAll('[data-testid="family-unit"]')
    expect(units[0].attributes('style')).toContain('translate(240px, 0px)')
    expect(units[1].attributes('style')).toContain('translate(480px, 0px)')
    expect(units[2].attributes('style')).toContain('translate(-20px, 0px)')
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').attributes('style'))
      .toContain('opacity: 0.35')
    expect(wrapper.find('[data-route-id="route:C"]').attributes('style')).toContain('opacity: 0.25')
    expect(wrapper.find('[data-route-id="route:other"]').attributes('style')).toBeUndefined()
  })

  it('converts screen drag deltas to stage coordinates with the current scale', async () => {
    getScale.mockReturnValue(2)
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(sortableScene))
    const { wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()

    await beginDrag(wrapper, 2, -400, 20)

    expect(wrapper.findAll('[data-testid="family-unit"]')[2].attributes('style'))
      .toContain('translate(280px, 10px)')
  })

  it('packs unequal-width preview units without reusing overlapping old slots', async () => {
    const scene = structuredClone(sortableScene)
    const [a, b, c] = scene.units
    a.width = a.rect.width = 100
    b.width = b.rect.width = 300
    c.width = c.rect.width = 100
    a.rect.x = 0
    b.rect.x = 172
    c.rect.x = 544
    scene.cards[0].rect = { x: 0, y: 0, width: 100, height: 216 }
    scene.cards[1].rect = { x: 172, y: 0, width: 300, height: 216 }
    scene.cards[2].rect = { x: 544, y: 0, width: 100, height: 216 }
    layoutFamilyTree.mockResolvedValueOnce(scene)
    const { wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()

    await beginDrag(wrapper, 0, 700, 0)

    const units = wrapper.findAll('[data-testid="family-unit"]')
    expect(units[1].attributes('style')).toContain('translate(0px, 0px)')
    expect(units[2].attributes('style')).toContain('translate(372px, 0px)')
    expect(300).toBeLessThanOrEqual(372)
  })

  it('persists the complete row and requests local reflow from the previous scene', async () => {
    const previousScene = structuredClone(sortableScene)
    previousScene.units[2].kind = 'couple'
    previousScene.units[2].memberIds = ['C', 'E']
    const nextScene = structuredClone(sortableScene)
    nextScene.units[2].kind = 'couple'
    nextScene.units[2].memberIds = ['C', 'E']
    nextScene.rows[0].unitIds = ['unit:person:C', 'unit:person:A', 'unit:person:B']
    nextScene.units = [nextScene.units[2], nextScene.units[0], nextScene.units[1], nextScene.units[3]]
    nextScene.units[0].rect.x = 0
    nextScene.units[1].rect.x = 240
    nextScene.units[2].rect.x = 480
    const pending = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(previousScene)
      .mockReturnValueOnce(pending.promise)
    const c = mk('C')
    c.parents = [{ id: 'P', type: 'blood' }]
    c.children = [{ id: 'K', type: 'blood' }]
    const e = mk('E')
    e.parents = [
      { id: 'P', type: 'blood' },
      { id: 'Q', type: 'blood' },
    ]
    e.children = [{ id: 'K', type: 'blood' }]
    const { family, wrapper } = mountStoreCanvas(familyData([
      mk('A'), mk('B'), c, mk('D'), e, mk('P'), mk('Q'), mk('K'),
    ]))
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    expect(family.data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    })
    expect(family.data.manualPositions).toEqual({})
    expect(family.data.gridLayoutOverrides).toEqual({})
    expect(layoutFamilyTree).toHaveBeenCalledTimes(2)
    expect(layoutFamilyTree).toHaveBeenLastCalledWith(Object.values(family.data.members), {
      data: family.data,
      view: {
        showHistoricalPartnerships: false,
        showSecondaryParentage: false,
        showGodparentRelations: false,
      },
      previousScene,
      changedIds: ['C', 'E', 'K', 'P', 'Q'].sort((left, right) => left.localeCompare(right)),
    })
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(true)

    pending.resolve(nextScene)
    await flushPromises()

    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('collects sorted changed ids from both sides of one-sided couple relations', async () => {
    const scene = structuredClone(sortableScene)
    scene.units[2].kind = 'couple'
    scene.units[2].memberIds = ['C', 'E']
    layoutFamilyTree
      .mockResolvedValueOnce(scene)
      .mockResolvedValueOnce(structuredClone(scene))
    const c = mk('C')
    c.parents = [{ id: 'P-direct', type: 'blood' }]
    c.children = [{ id: 'K-direct', type: 'blood' }]
    const e = mk('E')
    const parentOnly = mk('parent-only')
    parentOnly.children = [{ id: 'C', type: 'blood' }]
    const childOnly = mk('child-only')
    childOnly.parents = [{ id: 'E', type: 'blood' }]
    const { wrapper } = mountStoreCanvas(familyData([
      childOnly,
      mk('A'),
      parentOnly,
      mk('B'),
      c,
      e,
      mk('D'),
      mk('P-direct'),
      mk('K-direct'),
    ]))
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await flushPromises()

    expect(layoutFamilyTree.mock.calls[1][1].changedIds).toEqual([
      'C',
      'E',
      'P-direct',
      'K-direct',
      'parent-only',
      'child-only',
    ].sort((left, right) => left.localeCompare(right)))
  })

  it('emits row order and lays out a pure next data snapshot without writing an injected store', async () => {
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockResolvedValueOnce(structuredClone(sortableScene))
    const externalData = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
    const before = structuredClone(externalData)
    const wrongStoreData = familyData([mk('wrong')])
    const { family, wrapper } = mountDetachedCanvas(externalData, wrongStoreData)
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await flushPromises()

    expect(wrapper.emitted('row-order-change')).toEqual([[
      'row:0',
      ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    ]])
    expect(family.data.layoutPreferences.rowOrders).toEqual([])
    expect(externalData).toEqual(before)
    const options = layoutFamilyTree.mock.calls[1][1]
    expect(options.data).not.toBe(externalData)
    expect(options.data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    })

    const laterData = structuredClone(externalData)
    laterData.members.X = mk('X')
    laterData.layoutPreferences.rowOrders = [{
      id: 'row:0',
      unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    }]
    await wrapper.setProps({ data: laterData })
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
  })

  it('keeps the current viewport after an accepted family drop', async () => {
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockResolvedValueOnce(structuredClone(sortableScene))
    const { wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
      { viewpointId: 'A' },
    )
    await flushPromises()
    focusStagePoint.mockClear()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await flushPromises()

    expect(focusStagePoint).not.toHaveBeenCalled()
  })

  it('does not let a stale drop layout clear the active drag state', async () => {
    const stale = deferred<LayoutScene>()
    const accepted = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(accepted.promise)
    const data = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
    const { wrapper } = mountStoreCanvas(data)
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()
    await wrapper.setProps({ data: structuredClone(data) })
    await nextTick()

    stale.resolve(structuredClone(sortableScene))
    await flushPromises()
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(true)

    accepted.resolve(structuredClone(sortableScene))
    await flushPromises()
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('keeps a new drag scene and preview when an older drop layout resolves', async () => {
    const oldDrop = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(oldDrop.promise)
    const { wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()
    await beginDrag(wrapper, 1, 300, 0)
    const beforeResolve = wrapper.findAll('[data-testid="family-unit"]')[1].attributes('style')
    expect(beforeResolve).toContain('translate(540px, 0px)')

    const staleScene = structuredClone(sortableScene)
    staleScene.units[1].rect.x = 900
    staleScene.cards[1].rect.x = 900
    oldDrop.resolve(staleScene)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="family-unit"]')[1].attributes('style'))
      .toContain('translate(540px, 0px)')
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').attributes('style'))
      .toContain('translate(240px, 0px)')
  })

  it('recovers the persisted scene after a superseding drag is cancelled', async () => {
    const firstDrop = deferred<LayoutScene>()
    const replacement = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(firstDrop.promise)
      .mockReturnValueOnce(replacement.promise)
    const { family, wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()
    expect(family.data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    })

    const secondNode = await beginDrag(wrapper, 1, 300, 0)
    await secondNode.trigger('pointercancel', { pointerId: 1 })
    await nextTick()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
    expect(layoutFamilyTree.mock.calls[2][1]).toMatchObject({
      data: {
        layoutPreferences: {
          rowOrders: [{
            id: 'row:0',
            unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
          }],
        },
      },
      previousScene: sortableScene,
      changedIds: ['C'],
    })

    const staleScene = structuredClone(sortableScene)
    staleScene.units[0].rect.x = 900
    staleScene.cards[0].rect.x = 900
    firstDrop.resolve(staleScene)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(0px, 0px)')

    const recoveredScene = structuredClone(sortableScene)
    recoveredScene.rows[0].unitIds = [
      'unit:person:C',
      'unit:person:A',
      'unit:person:B',
    ]
    recoveredScene.units[0].rect.x = 240
    recoveredScene.units[1].rect.x = 480
    recoveredScene.units[2].rect.x = 0
    recoveredScene.cards[0].rect.x = 240
    recoveredScene.cards[1].rect.x = 480
    recoveredScene.cards[2].rect.x = 0
    replacement.resolve(recoveredScene)
    await flushPromises()

    const units = wrapper.findAll('[data-testid="family-unit"]')
    expect(units[0].attributes('style')).toContain('translate(240px, 0px)')
    expect(units[1].attributes('style')).toContain('translate(480px, 0px)')
    expect(units[2].attributes('style')).toContain('translate(0px, 0px)')
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('lets a valid superseding drop replace recovery without another layout request', async () => {
    const firstDrop = deferred<LayoutScene>()
    const secondDrop = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(firstDrop.promise)
      .mockReturnValueOnce(secondDrop.promise)
    const { family, wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    const secondNode = await beginDrag(wrapper, 1, 500, 0)
    await secondNode.trigger('pointerup', { pointerId: 1, clientX: 1100, clientY: 100 })
    await nextTick()

    expect(family.data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:A', 'unit:person:C', 'unit:person:B'],
    })
    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
    expect(layoutFamilyTree.mock.calls[2][1].data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:A', 'unit:person:C', 'unit:person:B'],
    })

    const staleScene = structuredClone(sortableScene)
    staleScene.units[1].rect.x = 900
    staleScene.cards[1].rect.x = 900
    firstDrop.resolve(staleScene)
    await flushPromises()
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(true)

    const acceptedScene = structuredClone(sortableScene)
    acceptedScene.rows[0].unitIds = [
      'unit:person:A',
      'unit:person:C',
      'unit:person:B',
    ]
    acceptedScene.units[1].rect.x = 480
    acceptedScene.units[2].rect.x = 240
    acceptedScene.cards[1].rect.x = 480
    acceptedScene.cards[2].rect.x = 240
    secondDrop.resolve(acceptedScene)
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('[data-testid="family-unit"]')[1].attributes('style'))
      .toContain('translate(480px, 0px)')
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('clears pending recovery when a newer normal data layout is accepted', async () => {
    const firstDrop = deferred<LayoutScene>()
    const normalLayout = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(firstDrop.promise)
      .mockReturnValueOnce(normalLayout.promise)
    const { family, wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    const normalData = familyData([mk('A'), mk('B'), mk('C'), mk('D'), mk('X')])
    normalData.layoutPreferences.rowOrders = [{
      id: 'row:0',
      unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
    }]
    await wrapper.setProps({ data: normalData })
    await nextTick()

    const acceptedScene = structuredClone(sortableScene)
    acceptedScene.rows[0].unitIds = [
      'unit:person:C',
      'unit:person:A',
      'unit:person:B',
    ]
    acceptedScene.units[0].rect.x = 240
    acceptedScene.units[1].rect.x = 480
    acceptedScene.units[2].rect.x = 0
    acceptedScene.cards[0].rect.x = 240
    acceptedScene.cards[1].rect.x = 480
    acceptedScene.cards[2].rect.x = 0
    normalLayout.resolve(acceptedScene)
    await flushPromises()

    const staleScene = structuredClone(sortableScene)
    staleScene.units[0].rect.x = 900
    staleScene.cards[0].rect.x = 900
    firstDrop.resolve(staleScene)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(240px, 0px)')

    const futureNode = await beginDrag(wrapper, 0, 100, 0)
    await futureNode.trigger('pointercancel', { pointerId: 1 })
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(3)
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('reissues recovery when its pending replacement is superseded and cancelled', async () => {
    const firstDrop = deferred<LayoutScene>()
    const firstReplacement = deferred<LayoutScene>()
    const secondReplacement = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(firstDrop.promise)
      .mockReturnValueOnce(firstReplacement.promise)
      .mockReturnValueOnce(secondReplacement.promise)
    const { wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    const secondNode = await beginDrag(wrapper, 1, 300, 0)
    await secondNode.trigger('pointercancel', { pointerId: 1 })
    await nextTick()

    const thirdNode = await beginDrag(wrapper, 0, 300, 0)
    await thirdNode.trigger('pointercancel', { pointerId: 1 })
    await nextTick()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(4)
    expect(layoutFamilyTree.mock.calls[3][1]).toMatchObject({
      data: {
        layoutPreferences: {
          rowOrders: [{
            id: 'row:0',
            unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
          }],
        },
      },
      previousScene: sortableScene,
      changedIds: ['C'],
    })

    const staleReplacementScene = structuredClone(sortableScene)
    staleReplacementScene.units[0].rect.x = 900
    staleReplacementScene.cards[0].rect.x = 900
    firstReplacement.resolve(staleReplacementScene)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(0px, 0px)')

    const recoveredScene = structuredClone(sortableScene)
    recoveredScene.rows[0].unitIds = [
      'unit:person:C',
      'unit:person:A',
      'unit:person:B',
    ]
    recoveredScene.units[0].rect.x = 240
    recoveredScene.units[1].rect.x = 480
    recoveredScene.units[2].rect.x = 0
    recoveredScene.cards[0].rect.x = 240
    recoveredScene.cards[1].rect.x = 480
    recoveredScene.cards[2].rect.x = 0
    secondReplacement.resolve(recoveredScene)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(240px, 0px)')

    const futureNode = await beginDrag(wrapper, 0, 100, 0)
    await futureNode.trigger('pointercancel', { pointerId: 1 })
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(4)
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('keeps a third valid drop newer than its pending replacement', async () => {
    const firstDrop = deferred<LayoutScene>()
    const replacement = deferred<LayoutScene>()
    const thirdDrop = deferred<LayoutScene>()
    layoutFamilyTree
      .mockResolvedValueOnce(structuredClone(sortableScene))
      .mockReturnValueOnce(firstDrop.promise)
      .mockReturnValueOnce(replacement.promise)
      .mockReturnValueOnce(thirdDrop.promise)
    const { family, wrapper } = mountStoreCanvas(
      familyData([mk('A'), mk('B'), mk('C'), mk('D')]),
    )
    await flushPromises()

    const firstNode = await beginDrag(wrapper, 2, -500, 0)
    await firstNode.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    await nextTick()

    const secondNode = await beginDrag(wrapper, 1, 300, 0)
    await secondNode.trigger('pointercancel', { pointerId: 1 })
    await nextTick()

    const thirdNode = await beginDrag(wrapper, 0, 700, 0)
    const staleReplacementScene = structuredClone(sortableScene)
    staleReplacementScene.units[0].rect.x = 900
    staleReplacementScene.cards[0].rect.x = 900
    replacement.resolve(staleReplacementScene)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(700px, 0px)')

    await thirdNode.trigger('pointerup', { pointerId: 1, clientX: 1300, clientY: 100 })
    await nextTick()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(4)
    expect(family.data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:B', 'unit:person:C', 'unit:person:A'],
    })
    expect(layoutFamilyTree.mock.calls[3][1].data.layoutPreferences.rowOrders).toContainEqual({
      id: 'row:0',
      unitIds: ['unit:person:B', 'unit:person:C', 'unit:person:A'],
    })

    const acceptedScene = structuredClone(sortableScene)
    acceptedScene.rows[0].unitIds = [
      'unit:person:B',
      'unit:person:C',
      'unit:person:A',
    ]
    acceptedScene.units[0].rect.x = 480
    acceptedScene.units[1].rect.x = 0
    acceptedScene.units[2].rect.x = 240
    acceptedScene.cards[0].rect.x = 480
    acceptedScene.cards[1].rect.x = 0
    acceptedScene.cards[2].rect.x = 240
    thirdDrop.resolve(acceptedScene)
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledTimes(4)
    expect(wrapper.findAll('[data-testid="family-unit"]')[0].attributes('style'))
      .toContain('translate(480px, 0px)')
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('rejects a large vertical drag toward another generation', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(sortableScene))
    const { family, wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()

    const node = await beginDrag(wrapper, 2, -500, 0)
    await node.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 500 })
    await flushPromises()

    expect(family.data.layoutPreferences.rowOrders).toEqual([])
    expect(layoutFamilyTree).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  })

  it('does not forward a drop for pointer cancel or pointer up before an actual drag', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(sortableScene))
    const { family, wrapper } = mountStoreCanvas(familyData([mk('A'), mk('B'), mk('C'), mk('D')]))
    await flushPromises()
    const node = wrapper.findAll('[data-testid="member-node"]')[2]

    await node.trigger('pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 600,
      clientY: 100,
    })
    await node.trigger('pointerup', { pointerId: 1, clientX: 601, clientY: 100 })
    await node.trigger('pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 2,
      clientX: 600,
      clientY: 100,
    })
    await node.trigger('pointercancel', { pointerId: 2 })
    await flushPromises()

    expect(family.data.layoutPreferences.rowOrders).toEqual([])
    expect(layoutFamilyTree).toHaveBeenCalledTimes(1)
  })
})
