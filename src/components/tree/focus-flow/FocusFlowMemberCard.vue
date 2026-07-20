<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Member } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'
import { resolvePhotoUrl } from '@/services/tauriApi'
import DefaultAvatar from '@/components/member/DefaultAvatar.vue'
import { getDefaultAvatarAgeBand } from '@/core/defaultAvatar'

const props = defineProps<{
  member: Member
  selected?: boolean
  isFocus?: boolean
  kinship?: string | null
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'open', id: string): void
  (event: 'focus', id: string): void
}>()

const family = useFamilyStore()
const photoUrl = ref<string | null>(null)
let photoRequest = 0
const ageBand = computed(() => getDefaultAvatarAgeBand(props.member))

watch(
  () => [props.member.photoId, family.projectPath] as const,
  async ([photoId, projectPath]) => {
    const request = ++photoRequest
    const previous = photoUrl.value
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
    photoUrl.value = null
    if (!photoId || !projectPath) return
    try {
      const next = await resolvePhotoUrl(projectPath, photoId, true)
      if (request !== photoRequest) {
        if (next.startsWith('blob:')) URL.revokeObjectURL(next)
        return
      }
      photoUrl.value = next
    } catch {
      // 照片读取失败时使用确定性的默认头像。
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  photoRequest += 1
  if (photoUrl.value?.startsWith('blob:')) URL.revokeObjectURL(photoUrl.value)
})

const fullName = computed(() => (
  `${props.member.lastName}${props.member.firstName}`.trim()
  || props.member.nickname?.trim()
  || '未命名'
))

const lifeSpan = computed(() => {
  const birth = props.member.birthDate?.slice(0, 4)
  const death = props.member.deathDate?.slice(0, 4)
  if (birth && death) return `${birth} – ${death}`
  if (birth) return `${birth}–`
  if (death) return `?–${death}`
  return ''
})
</script>

<template>
  <article
    data-testid="focus-member-card"
    :data-member-id="member.id"
    class="overflow-hidden rounded-xl border bg-white shadow-sm"
    :class="[
      selected ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200',
      isFocus ? 'ring-2 ring-emerald-400' : '',
    ]"
  >
    <button
      class="flex min-h-24 w-full items-stretch text-left active:bg-slate-50"
      :aria-label="`选择${fullName}`"
      @click="emit('select', member.id)"
    >
      <div class="h-24 w-20 shrink-0 overflow-hidden bg-slate-100">
        <img
          v-if="photoUrl"
          :src="photoUrl"
          class="h-full w-full object-cover"
          alt=""
          draggable="false"
        >
        <DefaultAvatar
          v-else
          :gender="member.gender"
          :age-band="ageBand"
        />
      </div>
      <div class="min-w-0 flex-1 px-3 py-2">
        <div class="flex items-start justify-between gap-2">
          <span class="truncate font-semibold text-slate-900">{{ fullName }}</span>
          <span
            v-if="isFocus"
            class="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
          >聚焦</span>
        </div>
        <p v-if="kinship" class="mt-1 truncate text-xs font-medium text-emerald-700">
          {{ kinship }}
        </p>
        <p v-if="lifeSpan" class="mt-1 text-xs text-slate-500">{{ lifeSpan }}</p>
        <p v-if="member.occupation" class="mt-1 truncate text-xs text-slate-500">
          {{ member.occupation }}
        </p>
      </div>
    </button>
    <div class="grid grid-cols-2 border-t border-slate-100 text-sm">
      <button
        :data-testid="`focus-member-open-${member.id}`"
        class="min-h-11 border-r border-slate-100 text-slate-600 active:bg-slate-100"
        @click="emit('open', member.id)"
      >详情</button>
      <button
        :data-testid="`focus-member-refocus-${member.id}`"
        class="min-h-11 font-medium text-emerald-700 active:bg-emerald-50"
        :disabled="isFocus"
        @click="emit('focus', member.id)"
      >{{ isFocus ? '当前聚焦' : '聚焦此人' }}</button>
    </div>
  </article>
</template>
