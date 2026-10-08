<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import { storeToRefs } from 'pinia'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { flushNow } from '@/services/autosave'
import { deletePhoto, type ProjectRef } from '@/services/storage'
import MemberForm from '@/components/member/MemberForm.vue'
import RelationEditor from '@/components/member/RelationEditor.vue'
import SiblingOrderEditor from '@/components/member/SiblingOrderEditor.vue'
import { getKinship } from '@/core/kinship'
import type { FamilyData, Member } from '@/core/schema'

const props = defineProps<{ id?: string }>()

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()
const { isDirty, data } = storeToRefs(family)
const { viewpointId } = storeToRefs(ui)

// 草稿只在切换成员或项目时重建，关系的即时保存不会覆盖正在输入的资料。
const draft = ref<Member | null>(null)
const member = computed(() => family.getMember(props.id ?? draft.value?.id ?? ''))
const baselineProfile = ref('')
const saving = ref(false)
const discarding = ref(false)
const saveError = ref<string | null>(null)
const mediaPending = ref(false)
const formVersion = ref(0)
let editorSession = 0
let disposed = false
let submittedProfile: { session: number; token: number; value: string } | null = null
const stagedPhotos = new Map<string, {
  photoId: string
  project: ProjectRef
  data: FamilyData
}>()

function resetDraft() {
  editorSession += 1
  saving.value = false
  discarding.value = false
  saveError.value = null
  submittedProfile = null
  formVersion.value += 1
  mediaPending.value = false
  const source = member.value
  draft.value = source ? { ...source, ...profileOf(source) } : props.id ? null : {
    id: uuidv4(), firstName: '新成员', lastName: '', gender: 'other',
    parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [],
  }
  baselineProfile.value = draft.value ? JSON.stringify(profileOf(draft.value)) : ''
}

const profileDirty = computed(() => !!draft.value
  && JSON.stringify(profileOf(draft.value)) !== baselineProfile.value)

// 视角相关
const viewpointMember = computed(() => (viewpointId.value ? family.getMember(viewpointId.value) : null))
const autoKinship = computed(() => {
  if (!props.id || !viewpointId.value || viewpointId.value === props.id) return null
  return getKinship(
    viewpointId.value,
    props.id,
    data.value.members,
    {},
    data.value.siblingOrders,
  )
})
const overrideValue = computed(() => {
  if (!props.id || !viewpointId.value) return ''
  return data.value.nicknameOverrides?.[viewpointId.value]?.[props.id] ?? ''
})
const overrideDraft = ref('')
watch(overrideValue, (v) => (overrideDraft.value = v), { immediate: true })

function saveOverride() {
  if (!props.id || !viewpointId.value) return
  family.setNicknameOverride(viewpointId.value, props.id, overrideDraft.value || null)
}

function clearOverride() {
  if (!props.id || !viewpointId.value) return
  family.setNicknameOverride(viewpointId.value, props.id, null)
  overrideDraft.value = ''
}

const overrideDirty = computed(() => overrideDraft.value !== overrideValue.value)
const hasDraftChanges = computed(() => profileDirty.value || overrideDirty.value || mediaPending.value)
const saveStatus = computed(() => !family.canEdit ? '仅查看' : saving.value ? '保存中…'
  : hasDraftChanges.value ? '资料未保存'
    : isDirty.value ? '项目未保存…' : !member.value && draft.value ? '新成员尚未保存' : '已保存')

async function onSave(navigateToMember = true): Promise<boolean> {
  if (!family.canEdit || !draft.value || saving.value || discarding.value || mediaPending.value) return false
  const session = editorSession
  const projectToken = family.projectToken
  const id = draft.value.id
  const isCurrent = () => !disposed && session === editorSession && projectToken === family.projectToken
  saving.value = true
  saveError.value = null
  try {
    const profile = profileOf(draft.value)
    if (member.value) {
      family.updateMember(id, profile)
    } else if (!props.id && family.projectRef) {
      family.upsertMember({ ...draft.value, ...profile })
      if (!family.data.rootMemberId) family.setRootMember(id)
    } else {
      return false
    }
    // 姓名称呼草稿也纳入本次明确保存，避免离开时漏掉右侧输入。
    if (overrideDirty.value) saveOverride()
    submittedProfile = { session, token: projectToken, value: JSON.stringify(profile) }
    await flushNow()
    if (!isCurrent()) return false
    await discardUnreferencedStagedPhotos(true)
    if (!isCurrent()) return false
    baselineProfile.value = JSON.stringify(profile)
    ui.showToast('success', '已保存')
    if (!props.id && navigateToMember) {
      // 仅改变这位新成员的地址；使用 replace 保证“返回”仍回到家族树。
      saving.value = false
      await router.replace({ name: 'member', params: { id } })
    }
    return true
  } catch (e) {
    if (isCurrent()) {
      saveError.value = '保存失败：' + (e instanceof Error ? e.message : String(e))
      ui.showToast('error', saveError.value)
    }
    return false
  } finally {
    if (isCurrent()) saving.value = false
  }
}

