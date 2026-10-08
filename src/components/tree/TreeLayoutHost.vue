<script setup lang="ts">
import type { LayoutMode } from '@/core/layoutMode'
import type {
  BridgeOrderPreference,
  FamilyData,
  LayoutRowPreferenceBatch,
  RowOrderPreference,
} from '@/core/schema'
import type { PanzoomView } from './PanZoomWrapper.vue'
import FamilyCanvas from './FamilyCanvas.vue'
import FocusFlowView from './focus-flow/FocusFlowView.vue'

defineProps<{
  mode: LayoutMode
  data: FamilyData
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  readOnly?: boolean
  layoutFocusId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  initialGridView?: PanzoomView | null
  initialFocusScrollTop?: number
  expandedBranchIds?: string[]
  layoutResetVersion?: number
  showAuxiliaryRelations?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'clear-selection'): void
  (event: 'open', id: string): void
  (event: 'grid-view-change', value: PanzoomView): void
  (event: 'focus-scroll-change', value: number): void
  (event: 'layout-focus-change', id: string): void
  (event: 'focus-branch-toggle', id: string): void
  (event: 'domain-row-order-change', preference: RowOrderPreference): void
  (event: 'bridge-order-change', preference: BridgeOrderPreference): void
  (event: 'root-order-change', componentId: string, rootIds: string[]): void
  (event: 'subtree-order-change', batch: LayoutRowPreferenceBatch): void
}>()
</script>

<template>
  <FamilyCanvas
    v-if="mode === 'family-grid'"
    :data="data"
    :root-id="rootId"
    :selected-id="selectedId"
    :viewpoint-id="viewpointId"
    :read-only="readOnly"
    :get-kinship="getKinship"
    :initial-view="initialGridView"
    :layout-reset-version="layoutResetVersion"
    :show-auxiliary-relations="showAuxiliaryRelations"
    @select="emit('select', $event)"
    @clear-selection="emit('clear-selection')"
    @open="emit('open', $event)"
    @view-change="emit('grid-view-change', $event)"
    @domain-row-order-change="emit('domain-row-order-change', $event)"
    @bridge-order-change="emit('bridge-order-change', $event)"
    @root-order-change="(componentId, rootIds) => emit('root-order-change', componentId, rootIds)"
    @subtree-order-change="emit('subtree-order-change', $event)"
  />
  <FocusFlowView
    v-else
    :data="data"
    :focus-id="layoutFocusId"
    :selected-id="selectedId"
    :viewpoint-id="viewpointId"
    :get-kinship="getKinship"
    :expanded-branch-ids="expandedBranchIds"
    :initial-scroll-top="initialFocusScrollTop"
    :show-auxiliary-relations="showAuxiliaryRelations"
    @select="emit('select', $event)"
    @open="emit('open', $event)"
    @focus-change="emit('layout-focus-change', $event)"
    @branch-toggle="emit('focus-branch-toggle', $event)"
    @scroll-change="emit('focus-scroll-change', $event)"
  />
</template>
