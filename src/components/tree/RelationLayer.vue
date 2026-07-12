<script setup lang="ts">
import type { Point, RoutedFamilyEdge, RouteSegment } from '@/core/family-layout/types'

defineProps<{
  routes: RoutedFamilyEdge[]
  width: number
  height: number
}>()

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
      v-for="route in routes"
      :key="route.id"
      :data-route-owner="route.routeOwnerId"
    >
      <path
        v-for="(segment, index) in route.segments"
        :key="`${route.id}:${index}`"
        :d="pathData(segment)"
        :stroke="route.accent"
        :stroke-dasharray="route.kind === 'primary' ? undefined : '6 4'"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </g>
  </svg>
</template>
