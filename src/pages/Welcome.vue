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
import {
  googleDriveState,
  prepareGoogleDrive,
  connectGoogleDrive,
  disconnectGoogleDrive,
  listGoogleDriveProjects,
  isGoogleDriveProvider,
  listGoogleDriveVersions,
  selectGoogleDriveVersion,
} from '@/services/googleDriveConnection'

const router = useRouter()
const privacyUrl = `${import.meta.env.BASE_URL}privacy.html`
const aboutUrl = `${import.meta.env.BASE_URL}about.html`
const family = useFamilyStore()
const ui = useUiStore()

const busy = ref(false)
const preparingDrive = ref(false)
const error = ref<string | null>(null)
const bundleFileInput = ref<HTMLInputElement | null>(null)
const pendingBundleFile = ref<File | null>(null)
/** 启动时是否正在自动尝试恢复上次项目（让 UI 显示 loading 而不是闪一下按钮） */
const autoRestoring = ref(false)
const lastProject = ref<ProjectRef | null>(null)
const driveProjects = ref<ProjectRef[]>([])
const driveName = ref('')
const conflictingProject = ref<ProjectRef | null>(null)
const driveVersions = ref<Awaited<ReturnType<typeof listGoogleDriveVersions>>>([])
const directoryAvailability = computed(() => getDirectoryStorageAvailability())
const canOpenRecent = computed(() => {
  const providerId = lastProject.value?.providerId
  if (providerId && isGoogleDriveProvider(providerId)) return googleDriveState.ready && !googleDriveState.busy
  return providerId !== 'browser-directory' || directoryAvailability.value.supported
})
const driveAccountLabel = computed(() => googleDriveState.account?.emailAddress
  || googleDriveState.account?.displayName || '已连接账号')

async function onPrepareDrive() {
  if (preparingDrive.value || !googleDriveState.configured) return
  preparingDrive.value = true
  error.value = null
  try {
    await prepareGoogleDrive()
    if (googleDriveState.providerId) await onRefreshDrive()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    preparingDrive.value = false
  }
}

