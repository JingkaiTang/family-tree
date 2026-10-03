<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { authorizeProject } from '@/services/storage'
import { flushNow } from '@/services/autosave'
import type { FamilyData } from '@/core/schema'
import {
  googleDriveState,
  prepareGoogleDrive,
  isGoogleDriveProvider,
  listGoogleDriveVersions,
  selectGoogleDriveVersion,
  resolveGoogleDriveConflict,
} from '@/services/googleDriveConnection'

const family = useFamilyStore()
const ui = useUiStore()
const router = useRouter()
const active = computed(() => family.projectRef && isGoogleDriveProvider(family.projectRef.providerId))
const busy = ref(false)
const error = ref<string | null>(null)
const versions = ref<Awaited<ReturnType<typeof listGoogleDriveVersions>>>([])
const draftUrl = ref<string | null>(null)
const draftRevision = ref<number | null>(null)
const currentError = computed(() => error.value || googleDriveState.error)
const draftName = computed(() => `${(family.projectMeta?.name || '家族草稿').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80)}-草稿.json`)

function revokeDraft() {
  if (draftUrl.value) URL.revokeObjectURL(draftUrl.value)
  draftUrl.value = null
  draftRevision.value = null
}

watch(() => family.projectToken, () => {
  error.value = null
  versions.value = []
  revokeDraft()
})
onBeforeUnmount(revokeDraft)

function report(e: unknown) {
  error.value = e instanceof Error ? e.message : String(e)
}

async function onPrepareDrive() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try { await prepareGoogleDrive() } catch (e) { report(e) }
  finally { busy.value = false }
}

async function onReconnect() {
  const project = family.projectRef
  const token = family.projectToken
  if (!project || busy.value || !googleDriveState.ready) return
  busy.value = true
  error.value = null
  try {
    // OAuth 只从这个点击发起，后台自动保存和媒体请求不会打开授权窗口。
    await authorizeProject(project)
    if (family.projectToken !== token) return
    await flushNow()
    if (family.projectToken === token) ui.showToast('success', 'Google Drive 已连接，修改已保存')
  } catch (e) {
    if (family.projectToken === token) report(e)
  } finally {
    busy.value = false
  }
}

async function onListVersions() {
  const project = family.projectRef
  const token = family.projectToken
  if (!project || busy.value) return
  busy.value = true
  error.value = null
  try {
    await authorizeProject(project)
    const result = await listGoogleDriveVersions(project)
    if (family.projectToken === token) versions.value = result
  } catch (e) {
    if (family.projectToken === token) report(e)
  } finally {
    busy.value = false
  }
}

async function onSelectVersion(revisionId: string) {
  const project = family.projectRef
  const token = family.projectToken
  if (!project || busy.value) return
  if (!window.confirm('打开此版本将替换当前页面的家族内容，尚未保存的编辑将被放弃。Google Drive 中其他版本会保留。继续吗？')) return
  const revision = family.revision
  busy.value = true
  error.value = null
  try {
    const result = await selectGoogleDriveVersion(project, revisionId)
    if (family.projectToken !== token) return
    if (family.revision !== revision) {
      throw new Error('读取版本期间又产生了修改，未切换版本。请先导出草稿，再重新选择版本，或确认以当前内容解决冲突后继续。')
    }
    family.setProject(result.project, result.meta, result.family)
    ui.setSelected(null)
    ui.setViewpoint(null)
    ui.setCanvasView(null)
    ui.resetFocusFlowState()
    await router.push('/tree')
    ui.showToast('info', '已打开所选版本；其他版本仍保留在 Google Drive。')
  } catch (e) {
    if (family.projectToken === token) report(e)
  } finally {
    busy.value = false
  }
}

