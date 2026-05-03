<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFamilyStore } from '@/stores/family'
import type { Member } from '@/core/schema'

type RelationKind = 'parent' | 'child' | 'sibling' | 'spouse' | 'godparent' | 'godchild'

const props = defineProps<{ memberId: string }>()

const family = useFamilyStore()

const me = computed(() => family.getMember(props.memberId))

const candidates = computed(() =>
  family.membersArray.filter((m) => m.id !== props.memberId),
)

const parentsList = computed(() =>
  (me.value?.parents ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)
const childrenList = computed(() =>
  (me.value?.children ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)
const siblingsList = computed(() =>
  (me.value?.siblings ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)
const spousesList = computed(() =>
  (me.value?.spouses ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)
const godparentsList = computed(() =>
  (me.value?.godparents ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)
const godchildrenList = computed(() =>
  (me.value?.godchildren ?? [])
    .map((r) => family.getMember(r.id))
    .filter((m): m is Member => !!m),
)

const addKind = ref<RelationKind>('parent')
const addTargetId = ref<string>('')

function addRelation() {
  if (!addTargetId.value) return
  family.linkRelation(props.memberId, addTargetId.value, addKind.value)
  addTargetId.value = ''
}

function removeRelation(otherId: string, kind: RelationKind) {
  family.unlinkRelation(props.memberId, otherId, kind)
}

function fullName(m: Member) {
  return `${m.lastName}${m.firstName}`
}
</script>

<template>
  <div class="space-y-3 text-sm">
    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">父母</div>
      <div v-if="parentsList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in parentsList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'parent')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">配偶</div>
      <div v-if="spousesList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in spousesList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'spouse')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">子女</div>
      <div v-if="childrenList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in childrenList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'child')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">兄弟姐妹</div>
      <div v-if="siblingsList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in siblingsList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'sibling')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">干爹 / 干妈</div>
      <div v-if="godparentsList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in godparentsList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-indigo-200 bg-indigo-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'godparent')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-slate-500">干儿子 / 干女儿</div>
      <div v-if="godchildrenList.length === 0" class="text-xs text-slate-400">（无）</div>
      <ul class="space-y-1">
        <li
          v-for="m in godchildrenList"
          :key="m.id"
          class="flex items-center justify-between rounded border border-indigo-200 bg-indigo-50 px-2 py-1"
        >
          <span>{{ fullName(m) }}</span>
          <button
            class="text-xs text-rose-500 hover:underline"
            @click="removeRelation(m.id, 'godchild')"
          >
            移除
          </button>
        </li>
      </ul>
    </div>

    <!-- 添加关系 -->
    <div class="rounded-md border border-slate-200 bg-white p-2">
      <div class="mb-2 text-xs font-medium text-slate-500">添加关系</div>
      <div class="flex items-center gap-2">
        <select v-model="addKind" class="rounded border border-slate-300 px-2 py-1">
          <option value="parent">父母</option>
          <option value="spouse">配偶</option>
          <option value="child">子女</option>
          <option value="sibling">兄弟姐妹</option>
          <option value="godparent">干爹/干妈</option>
          <option value="godchild">干儿子/干女儿</option>
        </select>
        <select v-model="addTargetId" class="flex-1 rounded border border-slate-300 px-2 py-1">
          <option value="">选择成员…</option>
          <option v-for="m in candidates" :key="m.id" :value="m.id">
            {{ fullName(m) }}
          </option>
        </select>
        <button
          class="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="!addTargetId"
          @click="addRelation"
        >
          添加
        </button>
      </div>
    </div>
  </div>
</template>