async function onConnectDrive() {
  if (busy.value || googleDriveState.busy || !googleDriveState.ready) return
  busy.value = true
  error.value = null
  try {
    const providerId = await connectGoogleDrive()
    driveProjects.value = await listGoogleDriveProjects(providerId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onRefreshDrive() {
  const providerId = googleDriveState.providerId
  if (!providerId || busy.value) return
  busy.value = true
  error.value = null
  try {
    driveProjects.value = await listGoogleDriveProjects(providerId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function onDisconnectDrive() {
  if (busy.value) return
  disconnectGoogleDrive()
  driveProjects.value = []
  driveVersions.value = []
  conflictingProject.value = null
}

async function onCreateDrive() {
  const providerId = googleDriveState.providerId
  const name = driveName.value.trim()
  if (!providerId || !name || busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await createProject({ providerId, id: 'root', displayName: name }, name)
    family.setProject(result.project, result.meta, result.family)
    startAutosave()
    ui.showToast('success', `已新建家族：${name}`)
    await router.push('/tree')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onChooseDriveVersion(revisionId: string) {
  const project = conflictingProject.value
  if (!project || busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await selectGoogleDriveVersion(project, revisionId)
    family.setProject(result.project, result.meta, result.family)
    startAutosave()
    ui.showToast('info', '已打开所选版本；其他版本仍保留在 Google Drive。')
    await router.push('/tree')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onOpenDrive(project: ProjectRef) {
  if (busy.value) return
  await tryOpen(project)
}

async function tryOpen(project: ProjectRef, restoring = false): Promise<boolean> {
  try {
    busy.value = true
    error.value = null
    conflictingProject.value = null
    driveVersions.value = []
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
    if (isGoogleDriveProvider(project.providerId) && e instanceof Error && e.name === 'GoogleDriveConflictError') {
      conflictingProject.value = project
      try {
        driveVersions.value = await listGoogleDriveVersions(project)
      } catch (versionError) {
        error.value += '；版本列表读取失败：' + (versionError instanceof Error ? versionError.message : String(versionError))
      }
    }
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
  // 准备授权脚本并恢复有效连接；OAuth 弹窗始终由用户点击触发。本地功能不等待网络。
  void onPrepareDrive()
  // 布局默认值由 UI store 在会话开始时检测一次，返回首页不改变用户的选择。
  const stored = getLastProjectRef()
  lastProject.value = stored && (hasProvider(stored.providerId) || isGoogleDriveProvider(stored.providerId)) ? stored : null
  if (!lastProject.value || !canOpenRecent.value) return
  if (isGoogleDriveProvider(lastProject.value.providerId)) return

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
  <div class="app-safe-area-padded flex h-full flex-col items-center gap-6 overflow-auto py-8">
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight">家族树</h1>
      <p class="mt-3 text-slate-500">Family Tree · 记录家族成员、关系与故事</p>
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

      <section class="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Google Drive 存储">
        <div>
          <h2 class="font-semibold text-slate-900">Google Drive</h2>
          <p class="mt-1 text-xs text-slate-500">使用自己的 Google 账号保存家族资料与照片，可在不同设备打开。</p>
        </div>
        <p v-if="!googleDriveState.configured" class="text-xs text-slate-500">此站点尚未配置 Google Drive 连接。</p>
        <template v-else>
          <p v-if="googleDriveState.account" class="break-all text-sm text-slate-600">{{ driveAccountLabel }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              :disabled="busy || googleDriveState.busy || !googleDriveState.ready"
              @click="onConnectDrive"
            >{{ googleDriveState.account ? '重新连接 Google Drive' : '连接 Google Drive' }}</button>
            <button v-if="googleDriveState.account" type="button" class="text-sm text-slate-500 disabled:opacity-50" :disabled="busy" @click="onDisconnectDrive">断开连接</button>
          </div>
          <p class="text-xs text-slate-500">此浏览器会记住短期连接，过期后需重新连接；断开连接可清除记录。</p>
          <p v-if="!googleDriveState.ready && !googleDriveState.error" class="text-xs text-slate-500">正在准备 Google Drive 连接…</p>
          <p v-if="googleDriveState.error" class="text-sm text-rose-700">{{ googleDriveState.error }}</p>
          <button v-if="!googleDriveState.ready && googleDriveState.error" type="button" class="self-start text-sm text-sky-800 disabled:opacity-50" :disabled="preparingDrive" @click="onPrepareDrive">重试加载 Google 授权</button>
          <template v-if="googleDriveState.providerId">
            <form class="flex gap-2" @submit.prevent="onCreateDrive">
              <input v-model="driveName" aria-label="Google Drive 家族名称" maxlength="100" placeholder="家族名称" class="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm" :disabled="busy">
              <button type="submit" class="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50" :disabled="busy || !driveName.trim()">在 Drive 新建</button>
            </form>
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-600">此应用可访问的家族</span>
              <button type="button" class="text-sky-700 disabled:opacity-50" :disabled="busy" @click="onRefreshDrive">刷新列表</button>
            </div>
            <p v-if="!driveProjects.length" class="text-xs text-slate-500">暂无家族，可先新建一个。</p>
            <ul v-else class="flex max-h-48 flex-col gap-2 overflow-auto">
              <li v-for="project in driveProjects" :key="project.id">
                <button type="button" class="w-full rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50" :disabled="busy" @click="onOpenDrive(project)">{{ project.displayName }}</button>
              </li>
            </ul>
          </template>
        </template>
      </section>
      <section v-if="conflictingProject && driveVersions.length" class="w-full rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="选择 Drive 冲突版本">
        <p class="text-sm text-amber-900">此家族存在多个版本。选择要查看的版本，进入后可保留当前内容作为后续版本；其他版本仍可查看。</p>
        <ul class="mt-2 flex max-h-48 flex-col gap-2 overflow-auto">
          <li v-for="version in driveVersions" :key="version.id">
            <button type="button" class="text-left text-sm text-sky-800 disabled:opacity-50" :disabled="busy" @click="onChooseDriveVersion(version.id)">{{ version.createdTime }}{{ version.isHead ? '（当前分支）' : '' }}</button>
          </li>
        </ul>
      </section>

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
      数据直接保存在你授权的本地目录，或你连接的 Google Drive；本站不托管家族资料。权限失效时需要重新授权，请定期导出备份。
    </p>
    <nav aria-label="关于本站" class="flex gap-4 text-sm text-sky-700 underline underline-offset-4">
      <a :href="aboutUrl" target="_blank" rel="noopener">关于家族树（新窗口）</a>
      <a :href="privacyUrl" target="_blank" rel="noopener">隐私政策（新窗口）</a>
    </nav>
  </div>
</template>
