<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_LAYOUT_METRICS, type LayoutScene, type Point } from '@/core/family-layout/types'
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
type LayoutPreferenceExpectation =
  | { kind: 'root-row' | 'bridge-row'; id: string; unitIds: string[]; columns?: Record<string, number> }
  | { kind: 'root-domain'; componentId: string; rootIds: string[] }
  | { kind: 'subtree'; batch: LayoutRowPreferenceBatch }

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
const diagnosticTitle = computed(() => (
  visibleDiagnostics.value.every(value => (
    value.code === 'UNROUTABLE_PRIMARY_EDGE'
    || value.code === 'CROSS_FAMILY_SEGMENT_OVERLAP'
    || value.code === 'NODE_OVERLAP'
  ))
    ? '连线路由已降级'
    : '家谱数据需要检查'
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

const unitById = computed(() => new Map(
  scene.value.units.map(unit => [unit.id, unit]),
))

const domainById = computed(() => new Map(
  [...scene.value.rootDomains, ...scene.value.bridgeDomains]
    .map(domain => [domain.id, domain]),
))

const unitIdByPersonId = computed(() => new Map(
  scene.value.cards.map(card => [card.id, card.unitId]),
))

const primaryChildUnitIdsBySourceId = computed(() => {
  const values = new Map<string, string[]>()
  for (const group of scene.value.primaryParentageGroups ?? []) {
    const childUnitIds = group.childPersonIds.flatMap(personId => {
      const childUnitId = unitIdByPersonId.value.get(personId)
      return childUnitId === undefined || childUnitId === group.sourceUnitId
        ? []
        : [childUnitId]
    })
    values.set(
      group.sourceUnitId,
      [...new Set(childUnitIds)].sort((left, right) => left.localeCompare(right)),
    )
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

const rootAccentById = computed(() => Object.fromEntries(
  scene.value.rootDomains.flatMap(domain => (
    domain.rootIds.map(rootId => [rootId, domain.accent])
  )),
))

const rootOrder = computed(() => [...scene.value.rootDomains]
  .sort((left, right) => left.rect.x - right.rect.x || left.id.localeCompare(right.id))
  .flatMap(domain => domain.rootIds))

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
    card.rect.x + card.rect.width / 2 + sceneOffset.value.x,
    card.rect.y + card.rect.height / 2 + sceneOffset.value.y,
  )
  return true
}

function focusSceneCenter() {
  if (!panzoomRef.value) return
  const bounds = scene.value.bounds
  if (scene.value.cards.length === 0) {
    panzoomRef.value.focusStagePoint(
      canvasSize.value.width / 2,
      canvasSize.value.height / 2,
    )
    return
  }
  panzoomRef.value.focusStagePoint(
    bounds.x + bounds.width / 2 + sceneOffset.value.x,
    bounds.y + bounds.height / 2 + sceneOffset.value.y,
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

interface RowDragState {
  mode: 'root-row' | 'bridge-row'
  unitId: string
  domainId: string
  rowId: string
  generation: number
  sourceIndex: number
  targetIndex: number
  sourceColumn: number
  targetColumn: number
  dx: number
  dy: number
}

interface RootDomainDragState {
  mode: 'root-domain'
  unitId: string
  domainId: string
  componentId: string
  sourceIndex: number
  targetIndex: number
  dx: number
  dy: number
}

interface SubtreeDragState {
  mode: 'subtree'
  unitId: string
  unitIds: string[]
  dx: number
  dy: number
}

type FamilyDragState = RowDragState | RootDomainDragState | SubtreeDragState

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
  const unit = unitById.value.get(payload.unitId)
  const domain = unit === undefined ? undefined : domainById.value.get(unit.domainId)
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
    const candidates = rootDomainsForComponent(domain.componentId)
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
      : primarySubtreeUnitIds(unit.id)
    const subtreeUnits = unitIds
      .map(unitId => unitById.value.get(unitId))
      .filter((value): value is LayoutScene['units'][number] => value !== undefined)
    const minimumDx = Math.max(...subtreeUnits.map(value => {
      const valueDomain = domainById.value.get(value.domainId)
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
      const valueDomain = domainById.value.get(value.domainId)
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
  const targetDomain = closestDomain(centerX)
  const targetRow = targetDomain === undefined
    ? undefined
    : closestRowInDomain(targetDomain.id, centerY)
  const validScope = targetDomain?.id === domain.id
    && targetRow?.generation === sourceRow.generation
  const targetIndex = validScope
    ? insertionIndex(sourceRow.unitIds, payload.unitId, centerX)
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
    changedIds = affectedMemberIds(domainMemberIds)
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
    changedIds = affectedMemberIds(subtreeMemberIds)
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
    const columns = columnsAfterDrop(state)
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
    changedIds = affectedMemberIds(payload.memberIds)
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

function hasExpectedLayoutPreference(
  data: FamilyData,
  expected: LayoutPreferenceExpectation,
): boolean {
  if (expected.kind === 'root-domain') {
    const rootOrder = data.layoutPreferences.rootOrders.find(value => (
      value.componentId === expected.componentId
    ))
    return equalOrder(rootOrder?.rootIds, expected.rootIds)
  }
  if (expected.kind === 'subtree') {
    return expected.batch.rowOrders.every(preference => (
      hasRowPreference(data.layoutPreferences.rowOrders, preference)
    )) && expected.batch.bridgeOrders.every(preference => (
      hasRowPreference(data.layoutPreferences.bridgeOrders, preference)
    ))
  }
  const rows = expected.kind === 'root-row'
    ? data.layoutPreferences.rowOrders
    : data.layoutPreferences.bridgeOrders
  const row = rows.find(value => value.id === expected.id)
  return equalOrder(row?.unitIds, expected.unitIds)
    && equalColumns(row?.columns, expected.columns)
}

function hasRowPreference(
  preferences: RowOrderPreference[],
  expected: RowOrderPreference,
): boolean {
  const current = preferences.find(value => value.id === expected.id)
  return equalOrder(current?.unitIds, expected.unitIds)
    && equalColumns(current?.columns, expected.columns)
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

function allDomains() {
  return [...scene.value.rootDomains, ...scene.value.bridgeDomains]
}

function primarySubtreeUnitIds(sourceUnitId: string): string[] {
  const visited = new Set<string>()
  const queue = [sourceUnitId]
  for (let index = 0; index < queue.length; index += 1) {
    const unitId = queue[index]
    if (visited.has(unitId)) continue
    visited.add(unitId)
    queue.push(...(primaryChildUnitIdsBySourceId.value.get(unitId) ?? []))
  }
  return scene.value.units
    .filter(unit => visited.has(unit.id))
    .map(unit => unit.id)
}

function closestDomain(centerX: number) {
  return allDomains()
    .map(domain => ({
      domain,
      distance: centerX < domain.rect.x
        ? domain.rect.x - centerX
        : centerX > domain.rect.x + domain.rect.width
          ? centerX - domain.rect.x - domain.rect.width
          : 0,
    }))
    .sort((left, right) => (
      left.distance - right.distance
      || Math.abs(
        left.domain.rect.x + left.domain.rect.width / 2 - centerX,
      ) - Math.abs(
        right.domain.rect.x + right.domain.rect.width / 2 - centerX,
      )
      || left.domain.id.localeCompare(right.domain.id)
    ))[0]?.domain
}

function closestRowInDomain(domainId: string, centerY: number) {
  return scene.value.rows
    .filter(row => row.unitIds.some(unitId => (
      scene.value.units.find(unit => unit.id === unitId)?.domainId === domainId
    )))
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

function rootDomainsForComponent(componentId: string) {
  return scene.value.rootDomains
    .filter(domain => domain.componentId === componentId)
    .sort((left, right) => left.rect.x - right.rect.x || left.id.localeCompare(right.id))
}

function rootInsertionIndex(
  domains: LayoutScene['rootDomains'],
  draggedDomainId: string,
  centerX: number,
): number {
  const remaining = domains.filter(domain => domain.id !== draggedDomainId)
  const index = remaining.findIndex(domain => (
    centerX <= domain.rect.x + domain.rect.width / 2
  ))
  return index < 0 ? remaining.length : index
}

function unitColumn(unitX: number, domainX: number): number {
  return Math.round(
    (unitX - domainX - DEFAULT_LAYOUT_METRICS.gridSize)
      / DEFAULT_LAYOUT_METRICS.gridSize,
  )
}

function columnsAfterDrop(state: RowDragState): Record<string, number> {
  const preferences = state.mode === 'root-row'
    ? props.data.layoutPreferences.rowOrders
    : props.data.layoutPreferences.bridgeOrders
  const current = preferences.find(value => value.id === state.rowId)
  const columns = { ...(current?.columns ?? {}) }
  if (state.targetIndex === state.sourceIndex) {
    columns[state.unitId] = state.targetColumn
  } else {
    delete columns[state.unitId]
  }
  return columns
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
  if (
    !state
    || state.mode === 'root-domain'
    || state.mode === 'subtree'
    || !dragCanDrop.value
  ) return null
  const row = scene.value.rows.find(value => value.id === state.rowId)
  if (!row) return null
  return arrayMove(row.unitIds, state.sourceIndex, state.targetIndex)
})

const previewRootIds = computed(() => {
  const state = dragState.value
  if (!state || state.mode !== 'root-domain' || !dragCanDrop.value) return null
  const domains = rootDomainsForComponent(state.componentId)
  const rootIds = domains.map(domain => domain.rootIds[0]).filter(Boolean)
  return arrayMove(rootIds, state.sourceIndex, state.targetIndex)
})

const previewSubtreeBatch = computed<LayoutRowPreferenceBatch | null>(() => {
  const state = dragState.value
  if (!state || state.mode !== 'subtree' || !dragCanDrop.value) return null
  const movedUnitIds = new Set(state.unitIds)
  const batch: LayoutRowPreferenceBatch = { rowOrders: [], bridgeOrders: [] }

  for (const row of scene.value.rows) {
    const movedRowUnitIds = row.unitIds.filter(unitId => movedUnitIds.has(unitId))
    if (movedRowUnitIds.length === 0) continue
    const rowUnits = row.unitIds
      .map(unitId => unitById.value.get(unitId))
      .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
    const domain = rowUnits[0] === undefined
      ? undefined
      : domainById.value.get(rowUnits[0].domainId)
    if (!domain) continue
    const preferences = domain.kind === 'root'
      ? props.data.layoutPreferences.rowOrders
      : props.data.layoutPreferences.bridgeOrders
    const current = preferences.find(value => value.id === row.id)
    const columns = { ...(current?.columns ?? {}) }
    for (const unitId of movedRowUnitIds) {
      const unit = unitById.value.get(unitId)
      if (unit === undefined) continue
      columns[unitId] = Math.max(
        0,
        unitColumn(unit.rect.x + state.dx, domain.rect.x),
      )
    }
    const originalIndex = new Map(row.unitIds.map((unitId, index) => [unitId, index]))
    const unitIds = [...row.unitIds].sort((leftId, rightId) => {
      const left = unitById.value.get(leftId)
      const right = unitById.value.get(rightId)
      const leftX = (left?.rect.x ?? 0) + (movedUnitIds.has(leftId) ? state.dx : 0)
      const rightX = (right?.rect.x ?? 0) + (movedUnitIds.has(rightId) ? state.dx : 0)
      return leftX - rightX
        || (originalIndex.get(leftId) ?? 0) - (originalIndex.get(rightId) ?? 0)
        || leftId.localeCompare(rightId)
    })
    const preference: RowOrderPreference = {
      id: row.id,
      domainId: domain.id,
      generation: row.generation,
      unitIds,
      columns,
    }
    if (domain.kind === 'root') batch.rowOrders.push(preference)
    else batch.bridgeOrders.push(preference)
  }

  batch.rowOrders.sort((left, right) => left.id.localeCompare(right.id))
  batch.bridgeOrders.sort((left, right) => left.id.localeCompare(right.id))
  return batch
})

const previewOffsetByUnitId = computed<Record<string, Point>>(() => {
  const state = dragState.value
  if (!state) return {}
  if (state.mode === 'root-domain') return rootDomainPreviewOffsets(state)
  if (state.mode === 'subtree') return {}
  const order = previewUnitIds.value
  if (!order) return {}
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

function rootDomainPreviewOffsets(state: RootDomainDragState): Record<string, Point> {
  const rootIds = previewRootIds.value
  if (rootIds === null) return {}
  const domains = rootDomainsForComponent(state.componentId)
  const domainByRootId = new Map(domains.flatMap(domain => (
    domain.rootIds[0] ? [[domain.rootIds[0], domain] as const] : []
  )))
  const slotXs = domains.map(domain => domain.rect.x)
  const targetXByRootId = new Map<string, number>()
  let nextX = slotXs[0] ?? 0
  rootIds.forEach((rootId, index) => {
    const domain = domainByRootId.get(rootId)
    if (domain === undefined) return
    const targetX = Math.max(slotXs[index] ?? nextX, nextX)
    targetXByRootId.set(rootId, targetX)
    nextX = targetX + domain.rect.width + DEFAULT_LAYOUT_METRICS.rootGap
  })
  const offsetByDomainId = new Map<string, number>()
  for (const [rootId, domain] of domainByRootId) {
    if (domain.id === state.domainId) continue
    const targetX = targetXByRootId.get(rootId)
    if (targetX !== undefined) offsetByDomainId.set(domain.id, targetX - domain.rect.x)
  }
  for (const bridge of scene.value.bridgeDomains.filter(value => (
    value.componentId === state.componentId
  ))) {
    const offsets = bridge.rootIds.flatMap(rootId => {
      const domain = domainByRootId.get(rootId)
      const targetX = targetXByRootId.get(rootId)
      return domain === undefined || targetX === undefined
        ? []
        : [targetX - domain.rect.x]
    })
    if (offsets.length > 0) {
      offsetByDomainId.set(
        bridge.id,
        offsets.reduce((sum, value) => sum + value, 0) / offsets.length,
      )
    }
  }
  return Object.fromEntries(scene.value.units.flatMap(unit => {
    const offset = offsetByDomainId.get(unit.domainId)
    return offset === undefined ? [] : [[unit.id, { x: offset, y: 0 }]]
  }))
}

function dragOffsetForUnit(unit: LayoutScene['units'][number]): Point | undefined {
  const state = dragState.value
  if (state === null) return undefined
  if (state.mode === 'root-domain') {
    return unit.domainId === state.domainId
      ? { x: state.dx, y: Math.max(-24, Math.min(24, state.dy)) }
      : undefined
  }
  if (state.mode === 'subtree') {
    return state.unitIds.includes(unit.id)
      ? { x: state.dx, y: Math.max(-24, Math.min(24, state.dy)) }
      : undefined
  }
  return state.unitId === unit.id ? { x: state.dx, y: state.dy } : undefined
}

function isUnitDragging(unit: LayoutScene['units'][number]): boolean {
  const state = dragState.value
  return state?.mode === 'root-domain'
    ? unit.domainId === state.domainId
    : state?.mode === 'subtree'
      ? state.unitIds.includes(unit.id)
    : state?.unitId === unit.id
}

function equalOrder(left: string[] | undefined, right: string[]): boolean {
  return left?.length === right.length
    && left.every((value, index) => value === right[index])
}

function equalColumns(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([unitId, column], index) => (
      unitId === rightEntries[index]?.[0] && column === rightEntries[index]?.[1]
    ))
}

const draggedUnit = computed(() => {
  const unitId = dragState.value?.unitId
  return unitId ? scene.value.units.find(unit => unit.id === unitId) : undefined
})

const fadedRouteIds = computed(() => {
  const state = dragState.value
  if (!state) return []
  const unitIds = new Set(
    state.mode === 'root-domain'
      ? scene.value.units.filter(unit => unit.domainId === state.domainId).map(unit => unit.id)
      : state.mode === 'subtree'
        ? state.unitIds
        : [state.unitId],
  )
  const contacts = [
    ...scene.value.hubs
      .filter(hub => unitIds.has(hub.unitId))
      .map(hub => hub.point),
    ...scene.value.cards
      .filter(card => unitIds.has(card.unitId))
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
            :cards="cardsByUnitId.get(unit.id) ?? []"
            :members="members"
            :hubs="hubsByUnitId.get(unit.id) ?? []"
            :selected-id="selectedId"
            :viewpoint-id="viewpointId"
            :drag-offset="dragOffsetForUnit(unit)"
            :preview-offset="previewOffsetByUnitId[unit.id]"
            :is-dragging="isUnitDragging(unit)"
            :animate-position="animatePositions"
            :kinship-by-member-id="kinshipByMemberId"
            :root-accent-by-id="rootAccentById"
            :root-order="rootOrder"
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

    <div
      v-if="visibleDiagnostics.length > 0"
      data-testid="layout-diagnostics"
      class="absolute left-1/2 top-3 z-50 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-lg backdrop-blur"
      role="status"
    >
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-semibold">{{ diagnosticTitle }}</div>
          <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li v-for="diagnostic in visibleDiagnostics" :key="`${diagnostic.code}:${diagnostic.ids.join(',')}`">
              {{ diagnostic.message }}
            </li>
          </ul>
        </div>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs hover:bg-amber-100"
          aria-label="关闭布局诊断"
          @click="dismissDiagnostics"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>
