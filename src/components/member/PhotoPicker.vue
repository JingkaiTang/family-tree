<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { resolvePhotoUrl, importPhoto, deletePhoto } from '@/services/storage'
import { googleDriveState } from '@/services/googleDriveConnection'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import PhotoCropper from './PhotoCropper.vue'

const props = defineProps<{ photoId?: string }>()
const emit = defineEmits<{
  (e: 'change', photoId: string | undefined): void
  (e: 'stage', photoId: string): void
}>()

const family = useFamilyStore()
const ui = useUiStore()

const previewUrl = ref<string | null>(null)
const pendingFile = ref<File | null>(null)
const uploading = ref(false)
let previewRequest = 0
let uploadRequest = 0

function replacePreviewUrl(next: string | null) {
  const previous = previewUrl.value
  if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
  previewUrl.value = next
}

async function refreshPreview() {
  const request = ++previewRequest
  const project = family.projectRef
  const projectToken = family.projectToken
  replacePreviewUrl(null)
  if (!props.photoId || !project) return
  try {
    const next = await resolvePhotoUrl(project, props.photoId, true)
    if (request !== previewRequest || projectToken !== family.projectToken) {
      if (next.startsWith('blob:')) URL.revokeObjectURL(next)
      return
    }
    replacePreviewUrl(next)
  } catch {
    if (request === previewRequest && projectToken === family.projectToken) replacePreviewUrl(null)
  }
}

watch(() => [props.photoId, family.projectToken, googleDriveState.mediaEpoch] as const, refreshPreview, { immediate: true })

watch(() => family.projectToken, () => {
  uploadRequest += 1
  pendingFile.value = null
  uploading.value = false
}, { flush: 'sync' })

onBeforeUnmount(() => {
  previewRequest += 1
  uploadRequest += 1
  replacePreviewUrl(null)
})

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking same file
  if (!file || !family.projectRef) return
  pendingFile.value = file
}

async function onCropConfirm(blob: Blob) {
  const project = family.projectRef
  if (!project || uploading.value) return
  const projectToken = family.projectToken
  const request = ++uploadRequest
  const isCurrent = () => request === uploadRequest && family.projectToken === projectToken
  uploading.value = true
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!isCurrent()) return
    const { photoId } = await importPhoto(project, bytes, 'image/png')
    if (!isCurrent()) {
      // 导入期间切换项目或离开表单时，清理原项目中新建但未被引用的照片。
      await deletePhoto(project, photoId)
      return
    }
    emit('stage', photoId)
    emit('change', photoId)
    ui.showToast('success', '照片已暂存，保存成员后生效')
  } catch (err) {
    if (isCurrent()) {
      ui.showToast('error', '上传失败：' + (err instanceof Error ? err.message : String(err)))
    }
  } finally {
    if (isCurrent()) {
      uploading.value = false
      pendingFile.value = null
    }
  }
}

function onCropCancel() {
  pendingFile.value = null
}

function onRemove() {
  if (!props.photoId) return
  emit('change', undefined)
}

const hasPhoto = computed(() => !!previewUrl.value)
</script>

<template>
  <div class="flex items-center gap-4">
    <!-- 头像预览：3:4 竖向比例 -->
    <div class="h-32 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <img v-if="hasPhoto" :src="previewUrl!" class="h-full w-full object-cover" alt="头像" />
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-xs text-slate-400"
      >
        无照片
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <label
        class="cursor-pointer rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100"
      >
        {{ uploading ? '上传中…' : hasPhoto ? '更换照片' : '上传照片' }}
        <input type="file" accept="image/*" class="hidden" :disabled="uploading" @change="onFileChange" />
      </label>
      <button
        v-if="hasPhoto"
        type="button"
        class="rounded border border-rose-300 bg-white px-3 py-1 text-sm text-rose-600 hover:bg-rose-50"
        @click="onRemove"
      >
        删除照片
      </button>
      <p class="text-xs text-slate-400">上传后裁剪为 3:4 竖向比例</p>
    </div>

    <PhotoCropper
      :key="family.projectToken"
      :file="pendingFile"
      @confirm="onCropConfirm"
      @cancel="onCropCancel"
    />
  </div>
</template>
