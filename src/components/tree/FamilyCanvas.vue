<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { Member } from '@/core/schema'
import type { LayoutResult } from '@/core/treeLayout'
import { layoutFamilyTree } from '@/core/treeLayout'
import PanZoomWrapper, { type PanzoomView } from './PanZoomWrapper.vue'
import MemberNode from './MemberNode.vue'
import { useFamilyStore } from '@/stores/family'

const props = defineProps<{
  members: Member[]
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  /** 手工拖动后的节点位置（cell 单位，未平移的原始坐标） */
  manualPositions?: Record<string, { cx: number; top: number }>
  /** 初始 pan/zoom；父级从 UI store 读取后下传，挂载时恢复 */
  initialView?: PanzoomView | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'open', id: string): void
  (e: 'view-change', v: PanzoomView): void
}>()

const family = useFamilyStore()

// 节点真实像素尺寸。布局算法用 cell 单位：NODE_W(=2 cell) = 110px，因此 CELL_PX=55；
// ROW_HEIGHT(=4 cell) = 220px，刚好容纳 NODE_H=210 + 间距。
const NODE_W_PX = 110
const NODE_H_PX = 210
const CELL_PX = 55
const PADDING = 40
/** 拖动吸附网格（像素） */
const SNAP_PX = 5

// 防抖/稳定：rootId 当前未用到（新布局是整图），保留以便以后支持"居中到某人"
void props.rootId

const panzoomRef = ref<InstanceType<typeof PanZoomWrapper> | null>(null)

const layout = ref<LayoutResult>({ nodes: [], couples: [], connectors: [], canvas: { width: 0, height: 0 }, orphanIds: [], offsetX: 0 })

async function updateLayout() {
  layout.value = await layoutFamilyTree(props.members, { manualPositions: props.manualPositions })
}

watch(() => [props.members, props.manualPositions], updateLayout, { immediate: true, deep: true })

const canvasSize = computed(() => ({
  width: Math.max(layout.value.canvas.width * CELL_PX + PADDING * 2, 600),
  height: Math.max(layout.value.canvas.height * CELL_PX + PADDING * 2, 400),
}))

const placedNodes = computed(() => {
  const rows: Array<{
    id: string
    member: Member
    left: number
    top: number
  }> = []
  for (const n of layout.value.nodes) {
    const member = props.members.find((m) => m.id === n.id)
    if (!member) continue
    rows.push({
      id: n.id,
      member,
      left: n.cx * CELL_PX + PADDING - NODE_W_PX / 2,
      top: n.top * CELL_PX + PADDING,
    })
  }
  return rows
})

/**
 * 连线：布局返回的是基于 cell 的折线段列表；转成 SVG polyline。
 * 父母-子女连线的 y 坐标是"节点顶或底"，我们用 NODE_H_PX 还原像素。
 */
const svgLines = computed(() => {
  return layout.value.connectors.map((c) => {
    const pts = c.points
      .map((p) => {
        const x = p.x * CELL_PX + PADDING
        // 布局里的 y 单位：0 = 节点顶；1 cell ≈ 一半节点高
        // 为了让连线从"节点底部"发出/进入"节点顶部"，把 y 从 cell 单位直接转 CELL_PX 再乘以 NODE_H 比例
        const y = p.y * CELL_PX + PADDING
        return `${x},${y}`
      })
      .join(' ')
    return { points: pts, kind: c.kind }
  })
})

const orphanCount = computed(() => layout.value.orphanIds.length)

/**
 * 聚焦到某个成员节点：计算该节点在 stage 内部的中心点，交给 PanZoomWrapper
 * 平移到视口中心。维持当前缩放比例。
 */
function focusMember(id: string) {
  const n = placedNodes.value.find((p) => p.id === id)
  if (!n) return
  const pz = panzoomRef.value
  if (!pz) return
  const stageX = n.left + NODE_W_PX / 2
  const stageY = n.top + NODE_H_PX / 2
  pz.focusStagePoint(stageX, stageY)
}

/**
 * 视角变化时自动聚焦。注意这里**不要**用 immediate: true ——
 * 否则每次 FamilyCanvas 重挂载（例如从 MemberDetail 返回 /tree）
 * 都会重新聚焦，把用户平移过的画布位置抹掉。
 *
 * 另外，如果父级传入了 initialView（= UI store 里有上次的 pan/zoom），
 * 说明是路由往返回来的，应优先保持那个位置；这种情况下即便刚挂载时
 * viewpointId 正好被 TreeView 首次恢复成一个值，也**不聚焦**。
 * 用 hasRestoredInitialView 标记这种抑制。
 */