/** 资料表单只拥有这些字段，不能把旧草稿中的关系或扩展数据写回。 */
function profileOf(value: Member) {
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    gender: value.gender,
    nickname: value.nickname || undefined,
    photoId: value.photoId || undefined,
    birthDate: value.birthDate || undefined,
    deathDate: value.deathDate || undefined,
    birthPlace: value.birthPlace || undefined,
    occupation: value.occupation || undefined,
    education: value.education || undefined,
    currentResidence: value.currentResidence || undefined,
    notes: value.notes || undefined,
  }
}

async function onCancel() {
  if (saving.value || discarding.value) return
  resetDraft()
  overrideDraft.value = overrideValue.value
  const session = editorSession
  const token = family.projectToken
  discarding.value = true
  await discardUnreferencedStagedPhotos()
  if (!disposed && session === editorSession && token === family.projectToken) {
    discarding.value = false
    router.back()
  }
}

async function onDelete() {
  if (!family.canEdit) return
  if (!member.value || saving.value) return
  if (!confirm(`确认删除「${member.value.lastName}${member.value.firstName}」？此操作会断开 TA 与其他成员的所有关系。`)) {
    return
  }
  family.deleteMember(member.value.id)
  draft.value = null
  baselineProfile.value = ''
  overrideDraft.value = overrideValue.value
  try {
    await flushNow()
    await discardUnreferencedStagedPhotos()
  } catch (e) {
    ui.showToast('error', '删除保存失败：' + (e instanceof Error ? e.message : String(e)))
    return
  }
  router.push('/tree')
}

function onBack() {
  router.back()
}

const leaveDialog = ref<HTMLDialogElement | null>(null)
const leaveDialogOpen = ref(false)
let pendingLeave: Promise<boolean> | null = null
let resolveLeave: ((leave: boolean) => void) | null = null

function finishLeave(leave: boolean) {
  leaveDialog.value?.close()
  leaveDialogOpen.value = false
  resolveLeave?.(leave)
  resolveLeave = null
  pendingLeave = null
}

function confirmLeave(): boolean | Promise<boolean> {
  if (saving.value) return false
  if (!hasDraftChanges.value) return true
  if (pendingLeave) return pendingLeave
  leaveDialogOpen.value = true
  pendingLeave = new Promise(resolve => { resolveLeave = resolve })
  void nextTick(() => leaveDialog.value?.showModal())
  return pendingLeave
}

async function saveAndLeave() {
  if (await onSave(false)) finishLeave(true)
}

async function discardAndLeave() {
  if (saving.value || discarding.value) return
  const leaving = pendingLeave
  resetDraft()
  overrideDraft.value = overrideValue.value
  const session = editorSession
  const token = family.projectToken
  discarding.value = true
  await discardUnreferencedStagedPhotos()
  if (!disposed && session === editorSession && token === family.projectToken) {
    discarding.value = false
    if (leaving === pendingLeave) finishLeave(true)
  }
}

onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate((to, from) => to.name !== from.name || to.params.id !== from.params.id
  ? confirmLeave() : true)

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasDraftChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

watch(() => [family.projectToken, props.id] as const, () => {
  finishLeave(false)
  // 新路由不能复用上一位新成员的 UUID。
  draft.value = null
  resetDraft()
}, { immediate: true })

// Drive 重连或其他保存入口也可完成已提交资料的持久化；只推进基线，不覆盖后续输入。
watch(() => family.isDirty, dirty => {
  const submitted = submittedProfile
  if (dirty || !submitted || submitted.session !== editorSession
    || submitted.token !== family.projectToken || !member.value
    || JSON.stringify(profileOf(member.value)) !== submitted.value) return
  baselineProfile.value = submitted.value
  saveError.value = null
  submittedProfile = null
}, { flush: 'sync' })

function onMediaStaged(photoId: string) {
  const project = family.projectRef
  if (!project) return
  const key = JSON.stringify([project.providerId, project.id, photoId])
  stagedPhotos.set(key, { photoId, project, data: family.data })
}

