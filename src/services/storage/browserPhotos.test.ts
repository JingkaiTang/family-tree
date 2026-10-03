import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareBrowserPhoto } from './browserPhotos'

// These headers exercise pre-decode validation; the platform decoder is mocked below.
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 2], 24)
  return bytes
}

function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  // APP1 followed by SOF2 (progressive JPEG), with three image components.
  const bytes = new Uint8Array([255, 216, 255, 225, 0, 4, 0, 0, 255, 194, 0, 17, 8,
    0, 0, 0, 0, 3, 1, 17, 0, 2, 17, 1, 3, 17, 1])
  const view = new DataView(bytes.buffer)
  view.setUint16(13, height)
  view.setUint16(15, width)
  return bytes
}

function webp(width: number, height: number, format: 'VP8X' | 'VP8L' | 'VP8 ' = 'VP8X'): Uint8Array<ArrayBuffer> {
  const length = format === 'VP8L' ? 5 : 10
  const bytes = new Uint8Array(20 + length + (length % 2))
  const view = new DataView(bytes.buffer)
  bytes.set([82, 73, 70, 70])
  view.setUint32(4, bytes.length - 8, true)
  bytes.set([87, 69, 66, 80], 8)
  bytes.set([...format].map(char => char.charCodeAt(0)), 12)
  view.setUint32(16, length, true)
  if (format === 'VP8X') {
    for (let index = 0; index < 3; index++) {
      bytes[24 + index] = ((width - 1) >>> (index * 8)) & 255
      bytes[27 + index] = ((height - 1) >>> (index * 8)) & 255
    }
  } else if (format === 'VP8L') {
    bytes[20] = 47
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true)
  } else {
    bytes.set([157, 1, 42], 23)
    view.setUint16(26, width, true)
    view.setUint16(28, height, true)
  }
  return bytes
}

function platform(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() }
  const decode = vi.fn(async (_blob: Blob) => bitmap)
  const outputs: Array<Blob | null> = []
  const canvases: ReturnType<typeof makeCanvas>[] = []
  function makeCanvas() {
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: vi.fn(),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((): typeof context | null => context),
      toBlob: vi.fn((callback: BlobCallback, _mime: string, _quality: number) => {
        callback(outputs.length ? outputs.shift()! : new Blob([webp(1, 1)], { type: 'image/webp' }))
      }),
      context,
    }
    return canvas
  }
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error('Unexpected element')
    const canvas = makeCanvas()
    canvases.push(canvas)
    return canvas
  })
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('document', { createElement })
  return { bitmap, decode, outputs, canvases, createElement }
}

afterEach(() => vi.unstubAllGlobals())

