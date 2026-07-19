<script setup lang="ts">
import { computed } from 'vue'
import { useFamilyStore } from '@/stores/family'
import { siblingOrderGroupsForMember, type SiblingOrderGroup } from '@/core/siblingOrder'
import type { Member } from '@/core/schema'

const props = defineProps<{ memberId: string }>()
const family = useFamilyStore()

const groups = computed(() => siblingOrderGroupsForMember(family.data, props.memberId))

function groupMembers(group: SiblingOrderGroup): Member[] {
  return group.memberIds
    .map(id => family.getMember(id))
    .filter((member): member is Member => member !== undefined)
}

function parentLabel(group: SiblingOrderGroup): string {
  return group.parentIds
    .map(id => family.getMember(id))
    .filter((member): member is Member => member !== undefined)
    .map(fullName)
    .join(' + ')
}

function move(group: SiblingOrderGroup, index: number, offset: -1 | 1) {
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= group.memberIds.length) return
  const next = [...group.memberIds]
  ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
  family.setSiblingOrder(group.id, next)
}

function reset(groupId: string) {
  family.setSiblingOrder(groupId, null)
}

function fullName(member: Member): string {
  return `${member.lastName}${member.firstName}`
}
</script>

<template>
  <section class="mt-6 border-t border-slate-200 pt-5" data-testid="sibling-order-editor">
    <h3 class="font-semibold">兄弟姐妹排序</h3>
    <p class="mt-1 text-xs leading-5 text-slate-500">
      同一父母组共用一份顺序；从任意兄弟姐妹的详情中调整都会同步。
    </p>

    <p v-if="groups.length === 0" class="mt-3 text-xs text-slate-400">
      暂无可排序的同父母兄弟姐妹。
    </p>

    <div
      v-for="group in groups"
      :key="group.id"
      class="mt-3 rounded-md border border-slate-200 bg-white p-3"
      :data-testid="`sibling-order-group-${group.id}`"
    >
      <div class="mb-2 flex items-start justify-between gap-2">
        <div>
          <div class="text-xs font-medium text-slate-600">父母组</div>
          <div class="text-xs text-slate-500">{{ parentLabel(group) }}</div>
        </div>
        <button
          v-if="family.data.siblingOrders[group.id]"
          type="button"
          class="shrink-0 text-xs text-slate-500 hover:text-slate-900 hover:underline"
          @click="reset(group.id)"
        >
          恢复默认
        </button>
      </div>

      <ol class="space-y-1.5">
        <li
          v-for="(sibling, index) in groupMembers(group)"
          :key="sibling.id"
          class="flex items-center gap-2 rounded border px-2 py-1.5"
          :class="sibling.id === memberId
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-slate-200 bg-slate-50'"
          :data-testid="`sibling-order-item-${sibling.id}`"
        >
          <span class="w-5 shrink-0 text-center text-xs font-medium text-slate-400">
            {{ index + 1 }}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm">{{ fullName(sibling) }}</span>
          <span v-if="sibling.birthDate" class="shrink-0 text-[11px] text-slate-400">
            {{ sibling.birthDate }}
          </span>
          <div class="flex shrink-0 gap-1">
            <button
              type="button"
              :aria-label="`上移${fullName(sibling)}`"
              :disabled="index === 0"
              class="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30"
              @click="move(group, index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              :aria-label="`下移${fullName(sibling)}`"
              :disabled="index === group.memberIds.length - 1"
              class="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30"
              @click="move(group, index, 1)"
            >
              ↓
            </button>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>
