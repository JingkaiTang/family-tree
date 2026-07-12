<script setup lang="ts">
import { computed } from 'vue'
import type { Point, RoutedFamilyEdge, RouteSegment } from '@/core/family-layout/types'

const props = defineProps<{
  routes: RoutedFamilyEdge[]
  width: number
  height: number
  fadedRouteIds?: string[]
}>()

const fadedRouteIdSet = computed(() => new Set(props.fadedRouteIds ?? []))

const routeOwnerGroups = computed(() => {
  const routesByOwnerId = new Map<string, RoutedFamilyEdge[]>()
  for (const route of props.routes) {
    const routes = routesByOwnerId.get(route.routeOwnerId) ?? []
    routes.push(route)
    routesByOwnerId.set(route.routeOwnerId, routes)
  }
  return [...routesByOwnerId]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([routeOwnerId, routes]) => ({
      routeOwnerId,
      routes: [...routes].sort((left, right) => left.id.localeCompare(right.id)),
    }))
})

function pathData(segment: RouteSegment): string {
  if (segment.points.length === 0) return ''
  return segment.orientation === 'bridge'
    ? curvedPath(segment.points)
    : straightPath(segment.points)
}

function straightPath(points: Point[]): string {
  return [`M ${pointValue(points[0])}`, ...points.slice(1).map(point => (
    `L ${pointValue(point)}`
  ))].join(' ')
}

function curvedPath(points: Point[]): string {
  const values = [`M ${pointValue(points[0])}`]
  let index = 1
  while (index + 1 < points.length) {
    values.push(`Q ${pointValue(points[index])} ${pointValue(points[index + 1])}`)
    index += 2
  }
  if (index < points.length) values.push(`L ${pointValue(points[index])}`)
  return values.join(' ')
}

function pointValue(point: Point): string {
  return `${point.x} ${point.y}`
}
</script>

<template>
  <svg
    data-testid="relation-layer"
    class="pointer-events-none absolute left-0 top-0 overflow-visible"
    :width="width"
    :height="height"
    aria-hidden="true"
  >
    <g
      v-for="group in routeOwnerGroups"
      :key="group.routeOwnerId"
      :data-route-owner="group.routeOwnerId"
    >
      <template v-for="route in group.routes" :key="route.id">
        <path
          v-for="(segment, index) in route.segments"
          :key="`${route.id}:${index}`"
          :data-route-id="route.id"
          :style="fadedRouteIdSet.has(route.id) ? { opacity: 0.25 } : undefined"
          :d="pathData(segment)"
          :stroke="route.accent"
          :stroke-dasharray="route.kind === 'primary' ? undefined : '8 6'"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </template>
    </g>
  </svg>
</template>