describe('prepareBrowserPhoto', () => {
  it.each([
    ['PNG', png(4000, 3000)],
    ['progressive JPEG', jpeg(4000, 3000)],
    ['extended WebP', webp(4000, 3000)],
    ['lossy WebP', webp(4000, 3000, 'VP8 ')],
    ['lossless WebP', webp(4000, 3000, 'VP8L')],
  ])('将 %s 按比例编码为照片和缩略图并释放资源', async (_format, bytes) => {
    const mock = platform(4000, 3000)
    const result = await prepareBrowserPhoto(bytes, '')

    expect(result.photo.type).toBe('image/webp')
    expect(result.thumbnail.type).toBe('image/webp')
    expect(mock.decode).toHaveBeenCalledOnce()
    expect(mock.canvases).toHaveLength(2)
    expect(mock.canvases[0].context.drawImage).toHaveBeenCalledWith(mock.bitmap, 0, 0, 1600, 1200)
    expect(mock.canvases[1].context.drawImage).toHaveBeenCalledWith(mock.bitmap, 0, 0, 256, 192)
    expect(mock.canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8)
    expect(mock.canvases[1].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.7)
    expect(mock.bitmap.close).toHaveBeenCalledOnce()
    for (const canvas of mock.canvases) {
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
      expect(canvas.context.imageSmoothingQuality).toBe('high')
    }
  })

  it('小图片不放大，并以字节头识别格式而非依赖文件 MIME', async () => {
    const mock = platform(32, 24)
    const input = png(32, 24)
    const padded = new Uint8Array(input.length + 10)
    padded.set(input, 5)
    const view = padded.subarray(5, 5 + input.length)
    const pending = prepareBrowserPhoto(view, 'application/octet-stream')
    view.fill(0)
    await pending

    const blob = mock.decode.mock.calls[0][0]
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(input)
    for (const canvas of mock.canvases) {
      expect(canvas.context.drawImage).toHaveBeenCalledWith(mock.bitmap, 0, 0, 32, 24)
    }
  })

  it('使用解码后的 EXIF 旋转尺寸，同时将极窄图片最小边保留为一个像素', async () => {
    const mock = platform(1, 4000)
    await prepareBrowserPhoto(jpeg(4000, 1), 'image/jpeg')
    expect(mock.canvases[0].context.drawImage).toHaveBeenCalledWith(mock.bitmap, 0, 0, 1, 1600)
    expect(mock.canvases[1].context.drawImage).toHaveBeenCalledWith(mock.bitmap, 0, 0, 1, 256)
  })

  it.each([
    ['PNG', png(8001, 5000)],
    ['JPEG', jpeg(8001, 5000)],
    ['VP8X', webp(8001, 5000)],
    ['VP8L', webp(8001, 5000, 'VP8L')],
    ['VP8', webp(8001, 5000, 'VP8 ')],
  ])('在解码 %s 前拒绝超过 4000 万像素的文件', async (_format, bytes) => {
    const mock = platform(8001, 5000)
    await expect(prepareBrowserPhoto(bytes, '')).rejects.toThrow('4000 万')
    expect(mock.decode).not.toHaveBeenCalled()
    expect(mock.createElement).not.toHaveBeenCalled()
  })

  it('允许恰好达到字节与像素上限的文件', async () => {
    const mock = platform(8000, 5000)
    const bytes = new Uint8Array(25 * 1024 * 1024)
    bytes.set(png(8000, 5000))
    await expect(prepareBrowserPhoto(bytes, 'image/png')).resolves.toHaveProperty('photo')
    expect(mock.decode).toHaveBeenCalledOnce()
  })

  it.each([
    [new Uint8Array(), '为空'],
    [new Uint8Array(25 * 1024 * 1024 + 1), '25 MiB'],
    [new TextEncoder().encode('<svg width="1" height="1"/>'), '格式或尺寸无效'],
    [new TextEncoder().encode('GIF89a'), '格式或尺寸无效'],
    [png(0, 100), '格式或尺寸无效'],
    [png(10, 10).slice(0, 24), '格式或尺寸无效'],
    [jpeg(10, 10).slice(0, 22), '格式或尺寸无效'],
    [webp(10, 10).slice(0, 28), '格式或尺寸无效'],
    [new Uint8Array([255, 216, 255, 225, 255, 255]), '格式或尺寸无效'],
    [new Uint8Array([255, 216, 255, 218]), '格式或尺寸无效'],
  ])('无效或超大输入不进入图片解码', async (bytes, message) => {
    const mock = platform(10, 10)
    await expect(prepareBrowserPhoto(bytes, '')).rejects.toThrow(message)
    expect(mock.decode).not.toHaveBeenCalled()
  })

  it('解码失败时返回易理解的错误且不分配画布', async () => {
    const mock = platform(10, 10)
    mock.decode.mockRejectedValueOnce(new Error('bad compressed data'))
    await expect(prepareBrowserPhoto(png(10, 10), '')).rejects.toThrow('图片解码失败')
    expect(mock.createElement).not.toHaveBeenCalled()
  })

  it.each([
    [8001, 5000, '4000 万'],
    [200, 300, '尺寸与文件头不一致'],
    [0, 10, '格式或尺寸无效'],
  ])('解码结果的异常尺寸也被拒绝并释放位图', async (width, height, message) => {
    const mock = platform(width, height)
    await expect(prepareBrowserPhoto(png(100, 100), '')).rejects.toThrow(message)
    expect(mock.bitmap.close).toHaveBeenCalledOnce()
    expect(mock.createElement).not.toHaveBeenCalled()
  })

  it.each([
    [null, '编码失败'],
    [new Blob([], { type: 'image/webp' }), '编码失败'],
    [new Blob([png(10, 10)], { type: 'image/png' }), '有效的 WebP'],
    [new Blob([png(10, 10)], { type: 'image/webp' }), '有效的 WebP'],
  ])('不把空编码结果或 PNG 回退保存为 WebP', async (blob, message) => {
    const mock = platform(10, 10)
    mock.outputs.push(blob)
    await expect(prepareBrowserPhoto(png(10, 10), '')).rejects.toThrow(message)
    expect(mock.bitmap.close).toHaveBeenCalledOnce()
    expect(mock.canvases).toHaveLength(1)
    expect(mock.canvases[0].width).toBe(0)
    expect(mock.canvases[0].height).toBe(0)
  })

  it('缩略图编码失败时释放两张画布和位图，不返回不完整结果', async () => {
    const mock = platform(10, 10)
    mock.outputs.push(new Blob([webp(10, 10)], { type: 'image/webp' }), null)
    await expect(prepareBrowserPhoto(png(10, 10), '')).rejects.toThrow('编码失败')
    expect(mock.bitmap.close).toHaveBeenCalledOnce()
    expect(mock.canvases).toHaveLength(2)
    expect(mock.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it('画布不可用时释放位图和画布', async () => {
    const mock = platform(10, 10)
    mock.createElement.mockImplementationOnce(() => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => null),
        toBlob: vi.fn(),
        context: { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: vi.fn() },
      }
      mock.canvases.push(canvas)
      return canvas
    })
    await expect(prepareBrowserPhoto(png(10, 10), '')).rejects.toThrow('无法创建图片画布')
    expect(mock.bitmap.close).toHaveBeenCalledOnce()
    expect(mock.canvases[0].width).toBe(0)
  })

  it('平台缺少图片解码能力时明确报错', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(prepareBrowserPhoto(png(10, 10), '')).rejects.toThrow('不支持图片处理')
  })
})