async function onResolveConflict() {
  const project = family.projectRef
  const token = family.projectToken
  if (!project || busy.value) return
  busy.value = true
  error.value = null
  try {
    await authorizeProject(project)
    // 等待已有保存退出，冲突拒绝属于预期；网络等其他错误不能继续提交。
    try { await flushNow() } catch (e) {
      if (!(e instanceof Error && e.name === 'GoogleDriveConflictError')) throw e
    }
    if (family.projectToken !== token) return
    const currentVersions = await listGoogleDriveVersions(project)
    if (family.projectToken !== token) return
    versions.value = currentVersions
    const heads = currentVersions.filter(version => version.isHead).map(version => version.id)
    if (!heads.length) throw new Error('未找到可解决的远端版本，请刷新版本列表。')
    if (!window.confirm('将以当前页面的家族内容创建后续版本，结束当前已检测到的版本分歧。其他分支的内容不会自动合并，历史版本仍保留。确认使用当前内容吗？')) return
    const revision = family.revision
    const snapshot = JSON.parse(JSON.stringify(family.data)) as FamilyData
    await resolveGoogleDriveConflict(project, snapshot, heads)
    if (family.projectToken !== token) return
    const marked = family.markSaved(token, revision)
    versions.value = []
    ui.showToast('success', marked ? '已保存所选内容，历史版本仍保留' : '冲突已解决，后续修改等待保存')
  } catch (e) {
    if (family.projectToken === token) report(e)
  } finally {
    busy.value = false
  }
}

function onPrepareDraft() {
  if (!family.projectRef || !family.projectMeta) return
  revokeDraft()
  // 草稿救援不访问远端，不等待保存，也不包含令牌。照片仍只有引用。
  const blob = new Blob([JSON.stringify({
    draftVersion: 1,
    meta: family.projectMeta,
    family: family.data,
  }, null, 2)], { type: 'application/json' })
  draftUrl.value = URL.createObjectURL(blob)
  draftRevision.value = family.revision
}
</script>

<template>
  <aside v-if="active" class="fixed bottom-[max(.75rem,env(safe-area-inset-bottom))] right-3 z-40 max-h-[60vh] w-[min(26rem,calc(100vw-1.5rem))] overflow-auto rounded-lg border border-slate-300 bg-white p-3 text-sm shadow-lg" aria-label="Google Drive 保存状态">
    <details :open="Boolean(currentError)">
      <summary class="cursor-pointer text-slate-700">Google Drive · {{ currentError ? '需要处理' : family.isDirty ? '修改尚未保存' : '已保存' }}</summary>
      <div class="mt-3 flex flex-col gap-3">
        <p v-if="currentError" role="alert" class="break-words text-rose-700">{{ currentError }}</p>
        <button v-if="!googleDriveState.ready && currentError" type="button" class="self-start text-sky-800 disabled:opacity-50" :disabled="busy" @click="onPrepareDrive">重试加载 Google 授权</button>
        <p class="text-xs text-slate-500">修改只有上传成功后才算保存。授权过期时请重新连接；冲突版本会保留，内容不会自动合并。</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="rounded border border-slate-300 px-3 py-2 disabled:opacity-50" :disabled="busy || googleDriveState.busy || !googleDriveState.ready" @click="onReconnect">重新连接并保存</button>
          <button type="button" class="rounded border border-slate-300 px-3 py-2 disabled:opacity-50" :disabled="busy || !googleDriveState.ready" @click="onListVersions">查看历史与冲突版本</button>
        </div>
        <template v-if="versions.length">
          <ul class="flex max-h-40 flex-col gap-2 overflow-auto">
            <li v-for="version in versions" :key="version.id">
              <button type="button" class="text-left text-sky-800 disabled:opacity-50" :disabled="busy" @click="onSelectVersion(version.id)">{{ version.createdTime }}{{ version.isHead ? '（当前分支）' : '' }}</button>
            </li>
          </ul>
          <button type="button" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 disabled:opacity-50" :disabled="busy" @click="onResolveConflict">以当前内容解决冲突</button>
        </template>
        <div class="flex flex-col items-start gap-2 border-t border-slate-200 pt-3">
          <button type="button" class="text-sky-800" @click="onPrepareDraft">生成草稿 JSON（不含照片）</button>
          <p class="text-xs text-slate-500">如正在编辑成员，请先点击表单的“保存”以包含当前输入；即使上传失败，这些修改仍会保留在页面中。</p>
          <a v-if="draftUrl" :href="draftUrl" :download="draftName" class="rounded bg-slate-900 px-3 py-2 text-white">下载草稿 JSON（不含照片）</a>
          <p v-if="draftUrl" class="text-xs text-slate-500">{{ draftRevision === family.revision ? '已准备当前草稿。' : '准备后又有编辑，请重新生成以包含最新修改。' }}此文件用于保留文字与关系数据，不是完整家族备份。</p>
        </div>
        <p v-if="busy" class="text-xs text-slate-500">正在处理…</p>
      </div>
    </details>
  </aside>
</template>
