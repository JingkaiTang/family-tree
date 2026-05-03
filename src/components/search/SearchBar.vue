<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  onJump?: (id: string) => void
}>()

const family = useFamilyStore()
const ui = useUiStore()

const q = ref('')
const open = ref(false)

const matches = computed(() => {
  const raw = q.value.trim().toLowerCase()
  if (!raw) return []
  return family.membersArray
    .filter((m) => {
      const full = `${m.lastName}${m.firstName}`.toLowerCase()
      const nick = (m.nickname ?? '').toLowerCase()
      const occ = (m.occupation ?? '').toLowerCase()
      const place = (m.birthPlace ?? '').toLowerCase()
      return full.includes(raw) || nick.includes(raw) || occ.includes(raw) || place.includes(raw)
    })
    .slice(0, 10)
})

function jump(id: string) {
  ui.setSelected(id)
  open.value = false
  props.onJump?.(id)
}

function onFocus() {
  open.value = true
}
function onBlur() {
  // 延迟关闭，让 click 事件先触发
  setTimeout(() => (open.value = false), 150)
}
</script>

<template>
  <div class="relative w-64">
    <input
      v-model="q"
      type="search"
      placeholder="搜索成员…"
      class="w-full rounded border border-slate-300 bg-white px-3 py-1 text-sm"
      @focus="onFocus"
      @blur="onBlur"
    />
    <div
      v-if="open && matches.length > 0"
      class="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded border border-slate-200 bg-white shadow-lg"
    >
      <button
        v-for="m in matches"
        :key="m.id"
        class="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
        @mousedown.prevent="jump(m.id)"
      >
        <div class="font-medium">{{ m.lastName }}{{ m.firstName }}</div>
        <div v-if="m.nickname || m.occupation" class="text-xs text-slate-500">
          {{ [m.nickname, m.occupation].filter(Boolean).join(' · ') }}
        </div>
      </button>
    </div>
    <div
      v-else-if="open && q.trim() && matches.length === 0"
      class="absolute left-0 right-0 top-full z-20 mt-1 rounded border border-slate-200 bg-white p-3 text-xs text-slate-400 shadow-lg"
    >
      无匹配成员
    </div>
  </div>
</template>
