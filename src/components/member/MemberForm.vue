<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { Member } from '@/core/schema'
import PhotoPicker from './PhotoPicker.vue'

const props = defineProps<{
  modelValue: Member
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Member): void
  (e: 'save'): void
  (e: 'cancel'): void
  (e: 'delete'): void
  (e: 'media-stage', photoId: string): void
}>()

// 本地 reactive 拷贝，修改后通过 update:modelValue 同步
const local = reactive<Member>({ ...props.modelValue })

watch(
  () => props.modelValue,
  (v) => {
    Object.assign(local, v)
  },
  { deep: true },
)

function sync() {
  emit('update:modelValue', { ...local })
}

function onPhotoChange(photoId: string | undefined) {
  local.photoId = photoId
  sync()
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="emit('save')">
    <PhotoPicker
      :photo-id="local.photoId"
      @change="onPhotoChange"
      @stage="emit('media-stage', $event)"
    />

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">姓</span>
        <input
          v-model="local.lastName"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">名</span>
        <input
          v-model="local.firstName"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">小名 / 曾用名</span>
        <input
          v-model="local.nickname"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">性别</span>
        <select
          v-model="local.gender"
          class="rounded border border-slate-300 px-2 py-1"
          @change="sync"
        >
          <option value="male">男</option>
          <option value="female">女</option>
          <option value="other">其他</option>
        </select>
      </label>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">出生日期</span>
        <input
          v-model="local.birthDate"
          type="date"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">逝世日期</span>
        <input
          v-model="local.deathDate"
          type="date"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
    </div>

    <label class="flex flex-col gap-1">
      <span class="text-xs text-slate-500">出生地</span>
      <input
        v-model="local.birthPlace"
        class="rounded border border-slate-300 px-2 py-1"
        @input="sync"
      />
    </label>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">职业</span>
        <input
          v-model="local.occupation"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">学历</span>
        <input
          v-model="local.education"
          class="rounded border border-slate-300 px-2 py-1"
          @input="sync"
        />
      </label>
    </div>

    <label class="flex flex-col gap-1">
      <span class="text-xs text-slate-500">当前居住地</span>
      <input
        v-model="local.currentResidence"
        class="rounded border border-slate-300 px-2 py-1"
        @input="sync"
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-xs text-slate-500">备注（支持多行）</span>
      <textarea
        v-model="local.notes"
        rows="4"
        class="rounded border border-slate-300 px-2 py-1"
        @input="sync"
      ></textarea>
    </label>

    <div class="flex justify-between">
      <button
        type="button"
        class="rounded border border-rose-300 bg-white px-3 py-1 text-sm text-rose-600 hover:bg-rose-50"
        @click="emit('delete')"
      >
        删除此成员
      </button>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded border border-slate-300 bg-white px-4 py-1 text-sm hover:bg-slate-100"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="submit"
          class="rounded bg-slate-900 px-4 py-1 text-sm text-white hover:bg-slate-700"
        >
          保存
        </button>
      </div>
    </div>
  </form>
</template>