const hasRestoredInitialView = !!props.initialView
let suppressNextFocus = hasRestoredInitialView
watch(
  () => props.viewpointId,
  (id, prev) => {
    if (!id) return
    if (id === prev) return
    if (suppressNextFocus) {
      suppressNextFocus = false
      return
    }
    nextTick(() => focusMember(id))
  },
)

defineExpose({ focusMember })

/**
 * 拖动期间每个节点的瞬时偏移（stage 内坐标系的 px）。
 * key = memberId，value = {dx, dy}。拖动结束后清掉，并把最终位置写入 store。
 * 用 reactive Map-like 对象以便模板响应。
 */
const dragDelta = reactive<Record<string, { dx: number; dy: number }>>({})

function screenToStageScale(): number {
  return panzoomRef.value?.getScale() ?? 1
}

function onNodeDrag(payload: { id: string; dx: number; dy: number }) {
  const scale = screenToStageScale()
  // 屏幕 px → stage 内 px
  dragDelta[payload.id] = { dx: payload.dx / scale, dy: payload.dy / scale }
}

function onNodeDrop(payload: { id: string; dx: number; dy: number }) {
  const scale = screenToStageScale()
  const base = placedNodes.value.find((p) => p.id === payload.id)
  delete dragDelta[payload.id]
  if (!base) return
  const stageDx = payload.dx / scale
  const stageDy = payload.dy / scale
  // 本次 drop 之前节点的"起始 left/top"其实就是 base.left/top（base 包含了 manualPositions 的覆盖）
  let newLeft = base.left + stageDx
  let newTop = base.top + stageDy
  // 吸附到 5px 网格
  newLeft = Math.round(newLeft / SNAP_PX) * SNAP_PX
  newTop = Math.round(newTop / SNAP_PX) * SNAP_PX
  // 反算成 layout 的 cell 坐标（含 offsetX 平移）→ 存储前需要把 offsetX 加回去
  //   placedNodes.left = (n.cx * CELL_PX + PADDING) - NODE_W_PX / 2
  //   其中 n.cx 已包含平移；原始 n.cx - offsetX 才是持久化的坐标
  const cxWithOffset = (newLeft + NODE_W_PX / 2 - PADDING) / CELL_PX
  const top = (newTop - PADDING) / CELL_PX
  const cx = cxWithOffset - layout.value.offsetX
  family.setManualPosition(payload.id, cx, top)
}
</script>

<template>
  <div class="relative h-full w-full">
    <PanZoomWrapper
      ref="panzoomRef"
      :initial-view="initialView ?? null"
      @view-change="(v) => emit('view-change', v)"
    >
      <div
        class="relative"
        :style="{
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`,
        }"
      >
        <svg
          class="pointer-events-none absolute left-0 top-0"
          :width="canvasSize.width"
          :height="canvasSize.height"
        >
          <polyline
            v-for="(l, i) in svgLines"
            :key="i"
            :points="l.points"
            :stroke="l.kind === 'spouse' ? '#f472b6' : l.kind === 'godparent' ? '#8b5cf6' : '#94a3b8'"
            :stroke-width="2"
            :stroke-dasharray="l.kind === 'godparent' ? '6,4' : undefined"
            fill="none"
          />
        </svg>

        <MemberNode
          v-for="n in placedNodes"
          :key="n.id"
          :member="n.member"
          :left="n.left + (dragDelta[n.id]?.dx ?? 0)"
          :top="n.top + (dragDelta[n.id]?.dy ?? 0)"
          :width="NODE_W_PX"
          :height="NODE_H_PX"
          :selected="selectedId === n.id"
          :is-viewpoint="viewpointId === n.id"
          :style="dragDelta[n.id] ? { zIndex: 50, transition: 'none' } : undefined"
          :kinship="viewpointId && getKinship ? (getKinship(viewpointId, n.id) ?? undefined) : undefined"
          @click="emit('select', n.id)"
          @dblclick="emit('open', n.id)"
          @drag="onNodeDrag"
          @drop="onNodeDrop"
        />

        <div
          v-if="placedNodes.length === 0"
          class="absolute inset-0 flex items-center justify-center text-slate-400"
        >
          暂无成员 — 点击上方"添加成员"开始
        </div>
      </div>
    </PanZoomWrapper>
    <div
      v-if="orphanCount > 0"
      class="pointer-events-none absolute left-4 top-4 rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 shadow"
    >
      有 {{ orphanCount }} 位成员未显示
    </div>
  </div>
</template>
