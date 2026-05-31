<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom'

/**
 * 通用 PanZoom 容器：
 * - 外层固定 overflow:hidden，占据父容器
 * - 内层 <div class="pz-stage"> 承载实际内容（绝对定位的节点 + SVG 连线）
 * - 鼠标拖拽平移，Ctrl/Meta + 滚轮缩放
 *
 * 状态持久化：
 * - initialView：挂载时用它恢复 pan/zoom（来自父级的 UI store）
 * - view-change：pan/zoom 变化时防抖 emit，让父级写回 store
 */
const stageRef = ref<HTMLDivElement | null>(null)
let pz: PanzoomObject | null = null

export type PanzoomView = { x: number; y: number; scale: number }

const props = defineProps<{
  minScale?: number
  maxScale?: number
  /** 挂载时恢复的 pan/zoom 状态；null 表示从默认值（scale=1, pan=0,0）开始 */
  initialView?: PanzoomView | null
}>()

const emit = defineEmits<{
  (e: 'view-change', v: PanzoomView): void
}>()

function onWheel(e: WheelEvent) {
  if (!pz) return
  // 不按修饰键时，把滚轮用作上下平移（自然）；按下 Ctrl/Meta 时缩放。
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    pz.zoomWithWheel(e)
  }
}

function resetView() {
  pz?.reset()
}

function zoomIn() {
  pz?.zoomIn()
}

function zoomOut() {
  pz?.zoomOut()
}

/** 当前缩放倍率。拖动逻辑需要用它把屏幕 px 反算回 stage 坐标 */
function getScale(): number {
  return pz?.getScale() ?? 1
}

/**
 * 把 stage 内坐标 (stageX, stageY) 平移到视口中心。保持当前缩放。
 * stageX/stageY 的单位是 stage 内部 px（未乘 scale、未含当前 pan 偏移）。
 * 计算：我们希望 pan 后 stage 上的该点出现在视口中心，
 *   viewport_center = pan + stageX * scale  →  pan = viewport_center - stageX * scale
 * Panzoom 的 pan 值就是这里的"pan"（相对视口原点的 stage 偏移）。
 */
function focusStagePoint(stageX: number, stageY: number) {
  if (!pz) return
  const host = stageRef.value?.parentElement as HTMLElement | null
  const stage = stageRef.value
  if (!host || !stage) return
  const hostRect = host.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const scale = pz.getScale()
  const current = pz.getPan()
  const targetScreenX = stageRect.left + stageX * scale
  const targetScreenY = stageRect.top + stageY * scale
  const desiredScreenX = hostRect.left + hostRect.width / 2
  const desiredScreenY = hostRect.top + hostRect.height / 2
  const x = current.x + (desiredScreenX - targetScreenX) / scale
  const y = current.y + (desiredScreenY - targetScreenY) / scale
  pz.pan(x, y, { animate: true, force: true })
}

/** 抓取当前 pan/zoom；panzoom 未就绪时返回 null */
function snapshot(): PanzoomView | null {
  if (!pz) return null
  const p = pz.getPan()
  return { x: p.x, y: p.y, scale: pz.getScale() }
}

// 防抖 emit：panzoomchange 在拖动中每帧都触发，我们不想每一帧都写 store
let emitTimer: ReturnType<typeof setTimeout> | null = null
function scheduleEmit() {
  if (emitTimer !== null) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    const snap = snapshot()
    if (snap) emit('view-change', snap)
  }, 100)
}
function flushEmit() {
  if (emitTimer !== null) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  const snap = snapshot()
  if (snap) emit('view-change', snap)
}

function onPanzoomChange() {
  scheduleEmit()
}

onMounted(() => {
  if (!stageRef.value) return
  const init = props.initialView
  pz = Panzoom(stageRef.value, {
    minScale: props.minScale ?? 0.2,
    maxScale: props.maxScale ?? 3,
    canvas: true,
    startScale: init?.scale ?? 1,
    startX: init?.x ?? 0,
    startY: init?.y ?? 0,
  })
  // panzoom 在内部 pointer 事件驱动 pan/zoom 后 dispatch 'panzoomchange'
  stageRef.value.addEventListener('panzoomchange', onPanzoomChange)
})

onBeforeUnmount(() => {
  // 保存一次最终状态（防抖中可能还没 flush）
  flushEmit()
  stageRef.value?.removeEventListener('panzoomchange', onPanzoomChange)
  pz?.destroy()
  pz = null
})

defineExpose({ resetView, zoomIn, zoomOut, getScale, focusStagePoint, snapshot })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-slate-100" @wheel="onWheel">
    <div ref="stageRef" class="pz-stage absolute left-0 top-0">
      <slot />
    </div>
    <!-- 控件浮动在右下角 -->
    <div class="absolute bottom-4 right-4 flex flex-col gap-1 rounded-md border border-slate-300 bg-white shadow">
      <button class="px-3 py-1 text-lg hover:bg-slate-100" @click="zoomIn">+</button>
      <button class="px-3 py-1 text-lg hover:bg-slate-100" @click="zoomOut">−</button>
      <button class="px-3 py-1 text-xs hover:bg-slate-100" @click="resetView">重置</button>
    </div>
  </div>
</template>

<style scoped>
.pz-stage {
  /* Panzoom 会直接改 transform，父容器只负责承载 */
  transform-origin: 0 0;
}
</style>
