<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Member } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'
import { resolvePhotoUrl } from '@/services/tauriApi'

const props = defineProps<{
  member: Member
  /** 节点在父级 FamilyUnit 内的局部坐标（像素） */
  left: number
  top: number
  width: number
  height: number
  selected?: boolean
  /** 可选的称呼标签（由 M5 的 getKinship 计算） */
  kinship?: string
  /** 是否是当前视角中心 */
  isViewpoint?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
  (e: 'dblclick', id: string): void
  (e: 'drag', payload: { id: string; dx: number; dy: number }): void
  (e: 'drop', payload: { id: string; dx: number; dy: number }): void
}>()

const family = useFamilyStore()
const photoUrl = ref<string | null>(null)

watch(
  () => [props.member.photoId, family.projectPath] as const,
  async ([photoId, path]) => {
    if (!photoId || !path) {
      photoUrl.value = null
      return
    }
    try {
      photoUrl.value = await resolvePhotoUrl(path, photoId, true)
    } catch {
      photoUrl.value = null
    }
  },
  { immediate: true },
)

const fullName = computed(() => {
  const ln = props.member.lastName?.trim() ?? ''
  const fn = props.member.firstName?.trim() ?? ''
  const combined = `${ln}${fn}`
  if (combined) return combined
  const nick = props.member.nickname?.trim()
  if (nick) return nick
  return '未命名'
})

const genderColor = computed(() => {
  switch (props.member.gender) {
    case 'male':
      return 'border-sky-400'
    case 'female':
      return 'border-pink-400'
    default:
      return 'border-slate-300'
  }
})

const lifeSpan = computed(() => {
  const b = props.member.birthDate?.slice(0, 4)
  const d = props.member.deathDate?.slice(0, 4)
  if (b && d) return `${b} – ${d}`
  if (b) return `${b}–`
  if (d) return `?–${d}`
  return ''
})

const photoHeight = computed(() => Math.min(
  props.width * 4 / 3,
  Math.max(0, props.height - 64),
  Math.round(props.height * 0.68),
))

function onClick() {
  emit('click', props.member.id)
}
function onDblClick() {
  emit('dblclick', props.member.id)
}

/**
 * 拖动实现：
 * - pointerdown 开始记录；只有位移超过 DRAG_THRESHOLD_PX 才真正进入"拖动"模式
 * - 未进入拖动 → pointerup 时照常 emit click
 * - 进入拖动 → pointermove 持续 emit 'drag'（父级给节点加 transform 跟手）
 *             pointerup 时 emit 'drop'（父级写入 store，autosave 会持久化）
 *
 * stopPropagation：阻止 Panzoom 在 stage 层级拿到 pointerdown，
 * 避免整个画布一起被拖走。
 */
const DRAG_THRESHOLD_PX = 3
let dragStartX = 0
let dragStartY = 0
let dragging = false
let dragCaptured = false
let activePointerId: number | null = null

function onPointerDown(e: PointerEvent) {
  // 只响应主键（鼠标左键 / 触摸 / 笔）
  if (e.button !== 0 && e.pointerType === 'mouse') return
  e.stopPropagation()
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragging = false
  dragCaptured = false
  activePointerId = e.pointerId
  const el = e.currentTarget as HTMLElement
  try {
    el.setPointerCapture(e.pointerId)
    dragCaptured = true
  } catch {
    // Safari 偶发 InvalidStateError — 退化为全局监听
  }
}

function onPointerMove(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
  dragging = true
  emit('drag', { id: props.member.id, dx, dy })
}

function onPointerUp(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  const wasDragging = dragging
  if (dragCaptured) {
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  activePointerId = null
  dragging = false
  dragCaptured = false
  if (wasDragging) {
    emit('drop', { id: props.member.id, dx, dy })
  }
}

function onPointerCancel(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return
  activePointerId = null
  dragging = false
  dragCaptured = false
  // 通知父级复位：dx=dy=0 相当于取消
  emit('drop', { id: props.member.id, dx: 0, dy: 0 })
}
</script>

<template>
  <div
    data-testid="member-node"
    class="absolute flex cursor-grab flex-col overflow-hidden rounded-xl border-2 shadow-sm transition-shadow select-none hover:shadow-md active:cursor-grabbing"
    :class="[
      'bg-white',
      genderColor,
      selected ? 'ring-2 ring-amber-400' : '',
      isViewpoint ? 'ring-2 ring-emerald-500' : '',
    ]"
    :style="{
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    }"
    @click.stop="onClick"
    @dblclick.stop="onDblClick"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <!-- 照片优先保持竖幅，但必须为姓名、称呼和生卒信息留出文本区。 -->
    <div
      data-testid="member-photo"
      class="relative w-full flex-shrink-0 bg-slate-100"
      :style="{ height: `${photoHeight}px` }"
    >
      <img
        v-if="photoUrl"
        :src="photoUrl"
        class="h-full w-full object-cover"
        alt=""
        draggable="false"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-3xl text-slate-300"
      >
        {{ member.gender === 'female' ? '♀' : member.gender === 'male' ? '♂' : '·' }}
      </div>
    </div>
    <!-- 下半：姓名/称呼/生卒，flex-1 占满剩余，内容垂直居中 -->
    <div
      data-testid="member-details"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1"
    >
      <div
        data-testid="member-name"
        class="max-w-full truncate text-center text-sm font-semibold leading-tight"
      >
        {{ fullName }}
      </div>
      <div
        v-if="kinship"
        data-testid="member-kinship"
        class="max-w-full truncate text-[11px] font-medium text-emerald-600"
      >
        {{ kinship }}
      </div>
      <div v-if="lifeSpan" data-testid="member-lifespan" class="text-[10px] text-slate-400">
        {{ lifeSpan }}
      </div>
    </div>
  </div>
</template>
