/**
 * @vitest-environment happy-dom
 *
 * PhotoCropper 组件基本测试
 * 注意：vue-advanced-cropper 依赖 Canvas，happy-dom 不支持完整裁剪交互
 * 此处测试组件结构和基础事件
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import PhotoCropper from '@/components/member/PhotoCropper.vue'

describe('PhotoCropper', () => {
  const readers: FileReader[] = []
  beforeEach(() => {
    readers.length = 0
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      readers.push(this)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('ignores a delayed file read after another file has replaced it', async () => {
    const CropperStub = defineComponent({ props: ['src'], setup: () => () => h('div') })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File(['first'], 'first.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    await wrapper.setProps({ file: new File(['second'], 'second.png') })
    completeRead(readers[1], 'data:image/png;base64,second')
    await nextTick()
    expect(wrapper.getComponent(CropperStub).props('src')).toBe('data:image/png;base64,second')

    Object.defineProperty(readers[0], 'result', { value: 'data:image/png;base64,first' })
    readers[0].dispatchEvent(new ProgressEvent('load'))
    await nextTick()

    expect(wrapper.getComponent(CropperStub).props('src')).toBe('data:image/png;base64,second')
    wrapper.unmount()
  })

  it.each(['error', 'abort'] as const)('reports a current file read %s and accepts a later retry', async eventType => {
    const blob = new Blob(['new crop'], { type: 'image/png' })
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(blob))
    const CropperStub = defineComponent({
      setup(_, { expose }) {
        expose({ getResult: () => ({ canvas }) })
        return () => h('div')
      },
    })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File(['unreadable'], 'unreadable.png') },
      global: { stubs: { Cropper: CropperStub } },
    })

    readers[0].dispatchEvent(new ProgressEvent(eventType))

    expect(wrapper.emitted('error')).toEqual([[eventType === 'abort'
      ? '照片读取已取消，请重新选择文件'
      : '无法读取照片，请重新选择文件']])
    expect(wrapper.find('.fixed').exists()).toBe(false)
    await wrapper.setProps({ file: new File(['retry'], 'retry.png') })
    completeRead(readers[1], 'data:image/png;base64,retry')
    await nextTick()
    readers[0].dispatchEvent(new ProgressEvent(eventType))
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toEqual([[blob]])
    wrapper.unmount()
  })

  it.each(['cancel', 'replace', 'unmount'] as const)('does not confirm a delayed canvas conversion after %s', async action => {
    let finishBlob!: BlobCallback
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => { finishBlob = callback })
    const CropperStub = defineComponent({
      setup(_, { expose }) {
        expose({ getResult: () => ({ canvas }) })
        return () => h('div')
      },
    })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File(['image'], 'portrait.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    completeRead(readers[0], 'data:image/png;base64,portrait')
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')

    if (action === 'cancel') {
      await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    } else if (action === 'replace') {
      await wrapper.setProps({ file: new File(['replacement'], 'replacement.png') })
    } else wrapper.unmount()
    finishBlob(new Blob(['late image'], { type: 'image/png' }))
    await flushPromises()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    if (action !== 'unmount') wrapper.unmount()
  })

  it('keeps a replacement crop busy until its own conversion finishes', async () => {
    const conversions: BlobCallback[] = []
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => { conversions.push(callback) })
    const CropperStub = defineComponent({
      setup(_, { expose }) {
        expose({ getResult: () => ({ canvas }) })
        return () => h('div')
      },
    })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File(['first'], 'first.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    completeRead(readers[0], 'data:image/png;base64,first')
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')
    await wrapper.setProps({ file: new File(['second'], 'second.png') })
    completeRead(readers[1], 'data:image/png;base64,second')
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')

    conversions[0](new Blob(['old image']))
    await flushPromises()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.findAll('button').find(button => button.text() === '处理中…')!.attributes('disabled'))
      .toBeDefined()
    const currentBlob = new Blob(['current image'])
    conversions[1](currentBlob)
    await flushPromises()
    expect(wrapper.emitted('confirm')).toEqual([[currentBlob]])
    wrapper.unmount()
  })
  it('file 为 null 时不渲染裁剪界面', () => {
    const wrapper = mount(PhotoCropper, {
      props: { file: null },
    })
    // v-if="imageSrc" → 没有任何内容
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('does not submit the surrounding member form when cancelling a crop', async () => {
    const form = document.createElement('form')
    document.body.append(form)
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', onSubmit)
    const wrapper = mount(PhotoCropper, {
      props: { file: new File(['image'], 'portrait.png') },
      attachTo: form,
      global: { stubs: { Cropper: true } },
    })
    completeRead(readers[0], 'data:image/png;base64,portrait')
    await nextTick()

    wrapper.findAll('button').find(button => button.text() === '取消')!.element.click()

    expect(wrapper.emitted('cancel')).toEqual([[]])
    expect(onSubmit).not.toHaveBeenCalled()
    wrapper.unmount()
    form.remove()
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

function completeRead(reader: FileReader, result: string) {
  Object.defineProperty(reader, 'result', { value: result, configurable: true })
  reader.dispatchEvent(new ProgressEvent('load'))
}
