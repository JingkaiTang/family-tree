/**
 * @vitest-environment happy-dom
 *
 * FamilyCanvas 组件集成测试
 * 覆盖：空状态渲染、孤儿提示、SVG 连线、select/open 事件
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import FamilyCanvas from '@/components/tree/FamilyCanvas.vue'
import { mk } from '@/__tests__/fixtures/families'
import type { Member } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'

// 模拟 layoutFamilyTree 返回预计算结果，避免依赖真实 ELK 布局
const { layoutFamilyTree, layoutProtagonist } = vi.hoisted(() => ({
  layoutFamilyTree: vi.fn(),
  layoutProtagonist: vi.fn(),
}))

vi.mock('@/core/treeLayout', () => ({
  layoutFamilyTree,
}))

vi.mock('@/core/protagonistLayout', () => ({
  layoutProtagonist,
}))

const PanZoomStub = defineComponent({
  name: 'PanZoomWrapper',
  props: ['initialView'],
  emits: ['view-change'],
  setup(_, { expose, slots }) {
    expose({
      focusStagePoint: vi.fn(),
      getScale: vi.fn(() => 1),
    })
    return () => h('div', slots.default?.())
  },
})

// 默认 mock：带孤儿节点
const defaultLayout = {
  nodes: [
    { id: 'A', cx: 2, top: 0, generation: 0 },
    { id: 'B', cx: 2, top: 4, generation: 1 },
  ],
  couples: [],
  connectors: [
    { kind: 'parent-child', points: [{ x: 2, y: 1 }, { x: 2, y: 4 }] },
  ],
  canvas: { width: 4, height: 6 },
  orphanIds: ['orphan-1'],
  offsetX: 0,
}

const emptyLayout = {
  nodes: [],
  couples: [],
  connectors: [],
  canvas: { width: 0, height: 0 },
  orphanIds: [],
  offsetX: 0,
}

function makeFamily(ids: string[]): Member[] {
  return ids.map((id) => mk(id, { gender: 'male' }))
}

describe('FamilyCanvas', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    layoutFamilyTree.mockResolvedValue(structuredClone(defaultLayout))
    layoutProtagonist.mockResolvedValue({
      nodes: [{ id: 'A', cx: 2, top: 0, generation: 0 }],
      couples: [],
      connectors: [],
      canvas: { width: 4, height: 2 },
      orphanIds: [],
      offsetX: 0,
    })
  })

  // ========== 空状态 ==========
  it('无成员时显示空状态提示', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(emptyLayout))

    const wrapper = mount(FamilyCanvas, {
      props: { members: [] },
      global: {
        plugins: [createPinia()],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('暂无成员')
  })

  // ========== 孤儿提示 ==========
  it('有孤儿节点时显示提示并包含数量', async () => {
    const wrapper = mount(FamilyCanvas, {
      props: { members: makeFamily(['A', 'B']) },
      global: {
        plugins: [createPinia()],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('1 位成员未显示')
  })

  // ========== SVG 连线 ==========
  it('有连线时渲染 SVG polyline', async () => {
    const wrapper = mount(FamilyCanvas, {
      props: { members: makeFamily(['A', 'B']) },
      global: {
        plugins: [createPinia()],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()
    const polyline = wrapper.find('polyline')
    expect(polyline.exists()).toBe(true)
  })

  // ========== 无连线时无 polyline ==========
  it('无布局时不渲染连线', async () => {
    layoutFamilyTree.mockResolvedValueOnce(structuredClone(emptyLayout))

    const wrapper = mount(FamilyCanvas, {
      props: { members: [] },
      global: {
        plugins: [createPinia()],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()
    expect(wrapper.find('polyline').exists()).toBe(false)
  })

  // ========== 孤儿无提示 ==========
  it('无孤儿时不显示孤儿提示', async () => {
    layoutProtagonist.mockResolvedValueOnce({
      nodes: [{ id: 'A', cx: 2, top: 0, generation: 0 }],
      couples: [],
      connectors: [],
      canvas: { width: 4, height: 2 },
      orphanIds: [],
      offsetX: 0,
    })

    const wrapper = mount(FamilyCanvas, {
      props: { members: makeFamily(['A']), centerLayoutId: 'A' },
      global: {
        plugins: [createPinia()],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()
    expect(wrapper.text()).not.toContain('位成员未显示')
  })

  it('center layout does not persist manual positions on node drop', async () => {
    const members = makeFamily(['A'])
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.$patch((state) => {
      state.data.members = { A: members[0] }
    })

    const wrapper = mount(FamilyCanvas, {
      props: { members, centerLayoutId: 'A' },
      global: {
        plugins: [pinia],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()

    const node = wrapper.findComponent({ name: 'MemberNode' })
    await node.vm.$emit('drop', { id: 'A', dx: 10, dy: 10 })

    expect(family.data.manualPositions.A).toBeUndefined()
  })
})
