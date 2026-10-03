// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LayoutDiagnostics from '@/components/tree/LayoutDiagnostics.vue'

describe('LayoutDiagnostics', () => {
  it('explains missing auxiliary lines without labelling valid family data as invalid', async () => {
    const wrapper = mount(LayoutDiagnostics, {
      props: {
        diagnostics: [{
          code: 'UNROUTABLE_AUXILIARY_EDGE',
          ids: ['aux:godparent:godmother>child', 'godmother', 'child'],
          message: '当前卡片间没有找到安全通道。',
        }],
      },
    })

    expect(wrapper.get('.font-semibold').text()).toBe('部分辅助连线暂时无法显示')
    expect(wrapper.get('[role="status"]').text()).toContain('当前卡片间没有找到安全通道。')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})
