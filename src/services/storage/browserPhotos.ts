const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_PIXELS = 40_000_000
const PHOTO_DIMENSION = 1600
const THUMBNAIL_DIMENSION = 256

interface ImageHeader {
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function invalidHeader(): never {
  throw new Error('图片格式或尺寸无效，请选择完整的 PNG、JPEG 或 WebP 图片')
}

function readImageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (hasBytes(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || !hasBytes(bytes, 12, [73, 72, 68, 82])) {
      return invalidHeader()
    }
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' }
  }

  if (hasBytes(bytes, 0, [255, 216])) {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) return invalidHeader()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      // Dimensions must precede the image scan (SOS) or the end marker.
      if (marker === undefined || marker === 0 || marker === 0xda || marker === 0xd9) return invalidHeader()
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) return invalidHeader()
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return invalidHeader()
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        if (length < 8 || length !== 8 + 3 * bytes[offset + 7]) return invalidHeader()
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), mime: 'image/jpeg' }
      }
      offset += length
    }
    return invalidHeader()
  }

  if (hasBytes(bytes, 0, [82, 73, 70, 70]) && hasBytes(bytes, 8, [87, 69, 66, 80])) {
    const end = view.getUint32(4, true) + 8
    if (end > bytes.length || end < 20) return invalidHeader()
    let offset = 12
    while (offset + 8 <= end) {
      const length = view.getUint32(offset + 4, true)
      const data = offset + 8
      if (data + length > end) return invalidHeader()
      if (hasBytes(bytes, offset, [86, 80, 56, 88])) { // VP8X extended header, including animations.
        if (length !== 10) return invalidHeader()
        const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16)
        const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16)
        return { width, height, mime: 'image/webp' }
      }
      if (hasBytes(bytes, offset, [86, 80, 56, 32])) { // VP8 lossy key frame.
        if (length < 10 || (bytes[data] & 1) !== 0 || !hasBytes(bytes, data + 3, [157, 1, 42])) {
          return invalidHeader()
        }
        return {
          width: view.getUint16(data + 6, true) & 0x3fff,
          height: view.getUint16(data + 8, true) & 0x3fff,
          mime: 'image/webp',
        }
      }
      if (hasBytes(bytes, offset, [86, 80, 56, 76])) { // VP8L lossless bitstream header.
        if (length < 5 || bytes[data] !== 47 || (bytes[data + 4] & 0xe0) !== 0) return invalidHeader()
        const dimensions = view.getUint32(data + 1, true)
        return {
          width: 1 + (dimensions & 0x3fff),
          height: 1 + ((dimensions >>> 14) & 0x3fff),
          mime: 'image/webp',
        }
      }
      offset = data + length + (length % 2)
    }
  }
  return invalidHeader()
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    invalidHeader()
  }
  if (width * height > MAX_IMPORT_PIXELS) throw new Error('图片像素数超过 4000 万限制')
}

async function encodeWebp(bitmap: ImageBitmap, maxDimension: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const result = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob || blob.size === 0) reject(new Error('图片 WebP 编码失败'))
        else resolve(blob)
      }, 'image/webp', quality)
    })
    // Unsupported canvas encoders can silently return PNG; never persist that as .webp.
    const signature = new Uint8Array(await result.slice(0, 12).arrayBuffer())
    if (result.type !== 'image/webp' || !hasBytes(signature, 0, [82, 73, 70, 70]) ||
        !hasBytes(signature, 8, [87, 69, 66, 80])) {
      throw new Error('浏览器未能生成有效的 WebP 图片')
    }
    return result
  } finally {
    // Release the canvas backing store promptly, including failed encodes.
    canvas.width = 0
    canvas.height = 0
  }
}

/** Validate before decoding, then create the same WebP media sizes as native storage. */
export async function prepareBrowserPhoto(bytes: Uint8Array, _mime: string): Promise<{ photo: Blob; thumbnail: Blob }> {
  if (bytes.length === 0) throw new Error('图片内容为空')
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('图片超过 25 MiB 限制')
  // Take our own snapshot so the caller cannot change the bytes after validation.
  const input = new Uint8Array(bytes)
  const header = readImageHeader(input)
  validateDimensions(header.width, header.height)
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('当前浏览器不支持图片处理')
  }

  let bitmap: ImageBitmap
  try {
    // Sniffed format is authoritative; uploaded files do not always have a MIME type.
    bitmap = await createImageBitmap(new Blob([input], { type: header.mime }))
  } catch (cause) {
    throw new Error('图片解码失败，请选择有效的 PNG、JPEG 或 WebP 图片', { cause })
  }
  try {
    validateDimensions(bitmap.width, bitmap.height)
    // JPEG EXIF orientation may swap width and height. Other changes are invalid.
    if (!((bitmap.width === header.width && bitmap.height === header.height) ||
          (bitmap.width === header.height && bitmap.height === header.width))) {
      throw new Error('图片解码尺寸与文件头不一致')
    }
    const photo = await encodeWebp(bitmap, PHOTO_DIMENSION, 0.8)
    const thumbnail = await encodeWebp(bitmap, THUMBNAIL_DIMENSION, 0.7)
    return { photo, thumbnail }
  } finally {
    bitmap.close()
  }
}
