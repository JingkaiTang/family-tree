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
  let nextUrl = 0
  beforeEach(() => {
    readers.length = 0
    nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:photo-${++nextUrl}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      readers.push(this)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('ignores a delayed file read after another file has replaced it', async () => {
    const CropperStub = defineComponent({ props: ['src'], setup: () => () => h('div') })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([png()], 'first.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    await wrapper.setProps({ file: new File([png()], 'second.png') })
    completeRead(readers[1])
    await nextTick()
    expect(wrapper.getComponent(CropperStub).props('src')).toBe('blob:photo-1')

    Object.defineProperty(readers[0], 'result', { value: png().buffer })
    readers[0].dispatchEvent(new ProgressEvent('load'))
    readers[0].dispatchEvent(new ProgressEvent('error'))
    readers[0].dispatchEvent(new ProgressEvent('abort'))
    await nextTick()

    expect(wrapper.getComponent(CropperStub).props('src')).toBe('blob:photo-1')
    expect(wrapper.emitted('error')).toBeUndefined()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
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
      props: { file: new File([png()], 'unreadable.png') },
      global: { stubs: { Cropper: CropperStub } },
    })

    readers[0].dispatchEvent(new ProgressEvent(eventType))

    expect(wrapper.emitted('error')).toEqual([[eventType === 'abort'
      ? '照片读取已取消，请重新选择文件'
      : '无法读取照片，请重新选择文件']])
    expect(wrapper.find('.fixed').exists()).toBe(false)
    await wrapper.setProps({ file: new File([png()], 'retry.png') })
    completeRead(readers[1])
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
      props: { file: new File([png()], 'portrait.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    completeRead(readers[0])
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')

    if (action === 'cancel') {
      await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    } else if (action === 'replace') {
      await wrapper.setProps({ file: new File([png()], 'replacement.png') })
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
      props: { file: new File([png()], 'first.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    completeRead(readers[0])
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '确认裁剪')!.trigger('click')
    await wrapper.setProps({ file: new File([png()], 'second.png') })
    completeRead(readers[1])
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

  it.each(['clear', 'unmount'] as const)('aborts an unfinished source read after %s and ignores its late result', async action => {
    const abort = vi.spyOn(FileReader.prototype, 'abort')
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([png()], 'portrait.png') },
      global: { stubs: { Cropper: true } },
    })
    if (action === 'clear') await wrapper.setProps({ file: null })
    else wrapper.unmount()
    completeRead(readers[0])
    readers[0].dispatchEvent(new ProgressEvent('error'))
    await nextTick()

    expect(abort).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.emitted('error')).toBeUndefined()
    if (action === 'clear') wrapper.unmount()
  })

  it('releases validated source URLs on replacement, cancel and unmount', async () => {
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([png()], 'first.png') },
      global: { stubs: { Cropper: true } },
    })
    completeRead(readers[0])
    await wrapper.setProps({ file: new File([png()], 'second.png') })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
    completeRead(readers[1])
    await nextTick()
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-2')
    await wrapper.setProps({ file: new File([png()], 'third.png') })
    completeRead(readers[2])
    wrapper.unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-3')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('reports decoder failures, releases their URL, and ignores a previous decoder error after retry', async () => {
    const CropperStub = defineComponent({
      props: { src: String },
      emits: ['error'],
      setup: () => () => h('div'),
    })
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([png()], 'first.png') },
      global: { stubs: { Cropper: CropperStub } },
    })
    completeRead(readers[0])
    await nextTick()
    const oldCropper = wrapper.getComponent(CropperStub)
    oldCropper.vm.$emit('error')
    await nextTick()

    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('图片解码失败')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
    expect(wrapper.findComponent(CropperStub).exists()).toBe(false)
    await wrapper.setProps({ file: new File([png()], 'retry.png') })
    completeRead(readers[1])
    await nextTick()
    oldCropper.vm.$emit('error')
    await nextTick()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.getComponent(CropperStub).props('src')).toBe('blob:photo-2')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:photo-2')
    wrapper.unmount()
  })

  it('does not submit the surrounding member form when cancelling a crop', async () => {
    const form = document.createElement('form')
    document.body.append(form)
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', onSubmit)
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([png()], 'portrait.png') },
      attachTo: form,
      global: { stubs: { Cropper: true } },
    })
    completeRead(readers[0])
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

function png(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, 32)
  view.setUint32(20, 24)
  return bytes
}

function completeRead(reader: FileReader) {
  const result = png().buffer
  Object.defineProperty(reader, 'result', { value: result, configurable: true })
  reader.dispatchEvent(new ProgressEvent('load'))
}
