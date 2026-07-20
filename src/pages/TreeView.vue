<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { flushNow } from '@/services/autosave'
import TreeLayoutHost from '@/components/tree/TreeLayoutHost.vue'
import SearchBar from '@/components/search/SearchBar.vue'
import { getKinship } from '@/core/kinship'
import { projectRepository } from '@/services/projectRepository'
import { v4 as uuidv4 } from 'uuid'
import type { LayoutModePreference } from '@/core/layoutMode'
import { exportProjectBundle } from '@/services/projectTransfer'

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()
const { projectMeta, projectPath, memberCount, isDirty, membersArray, data } = storeToRefs(family)
const {
  viewpointId,
  selectedId,
  showAuxiliaryRelations,
  defaultLayoutMode,
  layoutModePreference,
  resolvedLayoutMode,
  layoutFocusId,
  focusFlowExpandedBranchIds,
  focusFlowScrollTop,
} = storeToRefs(ui)

const saveStatus = computed(() => {
  if (!family.projectRef) return ''
  if (isDirty.value) return '未保存…'
  return '已保存'
})

const rootId = computed(() => data.value.rootMemberId)
const layoutResetVersion = ref(0)
const exporting = ref(false)
const canRestoreDefaultLayout = computed(() => {
  const preferences = data.value.layoutPreferences
  return preferences.rootOrders.length > 0
    || preferences.rowOrders.length > 0
    || preferences.bridgeOrders.length > 0
})

function restoreDefaultLayout() {
  if (!canRestoreDefaultLayout.value) return
  family.clearAllLayoutOrderPreferences()
  ui.setCanvasView(null)
  layoutResetVersion.value += 1
}

function onLayoutModeChange(event: Event) {
  ui.setLayoutModePreference((event.target as HTMLSelectElement).value as LayoutModePreference)
}

function setLayoutFocus(id: string) {
  if (!family.getMember(id)) return
  ui.setLayoutFocus(id)
  ui.setFocusFlowScrollTop(0)
}

function ensureLayoutFocus() {
  if (layoutFocusId.value && family.getMember(layoutFocusId.value)) return
  const fallback = [
    selectedId.value,
    viewpointId.value,
    data.value.rootMemberId,
    ...Object.keys(data.value.members).sort((left, right) => left.localeCompare(right)),
  ].find((id): id is string => Boolean(id) && family.getMember(id!) !== undefined)
  ui.setLayoutFocus(fallback ?? null)
}

