// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { Cropper } from 'vue-advanced-cropper'
import PhotoCropper from '@/components/member/PhotoCropper.vue'

const CropperStub = defineComponent({ props: ['src'], setup: () => () => h('div') })

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('PhotoCropper original input limits', () => {
  const readers: FileReader[] = []
  beforeEach(() => {
    readers.length = 0
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      readers.push(this)
    })
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:validated-photo')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps validated EXIF JPEGs inline so delayed orientation handling cannot leak a Blob URL after cancel', async () => {
    const bytes = new Uint8Array([
      255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0,
      73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0,
      1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
      255, 192, 0, 11, 8, 0, 32, 0, 24, 1, 1, 17, 0,
    ])
    vi.useFakeTimers()
    const wrapper = mount(PhotoCropper, {
      props: { file: new File([bytes], 'oriented.jpg', { type: 'image/jpeg' }) },
    })
    try {
      Object.defineProperty(readers[0], 'result', { value: bytes.buffer })
      readers[0].dispatchEvent(new ProgressEvent('load'))
      await nextTick()
      const source = wrapper.getComponent(Cropper).props('src')
      expect(source).toMatch(/^data:image\/jpeg;base64,/)
      expect(atob(source.split(',')[1])).toBe(String.fromCharCode(...bytes))
      await wrapper.get('button').trigger('click')
      await vi.advanceTimersByTimeAsync(350)

      expect(wrapper.emitted('cancel')).toEqual([[]])
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('rejects a source larger than 25 MiB before reading it or mounting the decoder', async () => {
    const file = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    const wrapper = mount(PhotoCropper, { props: { file }, global: { stubs: { Cropper: CropperStub } } })
    await nextTick()

    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('25 MiB')
    expect(vi.mocked(FileReader.prototype.readAsDataURL).mock.calls.length).toBe(0)
    expect(readers).toHaveLength(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.findComponent(CropperStub).exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['too many pixels', png(8001, 5000), '4000 万'],
    ['SVG', new TextEncoder().encode('<svg width="1" height="1"/>'), '格式或尺寸无效'],
    ['GIF', new TextEncoder().encode('GIF89a'), '格式或尺寸无效'],
    ['truncated PNG', png(100, 100).slice(0, 20), '格式或尺寸无效'],
  ])('rejects %s before giving the original image to Cropper', async (_label, bytes, message) => {
    const file = new File([bytes], 'portrait.png', { type: 'image/png' })
    const wrapper = mount(PhotoCropper, { props: { file }, global: { stubs: { Cropper: CropperStub } } })
    expect(readers).toHaveLength(1)
    Object.defineProperty(readers[0], 'result', { value: bytes.buffer })
    readers[0].dispatchEvent(new ProgressEvent('load'))
    await nextTick()

    expect(wrapper.emitted('error')?.[0]?.[0]).toContain(message)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.findComponent(CropperStub).exists()).toBe(false)
    wrapper.unmount()
  })

  it('accepts the pixel limit and uses the detected MIME for the validated Blob', async () => {
    const bytes = png(8000, 5000)
    const file = new File([bytes], 'portrait.bin', { type: 'application/octet-stream' })
    const wrapper = mount(PhotoCropper, { props: { file }, global: { stubs: { Cropper: CropperStub } } })
    expect(readers).toHaveLength(1)
    Object.defineProperty(readers[0], 'result', { value: bytes.buffer })
    readers[0].dispatchEvent(new ProgressEvent('load'))
    await nextTick()

    expect(wrapper.emitted('error')).toBeUndefined()
    const source = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]
    expect(source).toBeInstanceOf(Blob)
    expect((source as Blob).type).toBe('image/png')
    expect(wrapper.getComponent(CropperStub).props('src')).toBe('blob:validated-photo')
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:validated-photo')
  })
})
