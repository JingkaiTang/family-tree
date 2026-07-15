<script setup lang="ts">
import { computed } from 'vue'
import type {
  PlacedPersonCard,
  PlacedRootedFamilyUnit,
  PlacedUnionHub,
  Point,
} from '@/core/family-layout/types'
import type { Member } from '@/core/schema'
import MemberNode from './MemberNode.vue'

const props = defineProps<{
  unit: PlacedRootedFamilyUnit
  cards: PlacedPersonCard[]
  members: Member[]
  hubs: PlacedUnionHub[]
  selectedId?: string | null
  viewpointId?: string | null
  dragOffset?: Point
  previewOffset?: Point
  isDragging?: boolean
  animatePosition?: boolean
  kinshipByMemberId?: Record<string, string>
  rootAccentById?: Record<string, string>
  rootOrder?: string[]
}>()

export interface FamilyUnitDragPayload {
  unitId: string
  memberIds: string[]
  dx: number
  dy: number
}

const emit = defineEmits<{
  (event: 'unit-drag', payload: FamilyUnitDragPayload): void
  (event: 'unit-drop', payload: FamilyUnitDragPayload): void
  (event: 'unit-cancel', payload: FamilyUnitDragPayload): void
  (event: 'select', id: string): void
  (event: 'open', id: string): void
}>()

const renderedCards = computed(() => {
  const memberById = new Map(props.members.map(member => [member.id, member]))
  return props.cards
    .filter(card => card.unitId === props.unit.id && memberById.has(card.id))
    .map(card => ({ card, member: memberById.get(card.id)! }))
})

const localHubs = computed(() => props.hubs
  .filter(hub => hub.unitId === props.unit.id)
  .map(hub => ({
    ...hub,
    point: {
      x: hub.point.x - props.unit.rect.x,
      y: hub.point.y - props.unit.rect.y,
    },
  })))

const spouseAxis = computed(() => {
  if (props.unit.kind !== 'couple' || renderedCards.value.length !== 2) return null
  const cards = renderedCards.value
    .map(value => value.card)
    .sort((left, right) => left.rect.x - right.rect.x)
  const hub = localHubs.value[0]
  if (!hub) return null
  const left = cards[0].rect.x + cards[0].rect.width - props.unit.rect.x
  const right = cards[1].rect.x - props.unit.rect.x
  const rootAccents = spouseRootAccents.value
  return {
    left,
    top: hub.point.y,
    width: Math.max(0, right - left),
    rootAccents,
    background: segmentedBackground(rootAccents),
  }
})

const orderedRootIds = computed(() => {
  const orderByRootId = new Map(
    (props.rootOrder ?? []).map((rootId, index) => [rootId, index]),
  )
  return [...new Set(props.unit.rootSignature)].sort((left, right) => (
    (orderByRootId.get(left) ?? Number.POSITIVE_INFINITY)
    - (orderByRootId.get(right) ?? Number.POSITIVE_INFINITY)
    || left.localeCompare(right)
  ))
})

const spouseRootAccents = computed(() => {
  const cardRootIds = [...renderedCards.value]
    .sort((left, right) => left.card.rect.x - right.card.rect.x)
    .flatMap(value => {
      const rootId = props.unit.memberRootIds[value.card.id]
      return rootId === undefined ? [] : [rootId]
    })
  const rootIds = [...new Set([...cardRootIds, ...orderedRootIds.value])]
  const accents = rootIds.map(rootId => (
    props.rootAccentById?.[rootId] ?? props.unit.rootAccent
  ))
  if (accents.length === 0) return [props.unit.rootAccent || props.unit.accent]
  return accents.length <= 4
    ? accents
    : [...accents.slice(0, 3), props.unit.accent]
})

function rootAccentForMember(memberId: string): string {
  const rootId = props.unit.memberRootIds[memberId]
  return rootId === undefined
    ? props.unit.rootAccent
    : props.rootAccentById?.[rootId] ?? props.unit.rootAccent
}

