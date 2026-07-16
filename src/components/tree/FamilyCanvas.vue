<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_LAYOUT_METRICS, type LayoutScene } from '@/core/family-layout/types'
import type {
  BridgeOrderPreference,
  FamilyData,
  LayoutRowPreferenceBatch,
  RowOrderPreference,
} from '@/core/schema'
import {
  withBridgeOrderPreference,
  withDomainRowOrderPreference,
  withLayoutRowPreferenceBatch,
  withRootOrderPreference,
} from '@/core/family-layout/reconcilePreferences'
import { layoutFamilyTree } from '@/core/treeLayout'
import {
  affectedMemberIds,
  buildFamilyCanvasSceneModel,
  closestDomain,
  closestRowInDomain,
  columnsAfterDrop,
  dragOffsetForUnit as resolveDragOffsetForUnit,
  fadedRouteIds as resolveFadedRouteIds,
  hasExpectedLayoutPreference,
  insertionIndex,
  isUnitDragging as resolveIsUnitDragging,
  previewOffsetByUnitId as resolvePreviewOffsetByUnitId,
  previewRootIds as resolvePreviewRootIds,
  previewSubtreeBatch as resolvePreviewSubtreeBatch,
  previewUnitIds as resolvePreviewUnitIds,
  primarySubtreeUnitIds,
  rootDomainsForComponent,
  rootInsertionIndex,
  unitColumn,
  type FamilyDragState,
  type LayoutPreferenceExpectation,
} from './familyCanvasModel'
import PanZoomWrapper, { type PanzoomView } from './PanZoomWrapper.vue'
import FamilyUnit, { type FamilyUnitDragPayload } from './FamilyUnit.vue'
import GridBackground from './GridBackground.vue'
import LayoutDiagnostics from './LayoutDiagnostics.vue'
import RelationLayer from './RelationLayer.vue'

const props = defineProps<{
  data: FamilyData
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  initialView?: PanzoomView | null
  layoutResetVersion?: number
  showAuxiliaryRelations?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'open', id: string): void
  (event: 'view-change', value: PanzoomView): void
  (event: 'domain-row-order-change', preference: RowOrderPreference): void
  (event: 'bridge-order-change', preference: BridgeOrderPreference): void
  (event: 'root-order-change', componentId: string, rootIds: string[]): void
  (event: 'subtree-order-change', batch: LayoutRowPreferenceBatch): void
}>()

