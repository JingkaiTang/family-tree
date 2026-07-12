<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { DEFAULT_LAYOUT_METRICS, type LayoutScene, type Point } from '@/core/family-layout/types'
import type { FamilyData } from '@/core/schema'
import { withRowOrderPreference } from '@/core/family-layout/reconcilePreferences'
import { layoutFamilyTree } from '@/core/treeLayout'
import PanZoomWrapper, { type PanzoomView } from './PanZoomWrapper.vue'
import FamilyUnit, { type FamilyUnitDragPayload } from './FamilyUnit.vue'
import GridBackground from './GridBackground.vue'
import RelationLayer from './RelationLayer.vue'

const props = defineProps<{
  data: FamilyData
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  initialView?: PanzoomView | null
  showAuxiliaryRelations?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'open', id: string): void
  (event: 'view-change', value: PanzoomView): void
  (event: 'row-order-change', rowId: string, unitIds: string[]): void
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
const members = computed(() => Object.values(props.data.members))
let layoutRequestId = 0
let suppressInitialSceneFocus = !!props.initialView
let expectedRowUpdate: { rowId: string; unitIds: string[] } | null = null
let pendingDropToken: number | null = null
let pendingSceneRecovery: { data: FamilyData; changedIds: string[] } | null = null
let auxiliaryRefreshQueued = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
const animatePositions = ref(false)

async function updateLayout(options: {
  data?: FamilyData
  previousScene?: LayoutScene
  changedIds?: string[]
} = {}) {
  const requestId = ++layoutRequestId
  const pendingTokenAtRequest = pendingDropToken
  const layoutData = options.data ?? props.data
  const showAuxiliaryRelations = props.showAuxiliaryRelations === true
  const nextScene = await layoutFamilyTree(Object.values(layoutData.members), {
    data: layoutData,
    view: {
      showHistoricalPartnerships: showAuxiliaryRelations,
      showSecondaryParentage: showAuxiliaryRelations,
      showGodparentRelations: showAuxiliaryRelations,
    },
    ...(showAuxiliaryRelations && props.selectedId
      ? { auxiliaryFocusPersonId: props.selectedId }
      : {}),
    ...(options.previousScene ? { previousScene: options.previousScene } : {}),
    ...(options.changedIds ? { changedIds: options.changedIds } : {}),
  })
  if (requestId !== layoutRequestId) return
  const shouldSuppressFocus = suppressInitialSceneFocus
  suppressInitialSceneFocus = false
  const shouldSettleDrag = pendingTokenAtRequest !== null
    && pendingTokenAtRequest === pendingDropToken
  if (shouldSettleDrag) {
    animatePositions.value = true
    if (settleTimer !== null) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      animatePositions.value = false
      settleTimer = null
    }, 180)
  }
  scene.value = nextScene
  pendingSceneRecovery = null
  if (shouldSettleDrag) {
    dragState.value = null
    dragCanDrop.value = false
    pendingDropToken = null
  }
  await nextTick()
  if (requestId !== layoutRequestId) return
  const viewpointId = props.viewpointId
  if (viewpointId && !shouldSuppressFocus) focusMember(viewpointId)
  flushQueuedAuxiliaryRefresh(nextScene)
}

function requestAuxiliaryRefresh() {
  if (
    dragState.value !== null
    || pendingDropToken !== null
    || pendingSceneRecovery !== null
  ) {
    auxiliaryRefreshQueued = true
    return
  }
  auxiliaryRefreshQueued = false
  void updateLayout()
}

function flushQueuedAuxiliaryRefresh(previousScene: LayoutScene) {
  if (
    !auxiliaryRefreshQueued
    || dragState.value !== null
    || pendingDropToken !== null
    || pendingSceneRecovery !== null
  ) return
  auxiliaryRefreshQueued = false
  void updateLayout({ previousScene, changedIds: [] })
}

