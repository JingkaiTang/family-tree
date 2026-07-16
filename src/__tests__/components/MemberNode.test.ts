/**
 * @vitest-environment happy-dom
 *
 * MemberNode 组件集成测试
 * 覆盖：姓名渲染、性别符号/颜色、生卒格式化、称呼标签、选中状态、点击事件
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MemberNode from '@/components/tree/MemberNode.vue'
import { mk } from '@/__tests__/fixtures/families'

function mountNode(props: Record<string, unknown> = {}) {
  return mount(MemberNode, {
    props: {
      member: mk('test', { gender: 'male', firstName: '靖凯', lastName: '唐' }),
      left: 100,
      top: 200,
      width: 110,
      height: 210,
      ...props,
    },
    global: {
      plugins: [createPinia()],
    },
  })
}

describe('MemberNode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ========== 姓名渲染 ==========
  it('显示姓+名', () => {
    const wrapper = mountNode()
    expect(wrapper.text()).toContain('唐靖凯')
  })

  it('没有姓时只显示名', () => {
    const wrapper = mountNode({
      member: mk('test', { firstName: '靖凯', lastName: '' }),
    })
    expect(wrapper.text()).toContain('靖凯')
  })

  it('姓名都为空且无小名时显示"未命名"', () => {
    const wrapper = mountNode({
      member: mk('test', { firstName: '', lastName: '' }),
    })
    expect(wrapper.text()).toContain('未命名')
  })

  it('姓名都为空但有 nickname 时显示 nickname', () => {
    const wrapper = mountNode({
      member: { ...mk('test', { firstName: '', lastName: '' }), nickname: '阿凯' },
    })
    expect(wrapper.text()).toContain('阿凯')
  })

  // ========== 性别符号 ==========
  it('男性显示 ♂ 符号', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'male' }),
    })
    expect(wrapper.text()).toContain('♂')
  })

  it('女性显示 ♀ 符号', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'female' }),
    })
    expect(wrapper.text()).toContain('♀')
  })

  it('其他性别显示 · 符号', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'other' }),
    })
    expect(wrapper.text()).toContain('·')
  })

  // ========== 性别颜色边框 ==========
  it('男性使用 sky 色边框', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'male' }),
    })
    expect(wrapper.find('.border-sky-400').exists()).toBe(true)
  })

  it('女性使用 pink 色边框', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'female' }),
    })
    expect(wrapper.find('.border-pink-400').exists()).toBe(true)
  })

  // ========== 生卒年份 ==========
  it('显示完整生卒年份(birthDate + deathDate)', () => {
    const wrapper = mountNode({
      member: mk('test', { birthDate: '1960-03-15', gender: 'male' }),
    })
    // birthDate 切片后显示 "1960–"
    expect(wrapper.text()).toContain('1960–')
  })

  it('只有 deathDate 时显示 ?–year', () => {
    const member = { ...mk('test', { gender: 'female' }), deathDate: '2020-06-01' }
    const wrapper = mountNode({ member })
    expect(wrapper.text()).toContain('?–2020')
  })

  // ========== 称呼标签 ==========
  it('有 kinship 时显示称呼标签', () => {
    const wrapper = mountNode({
      member: mk('test', { gender: 'male', firstName: '爸爸', lastName: '' }),
      kinship: '父亲',
    })
    expect(wrapper.text()).toContain('父亲')
  })

  it('没有 kinship 时不显示称呼', () => {
    const wrapper = mountNode()
    const kinshipEl = wrapper.find('.text-emerald-600')
    expect(kinshipEl.exists()).toBe(false)
  })

  // ========== 选中/视角状态 ==========
  it('selected 时显示 amber 环', () => {
    const wrapper = mountNode({ selected: true })
    expect(wrapper.find('.ring-amber-400').exists()).toBe(true)
  })

  it('isViewpoint 时显示 emerald 环', () => {
    const wrapper = mountNode({ isViewpoint: true })
    expect(wrapper.find('.ring-emerald-500').exists()).toBe(true)
  })

  it('同时 selected 和 isViewpoint 时两个环都显示', () => {
    const wrapper = mountNode({ selected: true, isViewpoint: true })
    expect(wrapper.find('.ring-amber-400').exists()).toBe(true)
    expect(wrapper.find('.ring-emerald-500').exists()).toBe(true)
  })

  // ========== 事件 ==========
  it('点击节点触发 click 事件并传递 member.id', async () => {
    const wrapper = mountNode({
      member: mk('member-1', { gender: 'male' }),
    })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeTruthy()
    expect(wrapper.emitted('click')![0]).toEqual(['member-1'])
  })

  it('双击节点触发 dblclick 事件并传递 member.id', async () => {
    const wrapper = mountNode({
      member: mk('member-2', { gender: 'female' }),
    })
    await wrapper.trigger('dblclick')
    expect(wrapper.emitted('dblclick')).toBeTruthy()
    expect(wrapper.emitted('dblclick')![0]).toEqual(['member-2'])
  })

  // ========== 样式定位 ==========
  it('节点按 left/top 绝对定位', () => {
    const wrapper = mountNode({ left: 150, top: 300 })
    const root = wrapper.find('.absolute')
    const style = root.attributes('style') || ''
    expect(style).toContain('left: 150px')
    expect(style).toContain('top: 300px')
  })

  it('默认卡片保持布局尺寸并让照片铺满卡片内部', () => {
    const wrapper = mountNode({
      width: 168,
      height: 216,
      kinship: '父亲',
      member: {
        ...mk('test', { firstName: '靖凯', lastName: '唐', birthDate: '1960-01-01' }),
        deathDate: '2020-01-01',
      },
    })
    const node = wrapper.get('[data-testid="member-node"]')
    const photo = wrapper.get('[data-testid="member-photo"]')
    const details = wrapper.get('[data-testid="member-details"]')

    expect(node.attributes('style')).toContain('width: 168px')
    expect(node.attributes('style')).toContain('height: 216px')
    expect(photo.classes()).toEqual(expect.arrayContaining(['absolute', 'inset-0']))
    expect(photo.attributes('style')).toBeUndefined()
    expect(details.classes()).toEqual(expect.arrayContaining(['absolute', 'inset-x-0', 'bottom-0']))
    expect(details.get('[data-testid="member-name"]').text()).toBe('唐靖凯')
    expect(details.get('[data-testid="member-kinship"]').text()).toBe('父亲')
    expect(details.get('[data-testid="member-lifespan"]').text()).toBe('1960 – 2020')
  })
})
