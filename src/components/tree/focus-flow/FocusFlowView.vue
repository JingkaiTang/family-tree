<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { FamilyData } from '@/core/schema'
import { layoutFocusFlow } from '@/core/focus-flow/layoutFocusFlow'
import FocusFlowMemberCard from './FocusFlowMemberCard.vue'

const props = defineProps<{
  data: FamilyData
  focusId?: string | null
  selectedId?: string | null
  viewpointId?: string | null
  getKinship?: (fromId: string, toId: string) => string | null
  expandedBranchIds?: string[]
  initialScrollTop?: number
  showAuxiliaryRelations?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'open', id: string): void
  (event: 'focus-change', id: string): void
  (event: 'branch-toggle', id: string): void
  (event: 'scroll-change', value: number): void
}>()

const scroller = ref<HTMLElement | null>(null)
const scene = computed(() => layoutFocusFlow(props.data, {
  focusId: props.focusId,
  expandedBranchIds: props.expandedBranchIds,
  showAuxiliaryRelations: props.showAuxiliaryRelations,
}))

function kinshipFor(memberId: string): string | null {
  if (!props.viewpointId || !props.getKinship || props.viewpointId === memberId) return null
  return props.getKinship(props.viewpointId, memberId)
}

function onScroll(event: Event) {
  emit('scroll-change', (event.currentTarget as HTMLElement).scrollTop)
}

onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = props.initialScrollTop ?? 0
})

watch(
  () => props.focusId,
  async (next, previous) => {
    if (previous === undefined || next === previous) return
    await nextTick()
    scroller.value?.scrollTo({ top: 0 })
    emit('scroll-change', 0)
  },
)
</script>

<template>
  <div
    ref="scroller"
    data-testid="focus-flow-view"
    class="h-full overflow-y-auto overflow-x-hidden bg-slate-100 overscroll-contain"
    @scroll.passive="onScroll"
  >
    <div v-if="scene.focusId" class="mx-auto w-full max-w-2xl px-3 py-4 sm:px-5">
      <div
        v-if="scene.diagnostics.length > 0"
        class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        有 {{ scene.diagnostics.length }} 条关系引用异常，纵流布局已忽略失效引用。
      </div>

      <template v-for="(section, sectionIndex) in scene.sections" :key="section.id">
        <div
          v-if="sectionIndex > 0"
          aria-hidden="true"
          class="mx-auto h-7 w-px bg-slate-300"
        />
        <section
          :data-testid="`focus-flow-section-${section.kind}`"
          class="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm"
        >
          <h3 class="mb-3 text-sm font-semibold text-slate-700">{{ section.title }}</h3>
          <div class="space-y-3">
            <div
              v-for="familyBlock in section.blocks"
              :key="familyBlock.id"
              data-testid="focus-family-block"
              :data-block-kind="familyBlock.kind"
              class="rounded-xl border border-slate-200 bg-slate-50 p-2"
            >
              <p v-if="familyBlock.label" class="mb-2 px-1 text-xs text-slate-500">
                {{ familyBlock.label }}
              </p>
              <div
                class="grid gap-2"
                :class="familyBlock.memberIds.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'"
              >
                <FocusFlowMemberCard
                  v-for="memberId in familyBlock.memberIds"
                  :key="memberId"
                  :member="data.members[memberId]"
                  :selected="selectedId === memberId"
                  :is-focus="scene.focusId === memberId"
                  :kinship="kinshipFor(memberId)"
                  @select="emit('select', $event)"
                  @open="emit('open', $event)"
                  @focus="emit('focus-change', $event)"
                />
              </div>
            </div>
          </div>
          <button
            v-if="section.branch"
            :data-testid="`focus-flow-toggle-${section.branch.id}`"
            class="mt-3 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 active:bg-slate-100"
            @click="emit('branch-toggle', section.branch.id)"
          >
            {{ section.branch.expanded
              ? '收起'
              : `显示全部 ${section.branch.totalCount} 个家庭` }}
          </button>
        </section>
      </template>

      <section
        v-if="scene.branches.length > 0"
        data-testid="focus-flow-branches"
        class="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <h3 class="mb-2 text-sm font-semibold text-slate-700">延伸关系</h3>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="branch in scene.branches"
            :key="branch.id"
            :data-testid="`focus-flow-toggle-${branch.id}`"
            class="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-3 text-left text-sm active:bg-slate-50"
            :disabled="branch.lockedOpen"
            @click="emit('branch-toggle', branch.id)"
          >
            <span>{{ branch.label }}</span>
            <span class="text-xs text-slate-500">
              {{ branch.lockedOpen ? '已显示' : branch.expanded ? '收起' : `${branch.count} 人` }}
            </span>
          </button>
        </div>
      </section>
    </div>

    <div v-else class="flex min-h-full items-center justify-center px-6 text-center text-slate-400">
      暂无成员 — 点击上方“新建成员”开始
    </div>
  </div>
</template>