async function onBack() {
  try {
    await flushNow()
    ui.setViewpoint(null)
    ui.setSelected(null)
    ui.setShowAuxiliaryRelations(false)
    ui.setCanvasView(null)
    ui.resetFocusFlowState()
    family.closeProject()
    await router.push('/')
  } catch (e) {
    ui.showToast('error', '保存失败，项目保持打开：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function onSaveNow() {
  try {
    await flushNow()
    ui.showToast('success', '已保存')
  } catch (e) {
    ui.showToast('error', '保存失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function onExportBundle() {
  if (!family.projectRef || exporting.value) return
  try {
    exporting.value = true
    await flushNow()
    const exported = await exportProjectBundle(family.projectRef)
    if (exported) ui.showToast('success', '家族备份已导出')
  } catch (e) {
    ui.showToast('error', '导出失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    exporting.value = false
  }
}

function onSelect(id: string) {
  ui.setSelected(id)
}

function onOpen(id: string) {
  router.push({ name: 'member', params: { id } })
}

function setViewpoint() {
  ui.setViewpoint(selectedId.value)
  // 持久化到项目文件：下次打开该家族会自动以这个人为视角并聚焦画布
  family.setDefaultViewpoint(selectedId.value ?? undefined)
}

function clearViewpoint() {
  ui.setViewpoint(null)
  family.setDefaultViewpoint(undefined)
}

/**
 * 进入 TreeView 时若项目里存了 defaultViewpointId，恢复到 UI store。
 * 称呼视角与纵流聚焦点分别维护，避免选择或切换布局时互相覆盖。
 *
 * 会话策略：
 *   - UI 里已有视角且仍然有效 → 保留（从 MemberDetail 返回时不重置画布位置）
 *   - UI 里视角指向不存在的成员（如换了项目）→ 清掉，走默认视角恢复
 *   - UI 没视角 → 从 data.defaultViewpointId 恢复
 *   - data.defaultViewpointId 也失效 → 清空项目里的存值
 */
onMounted(() => {
  if (ui.viewpointId && !family.getMember(ui.viewpointId)) {
    ui.setViewpoint(null)
  }
  if (!ui.viewpointId) {
    const stored = data.value.defaultViewpointId
    if (stored && !family.getMember(stored)) {
      family.setDefaultViewpoint(undefined)
    } else if (stored) {
      ui.setViewpoint(stored)
    }
  }
  ensureLayoutFocus()
})

watch(
  () => Object.keys(data.value.members).sort((left, right) => left.localeCompare(right)).join('\u0000'),
  ensureLayoutFocus,
)

function kinshipResolver(fromId: string, toId: string): string | null {
  return getKinship(
    fromId,
    toId,
    data.value.members,
    data.value.nicknameOverrides,
    data.value.siblingOrders,
  )
}

async function onGcMedia() {
  if (!family.projectRef) return
  try {
    const usedIds = family.membersArray.map((m) => m.photoId).filter((x): x is string => !!x)
    const trashed = await projectRepository.gcMedia(family.projectRef, usedIds)
    if (trashed > 0) {
      ui.showToast('success', `已清理 ${trashed} 张未使用的照片到 .trash/`)
    } else {
      ui.showToast('info', '没有需要清理的照片')
    }
  } catch (e) {
    ui.showToast('error', '清理失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function onAddMember() {
  const id = uuidv4()
  family.upsertMember({
    id,
    firstName: '新成员',
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  })
  if (!family.data.rootMemberId) {
    family.setRootMember(id)
  }
  router.push({ name: 'member', params: { id } })
}

// M3 验证用：快速添加一个祖孙三代 fixture
function seedFixture() {
  const gpa = uuidv4()
  const gma = uuidv4()
  const dad = uuidv4()
  const mom = uuidv4()
  const child = uuidv4()

  family.upsertMember({
    id: gpa, firstName: '爷爷', lastName: '张', gender: 'male',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  })
  family.upsertMember({
    id: gma, firstName: '奶奶', lastName: '李', gender: 'female',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  })
  family.upsertMember({
    id: dad, firstName: '父', lastName: '张', gender: 'male',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  })
  family.upsertMember({
    id: mom, firstName: '母', lastName: '王', gender: 'female',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  })
  family.upsertMember({
    id: child, firstName: '小明', lastName: '张', gender: 'male',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  })

  family.linkRelation(gpa, gma, 'spouse')
  // dad 的父母是 gpa 和 gma
  family.linkRelation(dad, gpa, 'parent')
  family.linkRelation(dad, gma, 'parent')
  family.linkRelation(dad, mom, 'spouse')
  // child 的父母是 dad 和 mom
  family.linkRelation(child, dad, 'parent')
  family.linkRelation(child, mom, 'parent')

  family.setRootMember(gpa)
}
</script>

<template>
  <div class="app-safe-area flex h-full flex-col">
    <header class="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div class="flex min-w-0 items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold">{{ projectMeta?.name ?? '（未打开项目）' }}</h2>
          <p class="hidden truncate text-xs text-slate-400 md:block">{{ projectPath }}</p>
        </div>
        <button class="shrink-0 text-sm text-slate-500 hover:text-slate-900 sm:hidden" @click="onBack">返回</button>
      </div>
      <div class="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <SearchBar :on-jump="onSelect" />
        <label class="flex min-h-9 items-center gap-1 text-sm text-slate-600">
          <span>布局</span>
          <select
            data-testid="layout-mode-select"
            class="rounded border border-slate-300 bg-white px-2 py-1"
            :value="layoutModePreference"
            @change="onLayoutModeChange"
          >
            <option value="auto">自动（{{ defaultLayoutMode === 'focus-flow' ? '纵流' : '网格' }}）</option>
            <option value="focus-flow">聚焦纵流</option>
            <option value="family-grid">家族网格</option>
          </select>
        </label>
        <label class="flex items-center gap-1 text-sm text-slate-600">
          <input
            data-testid="auxiliary-relations-toggle"
            type="checkbox"
            :checked="showAuxiliaryRelations"
            @change="ui.setShowAuxiliaryRelations(($event.target as HTMLInputElement).checked)"
          >
          辅助关系
        </label>
        <span class="text-xs text-slate-500">成员：{{ memberCount }}</span>
        <button
          class="rounded bg-slate-900 px-3 py-1 text-sm text-white hover:bg-slate-700"
          @click="onAddMember"
        >
          + 新建成员
        </button>
        <button
          v-if="resolvedLayoutMode === 'focus-flow' && selectedId && layoutFocusId !== selectedId"
          class="rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
          @click="setLayoutFocus(selectedId)"
        >
          聚焦选中
        </button>
        <button
          v-if="selectedId && viewpointId !== selectedId"
          class="rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
          @click="setViewpoint"
        >
          以选中为视角
        </button>
        <button
          v-if="viewpointId"
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          @click="clearViewpoint"
        >
          清除视角
        </button>
        <button
          v-if="resolvedLayoutMode === 'family-grid'"
          data-testid="restore-default-layout"
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canRestoreDefaultLayout"
          @click="restoreDefaultLayout"
        >
          恢复默认布局
        </button>
        <button
          v-if="memberCount === 0"
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100"
          @click="seedFixture"
        >
          加载示例（临时）
        </button>
        <span class="text-sm" :class="isDirty ? 'text-amber-600' : 'text-emerald-600'">
          {{ saveStatus }}
        </span>
        <button
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
          :disabled="!isDirty"
          @click="onSaveNow"
        >
          立即保存
        </button>
        <button
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
          :disabled="exporting"
          @click="onExportBundle"
        >
          {{ exporting ? '导出中…' : '导出备份' }}
        </button>
        <button
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100"
          title="把未被任何成员引用的照片移入 .trash/"
          @click="onGcMedia"
        >
          清理未用照片
        </button>
        <button class="hidden text-sm text-slate-500 hover:text-slate-900 sm:inline" @click="onBack">返回</button>
      </div>
    </header>

    <main class="min-h-0 flex-1">
      <TreeLayoutHost
        :mode="resolvedLayoutMode"
        :data="family.data"
        :root-id="rootId"
        :selected-id="selectedId"
        :viewpoint-id="viewpointId"
        :layout-focus-id="layoutFocusId"
        :get-kinship="kinshipResolver"
        :initial-grid-view="ui.canvasView"
        :initial-focus-scroll-top="focusFlowScrollTop"
        :expanded-branch-ids="focusFlowExpandedBranchIds"
        :layout-reset-version="layoutResetVersion"
        :show-auxiliary-relations="showAuxiliaryRelations"
        @select="onSelect"
        @open="onOpen"
        @grid-view-change="ui.setCanvasView"
        @focus-scroll-change="ui.setFocusFlowScrollTop"
        @layout-focus-change="setLayoutFocus"
        @focus-branch-toggle="ui.toggleFocusFlowBranch"
        @domain-row-order-change="family.setDomainRowOrderPreference"
        @bridge-order-change="family.setBridgeOrderPreference"
        @root-order-change="family.setRootOrderPreference"
        @subtree-order-change="family.setLayoutRowPreferenceBatch"
      />
    </main>

    <div
      v-if="ui.toast"
      class="safe-area-toast pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow"
      :class="{
        'bg-emerald-600': ui.toast.type === 'success',
        'bg-rose-600': ui.toast.type === 'error',
        'bg-slate-700': ui.toast.type === 'info',
      }"
    >
      {{ ui.toast.text }}
    </div>
  </div>
</template>
