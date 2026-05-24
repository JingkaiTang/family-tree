import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * UI store：不写入 JSON 的临时 UI 状态。
 */
export const useUiStore = defineStore('ui', () => {
  const viewpointId = ref<string | null>(null) // 当前以谁为视角查看称呼
  const selectedId = ref<string | null>(null)
  const centerLayoutId = ref<string | null>(null) // 当前以谁为中心布局
  const searchQuery = ref('')
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
  function setCenterLayout(id: string | null) {
    centerLayoutId.value = id
  }
  function setSearch(q: string) {
    searchQuery.value = q
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
    centerLayoutId,
    searchQuery,
    toast,
    canvasView,
    setViewpoint,
    setSelected,
    setCenterLayout,
    setSearch,
    setCanvasView,
    showToast,
    clearToast,
  }
})