async function discardUnreferencedStagedPhotos(preserveDraft = false) {
  if (stagedPhotos.size === 0) return
  for (const [key, staged] of [...stagedPhotos]) {
    const { photoId, project, data } = staged
    if (preserveDraft && data === family.data && draft.value?.photoId === photoId) continue
    // 使用照片所属项目的数据判断引用，不能拿切换后的项目决定是否删除。
    if (Object.values(data.members).some(value => value.photoId === photoId)) {
      stagedPhotos.delete(key)
      continue
    }
    try {
      await deletePhoto(project, photoId)
      stagedPhotos.delete(key)
    } catch (e) {
      ui.showToast('error', '暂存照片清理失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }
}

onBeforeUnmount(() => {
  disposed = true
  finishLeave(false)
  window.removeEventListener('beforeunload', onBeforeUnload)
  void discardUnreferencedStagedPhotos()
})
</script>

<template>
  <div class="app-safe-area flex h-full flex-col">
    <header class="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div class="min-w-0">
        <h2 class="truncate text-lg font-semibold">
          {{ member ? `${member.lastName}${member.firstName}` : draft ? '新建成员' : '成员不存在' }}
        </h2>
        <p v-if="member" class="text-xs text-slate-400">ID: {{ member.id }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <span class="text-sm" role="status" :class="hasDraftChanges || isDirty || !member ? 'text-amber-600' : 'text-emerald-600'">
          {{ saveStatus }}
        </span>
        <button :disabled="saving || discarding" class="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50" @click="onBack">返回</button>
      </div>
    </header>

    <main :inert="discarding" class="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row md:overflow-hidden">
      <!-- 左侧：基本信息表单 -->
      <section class="shrink-0 border-b border-slate-200 bg-white p-4 md:min-h-0 md:flex-1 md:overflow-auto md:border-r md:border-b-0 md:p-6">
        <p v-if="saveError" role="alert" class="mb-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{ saveError }}。修改仍保留在当前项目中，请重试保存。</p>
        <div v-if="!draft" class="text-slate-400">找不到该成员。</div>
        <MemberForm
          v-else
          :key="`${family.projectToken}:${id}:${formVersion}`"
          v-model="draft"
          :can-delete="!!member && family.canEdit"
          :read-only="!family.canEdit"
          :saving="saving"
          @save="onSave()"
          @cancel="onCancel"
          @delete="onDelete"
          @media-stage="onMediaStaged"
          @media-pending="mediaPending = $event"
        />
      </section>

      <!-- 右侧：关系编辑 + 称呼覆盖 -->
      <aside class="w-full shrink-0 bg-slate-50 p-4 md:w-96 md:overflow-auto md:p-6">
        <fieldset :disabled="saving || !family.canEdit">
          <h3 class="mb-3 font-semibold">家庭关系</h3>
          <p class="mb-3 text-xs text-slate-500">{{ !family.canEdit ? '当前项目仅查看。' : member ? '关系与长幼排序修改后自动保存；左侧资料需点击保存。' : '保存成员后可添加家庭关系。' }}</p>
          <RelationEditor v-if="member" :member-id="member.id" />
          <SiblingOrderEditor v-if="member" :member-id="member.id" />

          <div
            v-if="member && viewpointMember && viewpointId !== member.id"
            class="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-3"
          >
            <div class="mb-1 text-xs font-medium text-emerald-700">
              从「{{ viewpointMember.lastName }}{{ viewpointMember.firstName }}」视角看
            </div>
            <div class="mb-2 text-sm text-slate-700">
              自动推算：<span class="font-medium">{{ autoKinship ?? '—' }}</span>
            </div>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              <span>手动覆盖称呼（留空则使用自动推算）</span>
              <input
                v-model="overrideDraft"
                placeholder="例如：二叔 / 表姨婆"
                class="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <div class="mt-2 flex gap-2">
              <button
                class="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700"
                @click="saveOverride"
              >
                保存覆盖
              </button>
              <button
                v-if="overrideValue"
                class="rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-100"
                @click="clearOverride"
              >
                清除
              </button>
            </div>
          </div>
        </fieldset>
      </aside>
    </main>

    <dialog
      v-if="leaveDialogOpen"
      ref="leaveDialog"
      role="dialog"
      aria-labelledby="member-unsaved-title"
      aria-describedby="member-unsaved-description"
      class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border-0 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      @cancel.prevent="!saving && !discarding && finishLeave(false)"
    >
      <h3 id="member-unsaved-title" class="text-lg font-semibold">有未保存修改</h3>
      <p id="member-unsaved-description" class="mt-2 text-sm text-slate-600">资料修改尚未保存。已提交的关系修改会保留。</p>
      <p v-if="saveError" role="alert" class="mt-2 text-sm text-rose-700">{{ saveError }}。已提交的修改仍保留在项目中；取消或放弃不会撤销这部分修改。</p>
      <p v-if="mediaPending" class="mt-2 text-sm text-amber-700">照片尚在处理，请继续编辑并完成照片处理后保存。</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button autofocus :disabled="saving || discarding" class="rounded border border-slate-300 px-3 py-2 text-sm" @click="finishLeave(false)">继续编辑</button>
        <button :disabled="saving || discarding" class="rounded border border-slate-300 px-3 py-2 text-sm" @click="discardAndLeave">放弃修改</button>
        <button :disabled="saving || discarding || mediaPending" class="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50" @click="saveAndLeave">{{ saving ? '保存中…' : '保存并离开' }}</button>
      </div>
    </dialog>

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
