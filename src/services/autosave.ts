import { watch } from 'vue'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { saveProject } from './projectService'

const DEBOUNCE_MS = 800

let timer: ReturnType<typeof setTimeout> | null = null
let started = false

/**
 * 启动自动保存：
 * - family store 的 isDirty 变成 true 时，防抖 800ms 写盘
 * - 写盘成功后 markClean
 * - beforeunload 强制 flush（用户关窗时不丢数据）
 */
export function startAutosave() {
  if (started) return
  started = true

  const family = useFamilyStore()
  const ui = useUiStore()

  watch(
    () => family.isDirty,
    (dirty) => {
      if (!dirty) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void flush()
      }, DEBOUNCE_MS)
    },
  )

  async function flush() {
    if (!family.projectPath || !family.isDirty) return
    try {
      await saveProject(family.projectPath, family.data)
      family.markClean()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      ui.showToast('error', '保存失败：' + msg)
      console.error('[autosave] save failed:', e)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      if (family.isDirty && family.projectPath) {
        // 同步触发（不等待），保持尽可能多的数据落盘
        void flush()
      }
    })
  }
}

/** 手动强制保存（返回 Promise） */
export async function flushNow(): Promise<void> {
  const family = useFamilyStore()
  if (!family.projectPath || !family.isDirty) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await saveProject(family.projectPath, family.data)
  family.markClean()
}
