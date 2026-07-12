<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { LayoutScene, Point } from '@/core/family-layout/types'
import type { FamilyData, Member } from '@/core/schema'
import { layoutFamilyTree } from '@/core/treeLayout'
import PanZoomWrapper, { type PanzoomView } from './PanZoomWrapper.vue'
import FamilyUnit, { type FamilyUnitDragPayload } from './FamilyUnit.vue'
import GridBackground from './GridBackground.vue'
import RelationLayer from './RelationLayer.vue'

const props = defineProps<{
  members: Member[]
  data: FamilyData
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  initialView?: PanzoomView | null
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'open', id: string): void
  (event: 'view-change', value: PanzoomView): void
}>()

const PADDING = 40
const EMPTY_SCENE: LayoutScene = {
  units: [],
  cards: [],
  hubs: [],
  rows: [],
  routes: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  diagnostics: [],
}

void props.rootId

const panzoomRef = ref<InstanceType<typeof PanZoomWrapper> | null>(null)
const scene = ref<LayoutScene>(EMPTY_SCENE)
let layoutRequestId = 0

async function updateLayout() {
  const requestId = ++layoutRequestId
  const nextScene = await layoutFamilyTree(props.members, { data: props.data })
  if (requestId !== layoutRequestId) return
  scene.value = nextScene
}

watch(
  () => [props.members, props.data],
  updateLayout,
  { immediate: true, deep: true },
)

const sceneOffset = computed(() => ({
  x: PADDING - scene.value.bounds.x,
  y: PADDING - scene.value.bounds.y,
}))

const canvasSize = computed(() => ({
  width: Math.max(scene.value.bounds.width + PADDING * 2, 600),
  height: Math.max(scene.value.bounds.height + PADDING * 2, 400),
}))

const cardsByUnitId = computed(() => {
  const values = new Map<string, LayoutScene['cards']>()
  for (const card of scene.value.cards) {
    const cards = values.get(card.unitId) ?? []
    cards.push(card)
    values.set(card.unitId, cards)
  }
  return values
})

const hubsByUnitId = computed(() => {
  const values = new Map<string, LayoutScene['hubs']>()
  for (const hub of scene.value.hubs) {
    const hubs = values.get(hub.unitId) ?? []
    hubs.push(hub)
    values.set(hub.unitId, hubs)
  }
  return values
})

const kinshipByMemberId = computed<Record<string, string>>(() => {
  const viewpointId = props.viewpointId
  const resolveKinship = props.getKinship
  if (!viewpointId || !resolveKinship) return {}
  return Object.fromEntries(props.members.flatMap(member => {
    const kinship = resolveKinship(viewpointId, member.id)
    return kinship ? [[member.id, kinship]] : []
  }))
})

function focusMember(id: string) {
  const card = scene.value.cards.find(value => value.id === id)
  if (!card || !panzoomRef.value) return
  panzoomRef.value.focusStagePoint(
    card.rect.x + card.rect.width / 2 + sceneOffset.value.x,
    card.rect.y + card.rect.height / 2 + sceneOffset.value.y,
  )
}

const hasRestoredInitialView = !!props.initialView
let suppressNextFocus = hasRestoredInitialView
watch(
  () => props.viewpointId,
  (id, previousId) => {
    if (!id || id === previousId) return
    if (suppressNextFocus) {
      suppressNextFocus = false
      return
    }
    nextTick(() => focusMember(id))
  },
)

defineExpose({ focusMember })

const dragOffsets = reactive<Record<string, Point>>({})

function screenToStageScale(): number {
  return panzoomRef.value?.getScale() ?? 1
}

function onUnitDrag(payload: FamilyUnitDragPayload) {
  const scale = screenToStageScale()
  dragOffsets[payload.unitId] = {
    x: payload.dx / scale,
    y: payload.dy / scale,
  }
}

function onUnitDrop(payload: FamilyUnitDragPayload) {
  delete dragOffsets[payload.unitId]
}
</script>

<template>
  <div class="relative h-full w-full">
    <PanZoomWrapper
      ref="panzoomRef"
      :initial-view="initialView ?? null"
      @view-change="emit('view-change', $event)"
    >
      <div
        class="relative"
        :style="{
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`,
        }"
      >
        <GridBackground />

        <div
          class="absolute left-0 top-0"
          :style="{
            transform: `translate(${sceneOffset.x}px, ${sceneOffset.y}px)`,
            transformOrigin: '0 0',
          }"
        >
          <RelationLayer
            :routes="scene.routes"
            :width="canvasSize.width"
            :height="canvasSize.height"
          />

          <FamilyUnit
            v-for="unit in scene.units"
            :key="unit.id"
            :unit="unit"
            :cards="cardsByUnitId.get(unit.id) ?? []"
            :members="members"
            :hubs="hubsByUnitId.get(unit.id) ?? []"
            :selected-id="selectedId"
            :viewpoint-id="viewpointId"
            :drag-offset="dragOffsets[unit.id]"
            :kinship-by-member-id="kinshipByMemberId"
            @unit-drag="onUnitDrag"
            @unit-drop="onUnitDrop"
            @select="emit('select', $event)"
            @open="emit('open', $event)"
          />
        </div>

        <div
          v-if="scene.cards.length === 0"
          class="absolute inset-0 flex items-center justify-center text-slate-400"
        >
          暂无成员 — 点击上方"添加成员"开始
        </div>
      </div>
    </PanZoomWrapper>
  </div>
</template>
