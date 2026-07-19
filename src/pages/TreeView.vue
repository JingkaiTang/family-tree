<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { flushNow } from '@/services/autosave'
import FamilyCanvas from '@/components/tree/FamilyCanvas.vue'
import SearchBar from '@/components/search/SearchBar.vue'
import { getKinship } from '@/core/kinship'
import { gcMedia } from '@/services/tauriApi'
import { v4 as uuidv4 } from 'uuid'

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()
const { projectMeta, projectPath, memberCount, isDirty, membersArray, data } = storeToRefs(family)
const { viewpointId, selectedId, showAuxiliaryRelations } = storeToRefs(ui)

const saveStatus = computed(() => {
  if (!family.projectPath) return ''
  if (isDirty.value) return '未保存…'
  return '已保存'
})

const rootId = computed(() => data.value.rootMemberId)
const layoutResetVersion = ref(0)
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

async function onBack() {
  try {
    await flushNow()
    ui.setViewpoint(null)
    ui.setSelected(null)
    ui.setShowAuxiliaryRelations(false)
    ui.setCanvasView(null)
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
 * FamilyCanvas 的 viewpointId watcher 会聚焦到该节点。
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
  if (ui.viewpointId) return
  const stored = data.value.defaultViewpointId
  if (!stored) return
  if (!family.getMember(stored)) {
    family.setDefaultViewpoint(undefined)
    return
  }
  ui.setViewpoint(stored)
})

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
  if (!family.projectPath) return
  try {
    const usedIds = family.membersArray.map((m) => m.photoId).filter((x): x is string => !!x)
    const trashed = await gcMedia(family.projectPath, usedIds)
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
  <div class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <h2 class="text-lg font-semibold">{{ projectMeta?.name ?? '（未打开项目）' }}</h2>
        <p class="text-xs text-slate-400">{{ projectPath }}</p>
      </div>
      <div class="flex items-center gap-4">
        <SearchBar :on-jump="onSelect" />
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
          class="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100"
          title="把未被任何成员引用的照片移入 .trash/"
          @click="onGcMedia"
        >
          清理未用照片
        </button>
        <button class="text-sm text-slate-500 hover:text-slate-900" @click="onBack">返回</button>
      </div>
    </header>

    <main class="flex-1">
      <FamilyCanvas
        :data="family.data"
        :root-id="rootId"
        :selected-id="selectedId"
        :viewpoint-id="viewpointId"
        :get-kinship="kinshipResolver"
        :initial-view="ui.canvasView"
        :layout-reset-version="layoutResetVersion"
        :show-auxiliary-relations="showAuxiliaryRelations"
        @select="onSelect"
        @open="onOpen"
        @view-change="ui.setCanvasView"
        @domain-row-order-change="family.setDomainRowOrderPreference"
        @bridge-order-change="family.setBridgeOrderPreference"
        @root-order-change="family.setRootOrderPreference"
        @subtree-order-change="family.setLayoutRowPreferenceBatch"
      />
    </main>

    <div
      v-if="ui.toast"
      class="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow"
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
