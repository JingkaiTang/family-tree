<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { pickDirectory } from '@/services/tauriApi'
import { createProject, openProject } from '@/services/projectService'
import { startAutosave } from '@/services/autosave'
import { getLastProjectPath, setLastProjectPath } from '@/services/prefs'

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()

const busy = ref(false)
const error = ref<string | null>(null)
/** 启动时是否正在自动尝试恢复上次项目（让 UI 显示 loading 而不是闪一下按钮） */
const autoRestoring = ref(false)
const lastPath = ref<string | null>(null)

async function tryOpen(dir: string, silent = false): Promise<boolean> {
  try {
    busy.value = true
    const result = await openProject(dir)
    family.setProject(result.path, result.meta, result.family)
    startAutosave()
    if (!silent) ui.showToast('success', `已打开家族：${result.meta.name}`)
    router.push('/tree')
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (silent) {
      // 自动恢复失败：清掉无效记录，不打扰用户
      setLastProjectPath(null)
      lastPath.value = null
      console.warn('[Welcome] auto-restore failed:', msg)
    } else {
      error.value = msg
    }
    return false
  } finally {
    busy.value = false
  }
}

async function onCreate() {
  error.value = null
  const dir = await pickDirectory('选择一个文件夹作为家族项目根目录')
  if (!dir) return
  const name = dir.split('/').filter(Boolean).pop() ?? '未命名家族'
  try {
    busy.value = true
    const result = await createProject(dir, name)
    family.setProject(result.path, result.meta, result.family)
    startAutosave()
    ui.showToast('success', `已新建家族：${name}`)
    router.push('/tree')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onOpen() {
  error.value = null
  const dir = await pickDirectory('选择要打开的家族项目文件夹')
  if (!dir) return
  await tryOpen(dir)
}

async function onOpenLast() {
  if (!lastPath.value) return
  await tryOpen(lastPath.value)
}

function onForgetLast() {
  setLastProjectPath(null)
  lastPath.value = null
}

onMounted(async () => {
  const stored = getLastProjectPath()
  lastPath.value = stored
  if (!stored) return
  // 启动自动恢复。失败时静默清掉记录，落回欢迎页
  autoRestoring.value = true
  try {
    await tryOpen(stored, true)
  } finally {
    autoRestoring.value = false
  }
})

function lastName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-6 p-8">
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight">家族树</h1>
      <p class="mt-3 text-slate-500">记录家族成员、关系与故事</p>
    </div>

    <p v-if="autoRestoring" class="text-sm text-slate-400">正在恢复上次打开的家族…</p>

    <div v-else class="flex flex-col items-center gap-4">
      <div class="flex gap-4">
        <button
          class="rounded-lg bg-slate-900 px-6 py-3 text-white shadow hover:bg-slate-700 disabled:opacity-50"
          :disabled="busy"
          @click="onCreate"
        >
          新建家族
        </button>
        <button
          class="rounded-lg border border-slate-300 bg-white px-6 py-3 text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-50"
          :disabled="busy"
          @click="onOpen"
        >
          打开已有家族
        </button>
      </div>

      <!-- 最近打开：点击快速恢复；X 清除记录 -->
      <div
        v-if="lastPath"
        class="mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm"
      >
        <span class="text-xs text-slate-400">最近：</span>
        <button
          class="hover:text-emerald-700 hover:underline disabled:opacity-50"
          :disabled="busy"
          :title="lastPath"
          @click="onOpenLast"
        >
          {{ lastName(lastPath) }}
        </button>
        <button
          class="text-xs text-slate-400 hover:text-rose-500"
          title="清除记录"
          @click="onForgetLast"
        >
          ✕
        </button>
      </div>
    </div>

    <p v-if="busy && !autoRestoring" class="text-sm text-slate-400">处理中…</p>
    <p
      v-if="error"
      class="max-w-md rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
    >
      {{ error }}
    </p>

    <p class="text-xs text-slate-400">
      数据以普通文件夹形式保存在你选择的位置，可直接复制/备份。
    </p>
  </div>
</template>
