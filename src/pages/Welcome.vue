<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import {
  authorizeProject,
  getDirectoryStorageAvailability,
  hasProvider,
  pickProject,
  type ProjectRef,
} from '@/services/storage'
import { createProject, openProject } from '@/services/projectService'
import { startAutosave } from '@/services/autosave'
import { getLastProjectRef, setLastProjectRef } from '@/services/prefs'
import { importProjectBundle } from '@/services/projectTransfer'

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()

const busy = ref(false)
const error = ref<string | null>(null)
const bundleFileInput = ref<HTMLInputElement | null>(null)
const pendingBundleFile = ref<File | null>(null)
/** 启动时是否正在自动尝试恢复上次项目（让 UI 显示 loading 而不是闪一下按钮） */
const autoRestoring = ref(false)
const lastProject = ref<ProjectRef | null>(null)
const directoryAvailability = computed(() => getDirectoryStorageAvailability())
const canOpenRecent = computed(() => lastProject.value?.providerId !== 'browser-directory'
  || directoryAvailability.value.supported)

async function tryOpen(project: ProjectRef, restoring = false): Promise<boolean> {
  try {
    busy.value = true
    error.value = null
    const result = await openProject(project)
    family.setProject(result.project, result.meta, result.family)
    startAutosave()
    if (!restoring) ui.showToast('success', `已打开家族：${result.meta.name}`)
    await router.push('/tree')
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 授权失效或临时不可用时保留记录，允许用户重新授权并重试。
    error.value = restoring ? `暂时无法恢复最近的家族，请重试：${msg}` : msg
    return false
  } finally {
    busy.value = false
  }
}

async function onCreateExternal() {
  if (busy.value || !directoryAvailability.value.supported) return
  error.value = null
  try {
    busy.value = true
    const project = await pickProject('browser-directory', 'create')
    if (!project) return
    const name = project.displayName || '未命名家族'
    const result = await createProject(project, name)
    family.setProject(result.project, result.meta, result.family)
    startAutosave()
    ui.showToast('success', `已新建家族：${name}`)
    await router.push('/tree')
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
  }
}

async function onOpenExternal() {
  if (busy.value || !directoryAvailability.value.supported) return
  error.value = null
  try {
    busy.value = true
    const project = await pickProject('browser-directory', 'open')
    if (project) await tryOpen(project)
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
  }
}

function onChooseBrowserBundle() {
  if (busy.value || !directoryAvailability.value.supported) return
  error.value = null
  if (bundleFileInput.value) {
    // 再次选择同一备份时仍然触发 change；取消选择不丢失已有待导入文件。
    bundleFileInput.value.value = ''
    bundleFileInput.value.click()
  }
}

function onBrowserBundleSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  pendingBundleFile.value = file
  error.value = null
}

function onCancelBrowserImport() {
  if (busy.value) return
  pendingBundleFile.value = null
  error.value = null
}

async function onImportBrowserBundle() {
  const file = pendingBundleFile.value
  if (!file || busy.value || !directoryAvailability.value.supported) return
  error.value = null
  busy.value = true
  try {
    // 第二次点击单独提供目录选择器需要的用户激活，不能在文件 change 后自动调用。
    const imported = await importProjectBundle(file)
    if (imported && await tryOpen(imported.project)) pendingBundleFile.value = null
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
  }
}

async function onOpenLast() {
  const project = lastProject.value
  if (!project || busy.value || !canOpenRecent.value) return
  error.value = null
  busy.value = true
  try {
    // 必须从用户点击直接发起；启动恢复和后台 IO 不弹出授权窗口。
    await authorizeProject(project)
    await tryOpen(project)
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
  }
}

function onForgetLast() {
  setLastProjectRef(null)
  lastProject.value = null
}

onMounted(async () => {
  // 布局默认值由 UI store 在会话开始时检测一次，返回首页不改变用户的选择。
  const stored = getLastProjectRef()
  lastProject.value = stored && hasProvider(stored.providerId) ? stored : null
  if (!lastProject.value || !canOpenRecent.value) return

  // 启动自动恢复。失败时保留记录供用户重试。
  autoRestoring.value = true
  try {
    await tryOpen(lastProject.value, true)
  } finally {
    autoRestoring.value = false
  }
})
</script>

<template>
  <div class="app-safe-area-padded flex h-full flex-col items-center justify-center gap-6 overflow-auto">
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight">家族树</h1>
      <p class="mt-3 text-slate-500">记录家族成员、关系与故事</p>
    </div>

    <p v-if="autoRestoring" class="text-sm text-slate-400">正在恢复上次打开的家族…</p>

    <div v-else class="flex w-full max-w-md flex-col items-center gap-4">
      <p class="text-center text-sm text-slate-500">
        选择本地目录，保存家族资料和照片。
      </p>
      <p
        v-if="!directoryAvailability.supported"
        role="status"
        class="w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {{ directoryAvailability.reason }}
      </p>
      <div class="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          class="rounded-lg bg-slate-900 px-6 py-3 text-white shadow hover:bg-slate-700 disabled:opacity-50"
          :disabled="busy || !directoryAvailability.supported"
          @click="onCreateExternal"
        >
          新建家族
        </button>
        <button
          class="rounded-lg border border-slate-300 bg-white px-6 py-3 text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-50"
          :disabled="busy || !directoryAvailability.supported"
          @click="onOpenExternal"
        >
          打开已有家族
        </button>
      </div>

      <div v-if="directoryAvailability.supported" class="flex w-full flex-col gap-3">
        <input
          ref="bundleFileInput"
          type="file"
          accept=".familybundle"
          aria-label="选择家族备份文件"
          class="hidden"
          :disabled="busy"
          @change="onBrowserBundleSelected"
        >
        <button
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          :disabled="busy"
          @click="onChooseBrowserBundle"
        >
          导入家族备份
        </button>
        <div v-if="pendingBundleFile" class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p class="break-all text-sm text-slate-700">已选择：{{ pendingBundleFile.name }}</p>
          <p class="text-xs text-slate-500">下一步选择一个空文件夹，备份将解压到该目录。</p>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow hover:bg-slate-700 disabled:opacity-50"
              :disabled="busy"
              @click="onImportBrowserBundle"
            >
              选择空文件夹并导入
            </button>
            <button
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
              :disabled="busy"
              @click="onCancelBrowserImport"
            >
              取消导入
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="!autoRestoring && lastProject"
      class="mt-2 flex max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm"
    >
      <span class="text-xs text-slate-400">最近：</span>
      <button
        class="min-w-0 truncate hover:text-emerald-700 hover:underline disabled:opacity-50"
        :disabled="busy || !canOpenRecent"
        :title="lastProject.displayName"
        @click="onOpenLast"
      >
        {{ lastProject.displayName }}
      </button>
      <button
        class="text-xs text-slate-400 hover:text-rose-500"
        title="清除记录"
        :disabled="busy"
        @click="onForgetLast"
      >
        ✕
      </button>
    </div>

    <p v-if="busy && !autoRestoring" class="text-sm text-slate-400">处理中…</p>
    <p
      v-if="error"
      class="max-w-md rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
    >
      {{ error }}
    </p>

    <p class="text-center text-xs text-slate-400">
      数据直接保存在你授权的本地目录，不上传服务器。权限失效时需要重新授权，请定期复制目录备份。
    </p>
  </div>
</template>