watch(
  () => props.data,
  () => {
    if (expectedRowUpdate && hasExpectedRowOrder(props.data, expectedRowUpdate)) {
      expectedRowUpdate = null
      return
    }
    expectedRowUpdate = null
    void updateLayout()
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.showAuxiliaryRelations, props.selectedId] as const,
  requestAuxiliaryRefresh,
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
  return Object.fromEntries(members.value.flatMap(member => {
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

watch(
  () => props.viewpointId,
  (id, previousId) => {
    if (!id || id === previousId) return
    nextTick(() => focusMember(id))
  },
)

defineExpose({ focusMember })

interface FamilyDragState {
  unitId: string
  rowId: string
  sourceIndex: number
  targetIndex: number
  dx: number
  dy: number
}

const dragState = ref<FamilyDragState | null>(null)
const dragCanDrop = ref(false)
let dragToken = 0

function screenToStageScale(): number {
  return panzoomRef.value?.getScale() ?? 1
}

function onUnitDrag(payload: FamilyUnitDragPayload) {
  const scale = screenToStageScale()
  const unit = scene.value.units.find(value => value.id === payload.unitId)
  const sourceRow = scene.value.rows.find(row => row.unitIds.includes(payload.unitId))
  if (!unit || !sourceRow) return
  const sourceIndex = sourceRow.unitIds.indexOf(payload.unitId)
  const dx = payload.dx / scale
  const dy = payload.dy / scale
  const row = closestRow(unit.rect.y + unit.rect.height / 2 + dy)
  const sameGeneration = row?.generation === sourceRow.generation
  const targetIndex = sameGeneration
    ? insertionIndex(sourceRow.unitIds, payload.unitId, unit.rect.x + unit.rect.width / 2 + dx)
    : sourceIndex

  if (
    !dragState.value
    || dragState.value.unitId !== payload.unitId
    || pendingDropToken !== null
  ) {
    layoutRequestId += 1
    dragToken += 1
    pendingDropToken = null
  }
  dragState.value = {
    unitId: payload.unitId,
    rowId: sourceRow.id,
    sourceIndex,
    targetIndex,
    dx,
    dy,
  }
  dragCanDrop.value = sameGeneration && targetIndex !== sourceIndex
}

async function onUnitDrop(payload: FamilyUnitDragPayload) {
  onUnitDrag(payload)
  const state = dragState.value
  if (!state || state.unitId !== payload.unitId || !dragCanDrop.value) {
    clearDrag(payload.unitId)
    return
  }
  const rowOrder = previewUnitIds.value
  if (!rowOrder) {
    clearDrag(payload.unitId)
    return
  }

  const previousScene = scene.value
  const nextData = withRowOrderPreference(props.data, state.rowId, rowOrder)
  const changedIds = affectedMemberIds(payload.memberIds)
  pendingSceneRecovery = { data: nextData, changedIds }
  pendingDropToken = dragToken
  const expectation = { rowId: state.rowId, unitIds: [...rowOrder] }
  expectedRowUpdate = expectation
  emit('row-order-change', state.rowId, [...rowOrder])
  void nextTick(() => {
    if (expectedRowUpdate === expectation) expectedRowUpdate = null
  })
  await updateLayout({
    data: nextData,
    previousScene,
    changedIds,
  })
}

function hasExpectedRowOrder(
  data: FamilyData,
  expected: { rowId: string; unitIds: string[] },
): boolean {
  const row = data.layoutPreferences.rowOrders.find(value => value.id === expected.rowId)
  return row?.unitIds.length === expected.unitIds.length
    && row.unitIds.every((unitId, index) => unitId === expected.unitIds[index])
}

function onUnitCancel(payload: FamilyUnitDragPayload) {
  clearDrag(payload.unitId)
}

function clearDrag(unitId: string) {
  if (dragState.value?.unitId !== unitId) return
  dragState.value = null
  dragCanDrop.value = false
  pendingDropToken = null
  const recovery = pendingSceneRecovery
  if (!recovery) {
    flushQueuedAuxiliaryRefresh(scene.value)
    return
  }
  void updateLayout({
    data: recovery.data,
    previousScene: scene.value,
    changedIds: recovery.changedIds,
  })
}

function closestRow(centerY: number) {
  return scene.value.rows
    .map(row => {
      const rowUnits = row.unitIds
        .map(unitId => scene.value.units.find(unit => unit.id === unitId))
        .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
      const rowCenterY = rowUnits.length === 0
        ? Number.POSITIVE_INFINITY
        : rowUnits.reduce((sum, unit) => sum + unit.rect.y + unit.rect.height / 2, 0) / rowUnits.length
      return { ...row, distance: Math.abs(rowCenterY - centerY) }
    })
    .sort((left, right) => left.distance - right.distance || left.generation - right.generation)[0]
}

function insertionIndex(unitIds: string[], draggedUnitId: string, centerX: number): number {
  const remainingIds = unitIds.filter(unitId => unitId !== draggedUnitId)
  const index = remainingIds.findIndex(unitId => {
    const unit = scene.value.units.find(value => value.id === unitId)
    return unit !== undefined && centerX <= unit.rect.x + unit.rect.width / 2
  })
  return index < 0 ? remainingIds.length : index
}

function arrayMove<T>(values: T[], from: number, to: number): T[] {
  const result = [...values]
  const [value] = result.splice(from, 1)
  if (value === undefined) return result
  result.splice(to, 0, value)
  return result
}

const previewUnitIds = computed(() => {
  const state = dragState.value
  if (!state || !dragCanDrop.value) return null
  const row = scene.value.rows.find(value => value.id === state.rowId)
  if (!row) return null
  return arrayMove(row.unitIds, state.sourceIndex, state.targetIndex)
})

const previewOffsetByUnitId = computed<Record<string, Point>>(() => {
  const state = dragState.value
  const order = previewUnitIds.value
  if (!state || !order) return {}
  const row = scene.value.rows.find(value => value.id === state.rowId)
  if (!row) return {}
  const rowUnits = row.unitIds
    .map(unitId => scene.value.units.find(unit => unit.id === unitId))
    .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
  const rowGap = rowUnits.slice(1).reduce<number | null>((minimum, unit, index) => {
    const previous = rowUnits[index]
    const gap = unit.rect.x - previous.rect.x - previous.rect.width
    if (gap < 0) return minimum
    return minimum === null ? gap : Math.min(minimum, gap)
  }, null) ?? DEFAULT_LAYOUT_METRICS.familyGap
  let nextX = Math.min(...rowUnits.map(unit => unit.rect.x))
  const previewXByUnitId = new Map<string, number>()
  for (const unitId of order) {
    const unit = scene.value.units.find(value => value.id === unitId)
    if (!unit) continue
    previewXByUnitId.set(unitId, nextX)
    nextX += unit.rect.width + rowGap
  }
  return Object.fromEntries(order.flatMap(unitId => {
    if (unitId === state.unitId) return []
    const unit = scene.value.units.find(value => value.id === unitId)
    const previewX = previewXByUnitId.get(unitId)
    return unit && previewX !== undefined
      ? [[unitId, { x: previewX - unit.rect.x, y: 0 }]]
      : []
  }))
})

const draggedUnit = computed(() => {
  const unitId = dragState.value?.unitId
  return unitId ? scene.value.units.find(unit => unit.id === unitId) : undefined
})

const fadedRouteIds = computed(() => {
  const unit = draggedUnit.value
  if (!unit) return []
  const contacts = [
    ...scene.value.hubs
      .filter(hub => hub.unitId === unit.id)
      .map(hub => hub.point),
    ...scene.value.cards
      .filter(card => card.unitId === unit.id)
      .map(card => ({
        x: card.rect.x + card.rect.width / 2,
        y: card.rect.y,
      })),
  ]
  return scene.value.routes.flatMap(route => (
    route.segments.some(segment => {
      const endpoints = [segment.points[0], segment.points.at(-1)]
      return endpoints.some(point => point && contacts.some(contact => (
        Math.abs(point.x - contact.x) < 0.5 && Math.abs(point.y - contact.y) < 0.5
      )))
    }) ? [route.id] : []
  ))
})

function affectedMemberIds(memberIds: string[]): string[] {
  const ids = new Set(memberIds)
  const unitMemberIds = new Set(memberIds)
  for (const memberId of memberIds) {
    const member = props.data.members[memberId]
    if (!member) continue
    for (const parent of member.parents) ids.add(parent.id)
    for (const child of member.children) ids.add(child.id)
  }
  for (const member of Object.values(props.data.members)) {
    if (
      member.parents.some(parent => unitMemberIds.has(parent.id))
      || member.children.some(child => unitMemberIds.has(child.id))
    ) {
      ids.add(member.id)
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right))
}

onBeforeUnmount(() => {
  if (settleTimer !== null) clearTimeout(settleTimer)
})
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
            :faded-route-ids="fadedRouteIds"
          />

          <div
            v-if="draggedUnit"
            data-testid="family-unit-placeholder"
            class="pointer-events-none absolute left-0 top-0 rounded-2xl border"
            :style="{
              width: `${draggedUnit.rect.width}px`,
              height: `${draggedUnit.rect.height}px`,
              transform: `translate(${draggedUnit.rect.x}px, ${draggedUnit.rect.y}px)`,
              opacity: 0.35,
              backgroundColor: `color-mix(in srgb, ${draggedUnit.accent} 6%, transparent)`,
              borderColor: `color-mix(in srgb, ${draggedUnit.accent} 25%, transparent)`,
            }"
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
            :drag-offset="dragState?.unitId === unit.id ? { x: dragState.dx, y: dragState.dy } : undefined"
            :preview-offset="previewOffsetByUnitId[unit.id]"
            :is-dragging="dragState?.unitId === unit.id"
            :animate-position="animatePositions"
            :kinship-by-member-id="kinshipByMemberId"
            @unit-drag="onUnitDrag"
            @unit-drop="onUnitDrop"
            @unit-cancel="onUnitCancel"
            @select="emit('select', $event)"
            @open="emit('open', $event)"
          />
        </div>

        <div
          v-if="members.length === 0"
          class="absolute inset-0 flex items-center justify-center text-slate-400"
        >
          暂无成员 — 点击上方"添加成员"开始
        </div>
      </div>
    </PanZoomWrapper>
  </div>
</template>
