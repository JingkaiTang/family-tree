import { validatePhotoByteLength, validatePhotoDimensions, validatePhotoInput } from '@/core/photoInput'

const PHOTO_DIMENSION = 1600
const THUMBNAIL_DIMENSION = 256

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
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

/** Validate before decoding, then create full-size and thumbnail WebP media. */
export async function prepareBrowserPhoto(bytes: Uint8Array, _mime: string): Promise<{ photo: Blob; thumbnail: Blob }> {
  validatePhotoByteLength(bytes.byteLength)
  // Take our own snapshot so the caller cannot change the bytes after validation.
  const input = new Uint8Array(bytes)
  const header = validatePhotoInput(input)
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
    validatePhotoDimensions(bitmap.width, bitmap.height)
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
