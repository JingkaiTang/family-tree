/**
 * @vitest-environment happy-dom
 *
 * SearchBar 组件集成测试
 * 覆盖：搜索输入、结果列表、无匹配提示、jump 交互、store 联动
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import SearchBar from '@/components/search/SearchBar.vue'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { mk } from '@/__tests__/fixtures/families'

function setupStore(membersCount = 5) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFamilyStore()

  const members = Array.from({ length: membersCount }, (_, i) => {
    const m = mk(`m${i}`, {
      gender: i % 2 === 0 ? 'male' : 'female',
      firstName: ['靖凯', '建国', '小明', '小红', '阿强'][i % 5],
      lastName: ['唐', '李', '王', '张', '陈'][i % 5],
    })
    if (i === 0) m.nickname = '阿凯'
    if (i === 1) m.occupation = '工程师'
    return m
  })

  store.$patch((state) => {
    state.data.members = Object.fromEntries(members.map((m) => [m.id, m]))
  })

  return { pinia, store, members }
}

/** 挂载 SearchBar 并返回 pinia 实例以便后续查询 */
function mountSearchBar(pinia: ReturnType<typeof createPinia>, props: Record<string, unknown> = {}) {
  return mount(SearchBar, {
    props,
    global: { plugins: [pinia] },
  })
}

describe('SearchBar', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    const result = setupStore()
    pinia = result.pinia
  })

  // ========== 渲染 ==========
  it('渲染搜索输入框', () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input[type="search"]')
    expect(input.exists()).toBe(true)
  })

  it('placeholder 显示"搜索成员…"', () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    expect(input.attributes('placeholder')).toBe('搜索成员…')
  })

  // ========== 搜索结果 ==========
  it('输入匹配文字后显示结果列表', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('靖凯')
    await input.trigger('focus')
    await nextTick()

    expect(wrapper.text()).toContain('唐靖凯')
  })

  it('搜索 nickname 也能匹配', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('阿凯')
    await input.trigger('focus')
    await nextTick()

    expect(wrapper.text()).toContain('唐靖凯')
    expect(wrapper.text()).toContain('阿凯')
  })

  it('搜索 occupation 也能匹配', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('工程师')
    await input.trigger('focus')
    await nextTick()

    expect(wrapper.text()).toContain('李建国')
  })

  // ========== 无匹配 ==========
  it('无匹配时显示"无匹配成员"', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('ZZZZZZ')
    await input.trigger('focus')
    await nextTick()

    expect(wrapper.text()).toContain('无匹配成员')
  })

  // ========== 空搜索不显示结果 ==========
  it('输入为空时不显示下拉', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('  ')
    await input.trigger('focus')
    await nextTick()

    expect(wrapper.find('.bg-white.shadow-lg').exists()).toBe(false)
  })

  // ========== jump 交互 ==========
  it('点击结果调用 ui.setSelected', async () => {
    const wrapper = mountSearchBar(pinia)
    const input = wrapper.find('input')
    await input.setValue('靖凯')
    await input.trigger('focus')
    await nextTick()

    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)

    await button.trigger('mousedown')

    const ui = useUiStore()
    expect(ui.selectedId).toBe('m0')
  })

  // ========== onJump prop ==========
  it('选中后调用 onJump 回调', async () => {
    const onJump = vi.fn()
    const wrapper = mountSearchBar(pinia, { onJump })
    const input = wrapper.find('input')
    await input.setValue('靖凯')
    await input.trigger('focus')
    await nextTick()

    await wrapper.find('button').trigger('mousedown')
    expect(onJump).toHaveBeenCalledWith('m0')
  })
})
