import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  detectDefaultLayoutMode,
  resolveLayoutMode,
  type LayoutMode,
  type LayoutModePreference,
} from '@/core/layoutMode'
import {
  getLayoutModePreference,
  setLayoutModePreference as persistLayoutModePreference,
} from '@/services/prefs'

/**
 * UI store：不写入 JSON 的临时 UI 状态。
 */
export const useUiStore = defineStore('ui', () => {
  const viewpointId = ref<string | null>(null) // 当前以谁为视角查看称呼
  const selectedId = ref<string | null>(null)
  const searchQuery = ref('')
  const showAuxiliaryRelations = ref(false)
  const defaultLayoutMode = ref(detectDefaultLayoutMode())
  const layoutModePreference = ref<LayoutModePreference>(getLayoutModePreference())
  const resolvedLayoutMode = computed(() => resolveLayoutMode(
    layoutModePreference.value,
    defaultLayoutMode.value,
  ))
  /** 聚焦纵流的锚点，独立于选中成员和称呼视角。 */
  const layoutFocusId = ref<string | null>(null)
  const focusFlowExpandedBranchIds = ref<string[]>([])
  const focusFlowScrollTop = ref(0)
  /** 错误/成功 toast */
  const toast = ref<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  /**
   * 画布的 pan/zoom 状态。组件级而非项目级：路由离开 /tree 再回来时恢复，
   * 但不持久化到 family.json（不同机器/不同会话各自独立）。
   */
  const canvasView = ref<{ x: number; y: number; scale: number } | null>(null)

  function setViewpoint(id: string | null) {
    viewpointId.value = id
  }
  function setSelected(id: string | null) {
    selectedId.value = id
  }
  function setSearch(q: string) {
    searchQuery.value = q
  }
  function setShowAuxiliaryRelations(value: boolean) {
    showAuxiliaryRelations.value = value
  }
  function setLayoutModePreference(preference: LayoutModePreference) {
    layoutModePreference.value = preference
    persistLayoutModePreference(preference)
  }
  function setDefaultLayoutMode(mode: LayoutMode) {
    defaultLayoutMode.value = mode
  }
  function setLayoutFocus(id: string | null) {
    layoutFocusId.value = id
  }
  function toggleFocusFlowBranch(id: string) {
    focusFlowExpandedBranchIds.value = focusFlowExpandedBranchIds.value.includes(id)
      ? focusFlowExpandedBranchIds.value.filter(value => value !== id)
      : [...focusFlowExpandedBranchIds.value, id]
  }
  function setFocusFlowScrollTop(value: number) {
    focusFlowScrollTop.value = Number.isFinite(value) ? Math.max(0, value) : 0
  }
  function resetFocusFlowState() {
    layoutFocusId.value = null
    focusFlowExpandedBranchIds.value = []
    focusFlowScrollTop.value = 0
  }
  function setCanvasView(v: { x: number; y: number; scale: number } | null) {
    canvasView.value = v
  }
  function showToast(type: 'info' | 'error' | 'success', text: string) {
    toast.value = { type, text }
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        if (toast.value?.text === text) toast.value = null
      }, 3500)
    }
  }
  function clearToast() {
    toast.value = null
  }

  return {
    viewpointId,
    selectedId,
    searchQuery,
    showAuxiliaryRelations,
    defaultLayoutMode,
    layoutModePreference,
    resolvedLayoutMode,
    layoutFocusId,
    focusFlowExpandedBranchIds,
    focusFlowScrollTop,
    toast,
    canvasView,
    setViewpoint,
    setSelected,
    setSearch,
    setShowAuxiliaryRelations,
    setLayoutModePreference,
    setDefaultLayoutMode,
    setLayoutFocus,
    toggleFocusFlowBranch,
    setFocusFlowScrollTop,
    resetFocusFlowState,
    setCanvasView,
    showToast,
    clearToast,
  }
})
