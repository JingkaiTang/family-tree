<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutDiagnostic } from '@/core/family-layout/types'

const props = defineProps<{ diagnostics: LayoutDiagnostic[] }>()
const emit = defineEmits<{ (event: 'dismiss'): void }>()

const title = computed(() => (
  props.diagnostics.every(value => (
    value.code === 'UNROUTABLE_PRIMARY_EDGE'
    || value.code === 'CROSS_FAMILY_SEGMENT_OVERLAP'
    || value.code === 'NODE_OVERLAP'
  ))
    ? '连线路由已降级'
    : '家谱数据需要检查'
))
</script>

<template>
  <div
    data-testid="layout-diagnostics"
    class="absolute left-1/2 top-3 z-50 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-lg backdrop-blur"
    role="status"
  >
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="font-semibold">{{ title }}</div>
        <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          <li
            v-for="diagnostic in diagnostics"
            :key="`${diagnostic.code}:${diagnostic.ids.join(',')}`"
          >
            {{ diagnostic.message }}
          </li>
        </ul>
      </div>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs hover:bg-amber-100"
        aria-label="关闭布局诊断"
        @click="emit('dismiss')"
      >
        关闭
      </button>
    </div>
  </div>
</template>
