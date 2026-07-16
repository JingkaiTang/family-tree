import { watch, type WatchStopHandle } from 'vue'
import type { FamilyData } from '@/core/schema'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { saveProject } from './projectService'

const DEBOUNCE_MS = 800

type FamilyStore = ReturnType<typeof useFamilyStore>
type SaveProject = (path: string, family: FamilyData) => Promise<void>

export interface AutosaveController {
  start: () => void
  stop: () => void
  flushNow: () => Promise<void>
}

interface AutosaveOptions {
  debounceMs?: number
  save?: SaveProject
  onBackgroundError?: (error: unknown) => void
}

export function createAutosaveController(
  family: FamilyStore,
  options: AutosaveOptions = {},
): AutosaveController {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const save = options.save ?? saveProject
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopWatch: WatchStopHandle | null = null
  let requested = false
  let saveLoop: Promise<void> | null = null

  function clearTimer() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void enqueueSave().catch(error => options.onBackgroundError?.(error))
    }, debounceMs)
  }

  function snapshot() {
    if (!family.projectPath || !family.isDirty) return null
    return {
      path: family.projectPath,
      projectToken: family.projectToken,
      revision: family.revision,
      data: JSON.parse(JSON.stringify(family.data)) as FamilyData,
    }
  }

  async function runSaveLoop() {
    while (requested) {
      requested = false
      const current = snapshot()
      if (current === null) continue

      await save(current.path, current.data)
      family.markSaved(current.projectToken, current.revision)

      if (
        family.isDirty
        && family.projectToken === current.projectToken
        && family.revision !== current.revision
      ) requested = true
    }
  }

  function enqueueSave(): Promise<void> {
    requested = true
    if (saveLoop === null) {
      saveLoop = runSaveLoop().finally(() => {
        saveLoop = null
      })
    }
    return saveLoop
  }

  function start() {
    if (stopWatch !== null) return
    stopWatch = watch(
      () => family.revision,
      () => {
        if (family.projectPath && family.isDirty) schedule()
      },
      { flush: 'sync' },
    )
  }

  function stop() {
    clearTimer()
    stopWatch?.()
    stopWatch = null
  }

  async function flushNow() {
    clearTimer()
    if (saveLoop !== null && !family.isDirty) {
      await saveLoop
      return
    }
    if (!family.projectPath || !family.isDirty) return
    await enqueueSave()
  }

  return { start, stop, flushNow }
}

let controller: AutosaveController | null = null
let closeGuardStarted = false

/**
 * 启动自动保存：
 * - family store 每个 revision 变化都重新防抖 800ms
 * - 保存串行执行，只有精确 revision 成功落盘后才标记 clean
 * - 路由离开与 Tauri 关窗会等待队列；浏览器卸载时提示未保存状态
 */
export function startAutosave() {
  if (controller !== null) return

  const family = useFamilyStore()
  const ui = useUiStore()
  controller = createAutosaveController(family, {
    onBackgroundError: e => {
      const msg = e instanceof Error ? e.message : String(e)
      ui.showToast('error', '保存失败：' + msg)
      console.error('[autosave] save failed:', e)
    },
  })
  controller.start()

  if (typeof window !== 'undefined' && !closeGuardStarted) {
    closeGuardStarted = true
    window.addEventListener('beforeunload', event => {
      if (family.isDirty && family.projectPath) {
        void controller?.flushNow()
        event.preventDefault()
      }
    })

    if ('__TAURI_INTERNALS__' in window) {
      void installTauriCloseGuard(family, ui)
    }
  }
}

async function installTauriCloseGuard(
  family: FamilyStore,
  ui: ReturnType<typeof useUiStore>,
) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  await currentWindow.onCloseRequested(async event => {
    if (!family.isDirty || !family.projectPath) return
    event.preventDefault()
    try {
      await flushNow()
      await currentWindow.destroy()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      ui.showToast('error', '保存失败，窗口保持打开：' + msg)
    }
  })
}

/** 手动强制保存（返回 Promise） */
export async function flushNow(): Promise<void> {
  if (controller === null) startAutosave()
  await controller?.flushNow()
}
