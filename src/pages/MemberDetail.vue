<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { flushNow } from '@/services/autosave'
import MemberForm from '@/components/member/MemberForm.vue'
import RelationEditor from '@/components/member/RelationEditor.vue'
import { getKinship } from '@/core/kinship'
import type { Member } from '@/core/schema'

const props = defineProps<{ id: string }>()

const router = useRouter()
const family = useFamilyStore()
const ui = useUiStore()
const { isDirty, data } = storeToRefs(family)
const { viewpointId } = storeToRefs(ui)

const member = computed(() => family.getMember(props.id))

// 表单本地副本
const draft = ref<Member | null>(null)

watch(
  member,
  (m) => {
    draft.value = m ? { ...m } : null
  },
  { immediate: true },
)

// 视角相关
const viewpointMember = computed(() => (viewpointId.value ? family.getMember(viewpointId.value) : null))
const autoKinship = computed(() => {
  if (!viewpointId.value || viewpointId.value === props.id) return null
  return getKinship(viewpointId.value, props.id, data.value.members, data.value.nicknameOverrides)
})
const overrideValue = computed(() => {
  if (!viewpointId.value) return ''
  return data.value.nicknameOverrides?.[viewpointId.value]?.[props.id] ?? ''
})
const overrideDraft = ref('')
watch(overrideValue, (v) => (overrideDraft.value = v), { immediate: true })

function saveOverride() {
  if (!viewpointId.value) return
  family.setNicknameOverride(viewpointId.value, props.id, overrideDraft.value || null)
}

function clearOverride() {
  if (!viewpointId.value) return
  family.setNicknameOverride(viewpointId.value, props.id, null)
  overrideDraft.value = ''
}

async function onSave() {
  if (!draft.value) return
  family.upsertMember({ ...draft.value })
  try {
    await flushNow()
    ui.showToast('success', '已保存')
  } catch (e) {
    ui.showToast('error', '保存失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function onCancel() {
  router.back()
}

async function onDelete() {
  if (!member.value) return
  if (!confirm(`确认删除「${member.value.lastName}${member.value.firstName}」？此操作会断开 TA 与其他成员的所有关系。`)) {
    return
  }
  family.deleteMember(props.id)
  try {
    await flushNow()
  } catch {
    /* ignore */
  }
  router.push('/tree')
}

function onBack() {
  router.back()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <h2 class="text-lg font-semibold">
          {{ member ? `${member.lastName}${member.firstName}` : '成员不存在' }}
        </h2>
        <p class="text-xs text-slate-400">ID: {{ id }}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm" :class="isDirty ? 'text-amber-600' : 'text-emerald-600'">
          {{ isDirty ? '未保存…' : '已保存' }}
        </span>
        <button class="text-sm text-slate-500 hover:text-slate-900" @click="onBack">返回</button>
      </div>
    </header>

    <main class="flex flex-1 overflow-hidden">
      <!-- 左侧：基本信息表单 -->
      <section class="flex-1 overflow-auto border-r border-slate-200 bg-white p-6">
        <div v-if="!draft" class="text-slate-400">找不到该成员。</div>
        <MemberForm
          v-else
          v-model="draft"
          @save="onSave"
          @cancel="onCancel"
          @delete="onDelete"
        />
      </section>

      <!-- 右侧：关系编辑 + 称呼覆盖 -->
      <aside class="w-96 overflow-auto bg-slate-50 p-6">
        <h3 class="mb-3 font-semibold">家庭关系</h3>
        <RelationEditor v-if="member" :member-id="id" />

        <div
          v-if="viewpointMember && viewpointId !== id"
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
      </aside>
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
