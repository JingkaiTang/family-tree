<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Cropper } from 'vue-advanced-cropper'
import { validatePhotoByteLength, validatePhotoInput } from '@/core/photoInput'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{
  /** 原始文件通过预算和文件头校验后才打开裁剪器。 */
  file: File | null
}>()

const emit = defineEmits<{
  (e: 'confirm', blob: Blob): void
  (e: 'cancel'): void
  (e: 'error', message: string): void
}>()

const imageSrc = ref<string | null>(null)
const cropperRef = ref<InstanceType<typeof Cropper> | null>(null)
const processing = ref(false)
const cropperErrorHandler = shallowRef<() => void>(() => {})
let cropSession = 0
let activeReader: FileReader | null = null

function clearImage() {
  if (imageSrc.value?.startsWith('blob:')) URL.revokeObjectURL(imageSrc.value)
  imageSrc.value = null
  activeReader?.abort()
  activeReader = null
}

function inlineJpeg(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  }
  return `data:image/jpeg;base64,${btoa(chunks.join(''))}`
}

function failRead(session: number, message: string) {
  if (session !== cropSession) return
  cropSession += 1
  clearImage()
  processing.value = false
  emit('error', message)
}

watch(
  () => props.file,
  (f) => {
    const session = ++cropSession
    clearImage()
    processing.value = false
    if (!f) return
    try {
      // Bound the original file before allocating bytes or invoking an image decoder.
      validatePhotoByteLength(f.size)
      const reader = new FileReader()
      activeReader = reader
      reader.onload = () => {
        if (session !== cropSession) return
        activeReader = null
        try {
          if (!(reader.result instanceof ArrayBuffer)) throw new Error('无法读取照片，请重新选择文件')
          const bytes = new Uint8Array(reader.result)
          const header = validatePhotoInput(bytes)
          cropperErrorHandler.value = () => failRead(session, '图片解码失败，请选择有效的 PNG、JPEG 或 WebP 图片')
          // The cropper's delayed EXIF processing can create an unowned Blob URL
          // after unmount. Validated JPEG data URLs preserve its orientation support
          // without that allocation; the source byte budget bounds base64 overhead.
          imageSrc.value = header.mime === 'image/jpeg'
            ? inlineJpeg(bytes)
            : URL.createObjectURL(new Blob([bytes], { type: header.mime }))
        } catch (error) {
          failRead(session, error instanceof Error ? error.message : '无法读取照片，请重新选择文件')
        }
      }
      reader.onerror = () => failRead(session, '无法读取照片，请重新选择文件')
      reader.onabort = () => failRead(session, '照片读取已取消，请重新选择文件')
      reader.readAsArrayBuffer(f)
    } catch (error) {
      failRead(session, error instanceof Error ? error.message : '无法读取照片，请重新选择文件')
    }
  },
  { immediate: true, flush: 'sync' },
)

async function onConfirm() {
  if (!cropperRef.value || !imageSrc.value || processing.value) return
  const session = cropSession
  processing.value = true
  try {
    const { canvas } = cropperRef.value.getResult() as { canvas: HTMLCanvasElement | null }
    if (!canvas) return
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1),
    )
    if (!blob) throw new Error('照片裁剪失败，请重试')
    if (blob && session === cropSession) emit('confirm', blob)
  } catch (error) {
    failRead(session, error instanceof Error ? error.message : '照片裁剪失败，请重试')
  } finally {
    if (session === cropSession) processing.value = false
  }
}

function onCancel() {
  cropSession += 1
  clearImage()
  processing.value = false
  emit('cancel')
}

onBeforeUnmount(() => {
  cropSession += 1
  clearImage()
})
</script>

<template>
  <div
    v-if="imageSrc"
    class="fixed inset-0 z-50 flex flex-col bg-slate-900/80"
    @click.self="onCancel"
  >
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="h-full max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-lg bg-slate-800 shadow-xl">
        <Cropper
          :key="imageSrc"
          ref="cropperRef"
          :src="imageSrc"
          :onError="cropperErrorHandler"
          :canvas="{ maxWidth: 1600, maxHeight: 1600, maxArea: 1600 * 1600 }"
          :stencil-props="{
            aspectRatio: 3 / 4,
            movable: true,
            resizable: true,
          }"
          image-restriction="fit-area"
          class="h-full w-full"
        />
      </div>
    </div>
    <div class="flex items-center justify-center gap-3 bg-slate-900 py-4">
      <p class="mr-4 text-sm text-slate-300">
        拖动调整位置和大小。比例锁定为 3:4（竖向）。
      </p>
      <button
        type="button"
        class="rounded border border-slate-500 bg-transparent px-4 py-1 text-sm text-slate-200 hover:bg-slate-700"
        @click="onCancel"
      >
        取消
      </button>
      <button
        type="button"
        class="rounded bg-emerald-600 px-4 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        :disabled="processing"
        @click="onConfirm"
      >
        {{ processing ? '处理中…' : '确认裁剪' }}
      </button>
    </div>
  </div>
</template>

<style>
/* vue-advanced-cropper 默认是亮色背景，在暗色 modal 里反色一下更协调 */
.vue-advanced-cropper__background,
.vue-advanced-cropper__foreground {
  background: #0f172a !important;
}
</style>
