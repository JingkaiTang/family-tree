<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { pickDirectory } from '@/services/tauriApi'
import {
  createManagedProject,
  createProject,
  listManagedProjects,
  openProject,
} from '@/services/projectService'
import { startAutosave } from '@/services/autosave'
import { getLastProjectRef, setLastProjectRef } from '@/services/prefs'
import { externalProjectRef, projectRefName, type ProjectRef } from '@/services/projectRef'
import type { ManagedProjectSummary } from '@/services/projectRepository'
import { importProjectBundle } from '@/services/projectTransfer'
import {
  getRuntimePlatform,
  isMobilePlatform,
  type RuntimePlatform,
} from '@/services/runtime'

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()

const busy = ref(false)
const error = ref<string | null>(null)
const platformReady = ref(false)
const runtimePlatform = ref<RuntimePlatform>('web')
const mobileProjects = ref<ManagedProjectSummary[]>([])
const managedProjectName = ref('我的家族')
/** 启动时是否正在自动尝试恢复上次项目（让 UI 显示 loading 而不是闪一下按钮） */
const autoRestoring = ref(false)
const lastProject = ref<ProjectRef | null>(null)
const isMobile = computed(() => isMobilePlatform(runtimePlatform.value))

async function tryOpen(project: ProjectRef, silent = false): Promise<boolean> {
  try {
    busy.value = true
    const result = await openProject(project)
    family.setProject(result.project, result.meta, result.family)
    startAutosave()
    if (!silent) ui.showToast('success', `已打开家族：${result.meta.name}`)
    await router.push('/tree')
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (silent) {
      // 自动恢复失败：清掉无效记录，不打扰用户
      setLastProjectRef(null)
      lastProject.value = null
      console.warn('[Welcome] auto-restore failed:', msg)
    } else {
      error.value = msg
    }
    return false
  } finally {
    busy.value = false
  }
}

async function onCreateExternal() {
  error.value = null
  const dir = await pickDirectory('选择一个文件夹作为家族项目根目录')
  if (!dir) return
  const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? '未命名家族'
  try {
    busy.value = true
    const result = await createProject(externalProjectRef(dir), name)
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

async function onCreateManaged() {
  const name = managedProjectName.value.trim()
  if (!name) {
    error.value = '请输入家族名称'
    return
  }
  error.value = null
  try {
    busy.value = true
    const result = await createManagedProject(name)
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

async function onOpenExternal() {
  error.value = null
  const dir = await pickDirectory('选择要打开的家族项目文件夹')
  if (!dir) return
  await tryOpen(externalProjectRef(dir))
}

async function onImportManaged() {
  error.value = null
  try {
    busy.value = true
    const imported = await importProjectBundle()
    if (!imported) return
    mobileProjects.value = await listManagedProjects()
    await tryOpen(imported.project)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onOpenLast() {
  if (!lastProject.value) return
  await tryOpen(lastProject.value)
}

function onForgetLast() {
  setLastProjectRef(null)
  lastProject.value = null
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

onMounted(async () => {
  try {
    runtimePlatform.value = await getRuntimePlatform()
    if (isMobile.value) {
      mobileProjects.value = await listManagedProjects()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    platformReady.value = true
  }

  const stored = getLastProjectRef()
  const matchesRuntime = stored
    && (isMobile.value ? stored.kind === 'managed' : stored.kind === 'external')
  lastProject.value = matchesRuntime ? stored : null
  if (!matchesRuntime) return

  autoRestoring.value = true
  try {
    await tryOpen(stored, true)
  } finally {
    autoRestoring.value = false
  }
})
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-6 overflow-auto p-6 sm:p-8">
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight">家族树</h1>
      <p class="mt-3 text-slate-500">记录家族成员、关系与故事</p>
    </div>

    <p v-if="!platformReady" class="text-sm text-slate-400">正在准备本地项目…</p>
    <p v-else-if="autoRestoring" class="text-sm text-slate-400">正在恢复上次打开的家族…</p>

    <div v-else-if="isMobile" class="flex w-full max-w-md flex-col gap-5">
      <form class="flex gap-2" @submit.prevent="onCreateManaged">
        <input
          v-model="managedProjectName"
          aria-label="家族名称"
          maxlength="100"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
          placeholder="家族名称"
          :disabled="busy"
        >
        <button
          class="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-white shadow active:bg-slate-700 disabled:opacity-50"
          :disabled="busy"
          type="submit"
        >
          新建
        </button>
      </form>

      <button
        class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm active:bg-slate-50 disabled:opacity-50"
        :disabled="busy"
        @click="onImportManaged"
      >
        导入家族备份
      </button>

      <section class="flex flex-col gap-2" aria-label="本机家族项目">
        <h2 class="text-sm font-medium text-slate-500">本机家族</h2>
        <button
          v-for="item in mobileProjects"
          :key="item.project.id"
          class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50 disabled:opacity-50"
          :disabled="busy"
          @click="tryOpen(item.project)"
        >
          <span class="block font-medium text-slate-900">{{ item.meta.name }}</span>
          <span class="mt-1 block text-xs text-slate-400">
            最近更新：{{ formatUpdatedAt(item.meta.updatedAt) }}
          </span>
        </button>
        <p v-if="mobileProjects.length === 0" class="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
          暂无本机家族，输入名称即可新建。
        </p>
      </section>
    </div>

    <div v-else-if="platformReady" class="flex flex-col items-center gap-4">
      <div class="flex gap-4">
        <button
          class="rounded-lg bg-slate-900 px-6 py-3 text-white shadow hover:bg-slate-700 disabled:opacity-50"
          :disabled="busy"
          @click="onCreateExternal"
        >
          新建家族
        </button>
        <button
          class="rounded-lg border border-slate-300 bg-white px-6 py-3 text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-50"
          :disabled="busy"
          @click="onOpenExternal"
        >
          打开已有家族
        </button>
      </div>

      <div
        v-if="lastProject"
        class="mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm"
      >
        <span class="text-xs text-slate-400">最近：</span>
        <button
          class="hover:text-emerald-700 hover:underline disabled:opacity-50"
          :disabled="busy"
          :title="lastProject.kind === 'external' ? lastProject.path : lastProject.id"
          @click="onOpenLast"
        >
          {{ projectRefName(lastProject) }}
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

    <p class="text-center text-xs text-slate-400">
      <template v-if="isMobile">
        数据保存在本机应用空间，卸载应用前请先导出备份。
      </template>
      <template v-else>
        数据以普通文件夹形式保存在你选择的位置，可直接复制/备份。
      </template>
    </p>
  </div>
</template>
