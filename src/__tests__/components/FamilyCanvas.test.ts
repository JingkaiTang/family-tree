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

const { focusStagePoint, layoutFamilyTree } = vi.hoisted(() => ({
  focusStagePoint: vi.fn(),
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
      getScale: vi.fn(() => 1),
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

function familyData(members: Member[]): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(member => [member.id, member])),
  }
}

function mountCanvas(members: Member[], data = familyData(members), props = {}) {
  return mount(FamilyCanvas, {
    props: { members, data, ...props },
    global: {
      plugins: [createPinia()],
      stubs: { PanZoomWrapper: PanZoomStub },
    },
  })
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
    layoutFamilyTree.mockReset()
    layoutFamilyTree.mockResolvedValue(structuredClone(coupleScene))
  })

  it('renders a couple as one family background with two local member cards and its hub', async () => {
    const members = [mk('A'), mk('B')]
    const wrapper = mountCanvas(members)
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
    const wrapper = mountCanvas([mk('A'), mk('B')])
    await flushPromises()

    const owners = wrapper.findAll('g[data-route-owner]')
    expect(owners).toHaveLength(2)
    expect(owners.map(owner => owner.attributes('data-route-owner'))).toEqual([
      'parentage:parents',
      'parentage:other',
    ])
    expect(owners[0].findAll('path')).toHaveLength(2)
    expect(owners[0].find('path').attributes('stroke')).toBe(familyAccent)
    expect(owners[1].find('path').attributes('stroke')).toBe('#d6578b')
    expect(owners[0].findAll('path')[1].attributes('d')).toBe(
      'M 228 300 Q 240 288 252 300',
    )
  })

  it('preserves select and open events from member cards', async () => {
    const wrapper = mountCanvas([mk('A'), mk('B')])
    await flushPromises()

    const nodes = wrapper.findAll('[data-testid="member-node"]')
    await nodes[0].trigger('click')
    await nodes[1].trigger('dblclick')

    expect(wrapper.emitted('select')).toEqual([['A']])
    expect(wrapper.emitted('open')).toEqual([['B']])
  })

  it('shows the empty state for an empty scene', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(emptyScene))
    const wrapper = mountCanvas([])
    await flushPromises()

    expect(wrapper.text()).toContain('暂无成员')
    expect(wrapper.find('[data-testid="family-unit"]').exists()).toBe(false)
  })

  it('passes complete family data to the facade', async () => {
    const members = [mk('A')]
    const data = familyData(members)
    mountCanvas(members, data)
    await flushPromises()

    expect(layoutFamilyTree).toHaveBeenCalledWith(members, { data })
  })

  it('ignores stale async layout results', async () => {
    const first = deferred<LayoutScene>()
    const second = deferred<LayoutScene>()
    layoutFamilyTree
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const firstMembers = [mk('A'), mk('B')]
    const wrapper = mountCanvas(firstMembers)
    await nextTick()

    const nextMembers = [mk('C')]
    const nextData = familyData(nextMembers)
    await wrapper.setProps({ members: nextMembers, data: nextData })
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
    const wrapper = mountCanvas([mk('A'), mk('B')])
    await flushPromises()

    await wrapper.setProps({ viewpointId: 'B' })
    await nextTick()

    expect(focusStagePoint).toHaveBeenCalledWith(364, 172)
  })

  it('preserves viewpoint kinship labels on member cards', async () => {
    const getKinship = vi.fn((fromId: string, toId: string) => (
      fromId === 'A' && toId === 'B' ? '配偶' : null
    ))
    const wrapper = mountCanvas([mk('A'), mk('B')], undefined, {
      viewpointId: 'A',
      getKinship,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('配偶')
    expect(getKinship).toHaveBeenCalledWith('A', 'B')
  })
})
