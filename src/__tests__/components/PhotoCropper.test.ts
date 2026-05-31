/**
 * @vitest-environment happy-dom
 *
 * PhotoCropper 组件基本测试
 * 注意：vue-advanced-cropper 依赖 Canvas，happy-dom 不支持完整裁剪交互
 * 此处测试组件结构和基础事件
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PhotoCropper from '@/components/member/PhotoCropper.vue'

describe('PhotoCropper', () => {
  it('file 为 null 时不渲染裁剪界面', () => {
    const wrapper = mount(PhotoCropper, {
      props: { file: null },
    })
    // v-if="imageSrc" → 没有任何内容
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('cancel 事件正确触发', async () => {
    const wrapper = mount(PhotoCropper, {
      props: { file: null },
    })
    // 即使没有 imageSrc，组件也应能发出 cancel
    // 通过 wrapper.vm 触发
    ;(wrapper.vm as unknown as { onCancel: () => void }).onCancel()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('组件可以挂载和卸载', () => {
    const wrapper = mount(PhotoCropper, {
      props: { file: null },
    })
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