function segmentedBackground(accents: string[]): string {
  if (accents.length <= 1) return accents[0] ?? props.unit.accent
  const segmentSize = 100 / accents.length
  return `linear-gradient(to right, ${accents.flatMap((accent, index) => [
    `${accent} ${index * segmentSize}%`,
    `${accent} ${(index + 1) * segmentSize}%`,
  ]).join(', ')})`
}

const unitStyle = computed(() => ({
  width: `${props.unit.rect.width}px`,
  height: `${props.unit.rect.height}px`,
  transform: `translate(${props.unit.rect.x + (props.dragOffset?.x ?? props.previewOffset?.x ?? 0)}px, ${props.unit.rect.y + (props.dragOffset?.y ?? props.previewOffset?.y ?? 0)}px)`,
  transition: props.animatePosition ? 'transform 180ms ease' : undefined,
  backgroundColor: `color-mix(in srgb, ${props.unit.accent} 6%, transparent)`,
  borderColor: `color-mix(in srgb, ${props.unit.isRootFamily ? props.unit.rootAccent : props.unit.accent} ${props.unit.isRootFamily ? 48 : 25}%, transparent)`,
  borderWidth: props.unit.isRootFamily ? '2px' : undefined,
  boxShadow: props.unit.isRootFamily
    ? `0 8px 22px color-mix(in srgb, ${props.unit.rootAccent} 18%, transparent)`
    : undefined,
}))

function unitPayload(payload: { dx: number; dy: number }): FamilyUnitDragPayload {
  return {
    unitId: props.unit.id,
    memberIds: [...props.unit.memberIds],
    dx: payload.dx,
    dy: payload.dy,
  }
}

let activeDrag = false

function onMemberDrag(payload: { dx: number; dy: number }) {
  activeDrag = true
  emit('unit-drag', unitPayload(payload))
}

function onMemberDrop(payload: { dx: number; dy: number }) {
  if (!activeDrag) return
  activeDrag = false
  const value = unitPayload(payload)
  if (payload.dx === 0 && payload.dy === 0) emit('unit-cancel', value)
  else emit('unit-drop', value)
}
</script>

<template>
  <div
    data-testid="family-unit"
    :data-root-family="unit.isRootFamily ? 'true' : undefined"
    :data-root-signature="unit.rootSignature.join(',')"
    class="absolute left-0 top-0 rounded-2xl border motion-reduce:!transition-none"
    :class="isDragging ? 'z-30 shadow-xl' : ''"
    :style="unitStyle"
  >
    <div
      v-if="unit.isRootFamily"
      data-testid="root-accent-rail"
      class="pointer-events-none absolute inset-y-3 left-0 z-20 w-1.5 rounded-r-full"
      :style="{ backgroundColor: unit.rootAccent }"
    />

    <div
      v-if="spouseAxis"
      data-testid="spouse-axis"
      :data-root-accents="spouseAxis.rootAccents.join(',')"
      class="pointer-events-none absolute z-10 h-0.5 -translate-y-1/2"
      :style="{
        left: `${spouseAxis.left}px`,
        top: `${spouseAxis.top}px`,
        width: `${spouseAxis.width}px`,
        background: spouseAxis.background,
      }"
    />

    <div
      v-for="hub in localHubs"
      :key="hub.id"
      data-testid="union-hub"
      class="pointer-events-none absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
      :style="{
        left: `${hub.point.x}px`,
        top: `${hub.point.y}px`,
        background: spouseAxis?.background ?? unit.accent,
      }"
    />

    <MemberNode
      v-for="value in renderedCards"
      :key="value.card.id"
      :member="value.member"
      :left="value.card.rect.x - unit.rect.x"
      :top="value.card.rect.y - unit.rect.y"
      :width="value.card.rect.width"
      :height="value.card.rect.height"
      :selected="selectedId === value.card.id"
      :is-viewpoint="viewpointId === value.card.id"
      :kinship="kinshipByMemberId?.[value.card.id]"
      :root-accent="rootAccentForMember(value.card.id)"
      :show-root-rail="true"
      class="z-10"
      @click="emit('select', value.card.id)"
      @dblclick="emit('open', value.card.id)"
      @drag="onMemberDrag"
      @drop="onMemberDrop"
    />
  </div>
</template>
