<script setup lang="ts">
import { ref, watch } from 'vue'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{
  /** 原始文件（或 data URL），打开裁剪器 */
  file: File | null
}>()

const emit = defineEmits<{
  (e: 'confirm', blob: Blob): void
  (e: 'cancel'): void
}>()

const imageSrc = ref<string | null>(null)
const cropperRef = ref<InstanceType<typeof Cropper> | null>(null)
const processing = ref(false)

watch(
  () => props.file,
  (f) => {
    if (!f) {
      imageSrc.value = null
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      imageSrc.value = typeof reader.result === 'string' ? reader.result : null
    }
    reader.readAsDataURL(f)
  },
  { immediate: true },
)

async function onConfirm() {
  if (!cropperRef.value) return
  processing.value = true
  try {
    const { canvas } = cropperRef.value.getResult() as { canvas: HTMLCanvasElement | null }
    if (!canvas) return
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1),
    )
    if (blob) emit('confirm', blob)
  } finally {
    processing.value = false
  }
}

function onCancel() {
  emit('cancel')
}
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
          ref="cropperRef"
          :src="imageSrc"
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
        class="rounded border border-slate-500 bg-transparent px-4 py-1 text-sm text-slate-200 hover:bg-slate-700"
        @click="onCancel"
      >
        取消
      </button>
      <button
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
