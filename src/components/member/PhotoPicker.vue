<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolvePhotoUrl, importPhoto, deletePhoto } from '@/services/tauriApi'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import PhotoCropper from './PhotoCropper.vue'

const props = defineProps<{ photoId?: string }>()
const emit = defineEmits<{ (e: 'change', photoId: string | undefined): void }>()

const family = useFamilyStore()
const ui = useUiStore()

const previewUrl = ref<string | null>(null)
const pendingFile = ref<File | null>(null)
const uploading = ref(false)

async function refreshPreview() {
  if (!props.photoId || !family.projectPath) {
    previewUrl.value = null
    return
  }
  try {
    previewUrl.value = await resolvePhotoUrl(family.projectPath, props.photoId, true)
    previewUrl.value += `?t=${Date.now()}`
  } catch {
    previewUrl.value = null
  }
}

watch(() => props.photoId, refreshPreview, { immediate: true })

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking same file
  if (!file || !family.projectPath) return
  pendingFile.value = file
}

async function onCropConfirm(blob: Blob) {
  if (!family.projectPath) return
  uploading.value = true
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const { photoId } = await importPhoto(family.projectPath, bytes, 'image/png')
    if (props.photoId) {
      try {
        await deletePhoto(family.projectPath, props.photoId)
      } catch {
        /* ignore */
      }
    }
    emit('change', photoId)
    ui.showToast('success', '照片已保存')
  } catch (err) {
    ui.showToast('error', '上传失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    uploading.value = false
    pendingFile.value = null
  }
}

function onCropCancel() {
  pendingFile.value = null
}

async function onRemove() {
  if (!props.photoId || !family.projectPath) return
  try {
    await deletePhoto(family.projectPath, props.photoId)
  } catch {
    /* ignore */
  }
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
      :file="pendingFile"
      @confirm="onCropConfirm"
      @cancel="onCropCancel"
    />
  </div>
</template>