const PADDING = 40
const EMPTY_SCENE: LayoutScene = {
  units: [],
  cards: [],
  hubs: [],
  rows: [],
  rootDomains: [],
  bridgeDomains: [],
  gateways: [],
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
let expectedPreferenceUpdate: LayoutPreferenceExpectation | null = null
let pendingDropToken: number | null = null
let pendingSceneRecovery: { data: FamilyData; changedIds: string[] } | null = null
const dragState = ref<FamilyDragState | null>(null)
const dragCanDrop = ref(false)
const dragInvalid = ref(false)
let dragToken = 0
let auxiliaryRefreshQueued = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
let observedLayoutResetVersion = props.layoutResetVersion ?? 0
const animatePositions = ref(false)
const dismissedDiagnosticKey = ref<string | null>(null)

const diagnosticKey = computed(() => scene.value.diagnostics
  .map(value => `${value.code}:${value.ids.join(',')}:${value.message}`)
  .join('|'))
const visibleDiagnostics = computed(() => (
  diagnosticKey.value !== '' && diagnosticKey.value !== dismissedDiagnosticKey.value
    ? scene.value.diagnostics
    : []
))
async function updateLayout(options: {
  data?: FamilyData
  previousScene?: LayoutScene
  changedIds?: string[]
  preserveViewport?: boolean
  resetViewport?: boolean
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
  if (options.resetViewport) {
    panzoomRef.value?.resetToDefaultView()
    if (
      nextScene.cards.length > 0
      && (!viewpointId || !focusMember(viewpointId))
    ) {
      focusSceneCenter()
    }
  } else if (
    viewpointId
    && !shouldSuppressFocus
    && !shouldSettleDrag
    && !options.preserveViewport
  ) {
    focusMember(viewpointId)
  }
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
  void updateLayout({ preserveViewport: true })
}

function flushQueuedAuxiliaryRefresh(previousScene: LayoutScene) {
  if (
    !auxiliaryRefreshQueued
    || dragState.value !== null
    || pendingDropToken !== null
    || pendingSceneRecovery !== null
  ) return
  auxiliaryRefreshQueued = false
  void updateLayout({ previousScene, changedIds: [], preserveViewport: true })
}

watch(
  [() => props.data, () => props.layoutResetVersion ?? 0],
  ([, resetVersion]) => {
    if (resetVersion !== observedLayoutResetVersion) {
      observedLayoutResetVersion = resetVersion
      cancelPendingLayoutInteraction()
      void updateLayout({ resetViewport: true })
      return
    }
    if (
      expectedPreferenceUpdate
      && hasExpectedLayoutPreference(props.data, expectedPreferenceUpdate)
    ) {
      expectedPreferenceUpdate = null
      return
    }
    expectedPreferenceUpdate = null
    cancelActiveDragPreview()
    void updateLayout()
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.showAuxiliaryRelations, props.selectedId] as const,
  requestAuxiliaryRefresh,
)

const sceneModel = computed(() => buildFamilyCanvasSceneModel(scene.value, PADDING))

const kinshipByMemberId = computed<Record<string, string>>(() => {
  const viewpointId = props.viewpointId
  const resolveKinship = props.getKinship
  if (!viewpointId || !resolveKinship) return {}
  return Object.fromEntries(members.value.flatMap(member => {
    const kinship = resolveKinship(viewpointId, member.id)
    return kinship ? [[member.id, kinship]] : []
  }))
})

function focusMember(id: string): boolean {
  const card = scene.value.cards.find(value => value.id === id)
  if (!card || !panzoomRef.value) return false
  panzoomRef.value.focusStagePoint(
    card.rect.x + card.rect.width / 2 + sceneModel.value.sceneOffset.x,
    card.rect.y + card.rect.height / 2 + sceneModel.value.sceneOffset.y,
  )
  return true
}

function focusSceneCenter() {
  if (!panzoomRef.value) return
  const bounds = scene.value.bounds
  if (scene.value.cards.length === 0) {
    panzoomRef.value.focusStagePoint(
      sceneModel.value.canvasSize.width / 2,
      sceneModel.value.canvasSize.height / 2,
    )
    return
  }
  panzoomRef.value.focusStagePoint(
    bounds.x + bounds.width / 2 + sceneModel.value.sceneOffset.x,
    bounds.y + bounds.height / 2 + sceneModel.value.sceneOffset.y,
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

function cancelPendingLayoutInteraction() {
  layoutRequestId += 1
  dragToken += 1
  dragState.value = null
  dragCanDrop.value = false
  dragInvalid.value = false
  expectedPreferenceUpdate = null
  pendingDropToken = null
  pendingSceneRecovery = null
  auxiliaryRefreshQueued = false
  animatePositions.value = false
  if (settleTimer !== null) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
}

function cancelActiveDragPreview() {
  if (dragState.value === null || pendingDropToken !== null) return
  dragToken += 1
  dragState.value = null
  dragCanDrop.value = false
  dragInvalid.value = false
}

function screenToStageScale(): number {
  return panzoomRef.value?.getScale() ?? 1
}

function onUnitDrag(payload: FamilyUnitDragPayload) {
  const scale = screenToStageScale()
  const unit = sceneModel.value.unitById.get(payload.unitId)
  const domain = unit === undefined ? undefined : sceneModel.value.domainById.get(unit.domainId)
  const sourceRow = scene.value.rows.find(row => row.unitIds.includes(payload.unitId))
  if (!unit || !domain || !sourceRow) return
  const dx = payload.dx / scale
  const dy = payload.dy / scale

  if (
    !dragState.value
    || dragState.value.unitId !== payload.unitId
    || pendingDropToken !== null
  ) {
    layoutRequestId += 1
    dragToken += 1
    pendingDropToken = null
  }

  if (payload.groupDrag && unit.isRootFamily && domain.kind === 'root') {
    const candidates = rootDomainsForComponent(scene.value, domain.componentId)
    const sourceIndex = candidates.findIndex(value => value.id === domain.id)
    const targetIndex = rootInsertionIndex(
      candidates,
      domain.id,
      unit.rect.x + unit.rect.width / 2 + dx,
    )
    dragState.value = {
      mode: 'root-domain',
      unitId: unit.id,
      domainId: domain.id,
      componentId: domain.componentId,
      sourceIndex,
      targetIndex,
      dx,
      dy,
    }
    dragInvalid.value = false
    dragCanDrop.value = sourceIndex >= 0 && targetIndex !== sourceIndex
    return
  }

  if (payload.groupDrag) {
    const unitIds = dragState.value?.mode === 'subtree'
      && dragState.value.unitId === unit.id
      ? dragState.value.unitIds
      : primarySubtreeUnitIds(scene.value, sceneModel.value, unit.id)
    const subtreeUnits = unitIds
      .map(unitId => sceneModel.value.unitById.get(unitId))
      .filter((value): value is LayoutScene['units'][number] => value !== undefined)
    const minimumDx = Math.max(...subtreeUnits.map(value => {
      const valueDomain = sceneModel.value.domainById.get(value.domainId)
      return valueDomain === undefined
        ? Number.NEGATIVE_INFINITY
        : valueDomain.rect.x + DEFAULT_LAYOUT_METRICS.gridSize - value.rect.x
    }))
    const effectiveDx = Math.max(dx, minimumDx)
    dragState.value = {
      mode: 'subtree',
      unitId: unit.id,
      unitIds,
      dx: effectiveDx,
      dy,
    }
    dragInvalid.value = false
    dragCanDrop.value = subtreeUnits.some(value => {
      const valueDomain = sceneModel.value.domainById.get(value.domainId)
      return valueDomain !== undefined
        && unitColumn(value.rect.x + effectiveDx, valueDomain.rect.x)
          !== unitColumn(value.rect.x, valueDomain.rect.x)
    })
    return
  }

  const sourceIndex = sourceRow.unitIds.indexOf(payload.unitId)
  const centerX = unit.rect.x + unit.rect.width / 2 + dx
  const centerY = unit.rect.y + unit.rect.height / 2 + dy
  const sourceColumn = unitColumn(unit.rect.x, domain.rect.x)
  const targetColumn = Math.max(
    0,
    unitColumn(unit.rect.x + dx, domain.rect.x),
  )
  const targetDomain = closestDomain(scene.value, centerX)
  const targetRow = targetDomain === undefined
    ? undefined
    : closestRowInDomain(scene.value, targetDomain.id, centerY)
  const validScope = targetDomain?.id === domain.id
    && targetRow?.generation === sourceRow.generation
  const targetIndex = validScope
    ? insertionIndex(scene.value, sourceRow.unitIds, payload.unitId, centerX)
    : sourceIndex
  dragState.value = {
    mode: domain.kind === 'root' ? 'root-row' : 'bridge-row',
    unitId: unit.id,
    domainId: domain.id,
    rowId: sourceRow.id,
    generation: sourceRow.generation,
    sourceIndex,
    targetIndex,
    sourceColumn,
    targetColumn,
    dx,
    dy,
  }
  dragInvalid.value = !validScope
  dragCanDrop.value = validScope && (
    targetIndex !== sourceIndex || targetColumn !== sourceColumn
  )
}

async function onUnitDrop(payload: FamilyUnitDragPayload) {
  onUnitDrag(payload)
  const state = dragState.value
  if (!state || state.unitId !== payload.unitId || !dragCanDrop.value) {
    clearDrag(payload.unitId)
    return
  }
  const previousScene = scene.value
  let nextData: FamilyData
  let changedIds: string[]
  let expectation: LayoutPreferenceExpectation
  if (state.mode === 'root-domain') {
    const rootIds = previewRootIds.value
    if (rootIds === null) {
      clearDrag(payload.unitId)
      return
    }
    nextData = withRootOrderPreference(props.data, state.componentId, rootIds)
    const domainMemberIds = scene.value.units
      .filter(unit => unit.domainId === state.domainId)
      .flatMap(unit => unit.memberIds)
    changedIds = affectedMemberIds(props.data, domainMemberIds)
    expectation = {
      kind: 'root-domain',
      componentId: state.componentId,
      rootIds: [...rootIds],
    }
    emit('root-order-change', state.componentId, [...rootIds])
  } else if (state.mode === 'subtree') {
    const batch = previewSubtreeBatch.value
    if (batch === null) {
      clearDrag(payload.unitId)
      return
    }
    nextData = withLayoutRowPreferenceBatch(props.data, batch)
    const subtreeMemberIds = scene.value.units
      .filter(unit => state.unitIds.includes(unit.id))
      .flatMap(unit => unit.memberIds)
    changedIds = affectedMemberIds(props.data, subtreeMemberIds)
    expectation = {
      kind: 'subtree',
      batch: structuredClone(batch),
    }
    emit('subtree-order-change', structuredClone(batch))
  } else {
    const rowOrder = previewUnitIds.value
    if (rowOrder === null) {
      clearDrag(payload.unitId)
      return
    }
    const columns = columnsAfterDrop(props.data, state)
    const preference: RowOrderPreference = {
      id: state.rowId,
      domainId: state.domainId,
      generation: state.generation,
      unitIds: [...rowOrder],
      ...(Object.keys(columns).length > 0 ? { columns } : {}),
    }
    if (state.mode === 'root-row') {
      nextData = withDomainRowOrderPreference(props.data, preference)
      emit('domain-row-order-change', preference)
    } else {
      nextData = withBridgeOrderPreference(props.data, preference)
      emit('bridge-order-change', preference)
    }
    changedIds = affectedMemberIds(props.data, payload.memberIds)
    expectation = {
      kind: state.mode,
      id: state.rowId,
      unitIds: [...rowOrder],
      ...(preference.columns ? { columns: { ...preference.columns } } : {}),
    }
  }
  pendingSceneRecovery = { data: nextData, changedIds }
  pendingDropToken = dragToken
  expectedPreferenceUpdate = expectation
  void nextTick(() => {
    if (expectedPreferenceUpdate === expectation) expectedPreferenceUpdate = null
  })
  await updateLayout({
    data: nextData,
    previousScene,
    changedIds,
    preserveViewport: true,
  })
}

function onUnitCancel(payload: FamilyUnitDragPayload) {
  clearDrag(payload.unitId)
}

function clearDrag(unitId: string) {
  if (dragState.value?.unitId !== unitId) return
  dragState.value = null
  dragCanDrop.value = false
  dragInvalid.value = false
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
    preserveViewport: true,
  })
}

const previewUnitIds = computed(() => (
  resolvePreviewUnitIds(scene.value, dragState.value, dragCanDrop.value)
))

const previewRootIds = computed(() => (
  resolvePreviewRootIds(scene.value, dragState.value, dragCanDrop.value)
))

const previewSubtreeBatch = computed(() => resolvePreviewSubtreeBatch(
  scene.value,
  props.data,
  sceneModel.value,
  dragState.value,
  dragCanDrop.value,
))

const previewOffsetByUnitId = computed(() => resolvePreviewOffsetByUnitId(
  scene.value,
  dragState.value,
  previewUnitIds.value,
  previewRootIds.value,
))

function dragOffsetForUnit(unit: LayoutScene['units'][number]) {
  return resolveDragOffsetForUnit(dragState.value, unit)
}

function isUnitDragging(unit: LayoutScene['units'][number]): boolean {
  return resolveIsUnitDragging(dragState.value, unit)
}

const draggedUnit = computed(() => {
  const unitId = dragState.value?.unitId
  return unitId ? scene.value.units.find(unit => unit.id === unitId) : undefined
})

const fadedRouteIds = computed(() => resolveFadedRouteIds(scene.value, dragState.value))

onBeforeUnmount(() => {
  if (settleTimer !== null) clearTimeout(settleTimer)
  window.removeEventListener('blur', cancelActiveDragPreview)
})

onMounted(() => window.addEventListener('blur', cancelActiveDragPreview))

function dismissDiagnostics() {
  dismissedDiagnosticKey.value = diagnosticKey.value
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
          width: `${sceneModel.canvasSize.width}px`,
          height: `${sceneModel.canvasSize.height}px`,
        }"
      >
        <GridBackground />

        <div
          class="absolute left-0 top-0"
          :style="{
            transform: `translate(${sceneModel.sceneOffset.x}px, ${sceneModel.sceneOffset.y}px)`,
            transformOrigin: '0 0',
          }"
        >
          <RelationLayer
            :routes="scene.routes"
            :width="sceneModel.canvasSize.width"
            :height="sceneModel.canvasSize.height"
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

          <div
            v-if="dragInvalid && draggedUnit"
            data-testid="invalid-domain-drop"
            class="pointer-events-none absolute z-50 rounded-md bg-rose-600 px-2 py-1 text-xs text-white shadow"
            :style="{
              transform: `translate(${draggedUnit.rect.x + (dragState?.dx ?? 0)}px, ${Math.max(0, draggedUnit.rect.y + (dragState?.dy ?? 0) - 34)}px)`,
            }"
          >
            只能在同一布局域和同一代内移动
          </div>

          <FamilyUnit
            v-for="unit in scene.units"
            :key="unit.id"
            :unit="unit"
            :cards="sceneModel.cardsByUnitId.get(unit.id) ?? []"
            :members="members"
            :hubs="sceneModel.hubsByUnitId.get(unit.id) ?? []"
            :selected-id="selectedId"
            :viewpoint-id="viewpointId"
            :drag-offset="dragOffsetForUnit(unit)"
            :preview-offset="previewOffsetByUnitId[unit.id]"
            :is-dragging="isUnitDragging(unit)"
            :animate-position="animatePositions"
            :kinship-by-member-id="kinshipByMemberId"
            :root-accent-by-id="sceneModel.rootAccentById"
            :root-order="sceneModel.rootOrder"
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

    <LayoutDiagnostics
      v-if="visibleDiagnostics.length > 0"
      :diagnostics="visibleDiagnostics"
      @dismiss="dismissDiagnostics"
    />
  </div>
</template>
