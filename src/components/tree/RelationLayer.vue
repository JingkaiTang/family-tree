<script setup lang="ts">
import { computed } from 'vue'
import type { Point, RoutedFamilyEdge, RouteSegment } from '@/core/family-layout/types'

const props = defineProps<{
  routes: RoutedFamilyEdge[]
  width: number
  height: number
  fadedRouteIds?: string[]
  highlightedPaths?: Array<{ routeId: string; childPersonIds: string[] }>
  scale?: number
}>()

const fadedRouteIdSet = computed(() => new Set(props.fadedRouteIds ?? []))
// The canvas uses a CSS transform, so SVG non-scaling-stroke alone is insufficient.
const strokeCompensation = computed(() => {
  const scale = props.scale ?? 1
  return 1 / Math.min(2, Math.max(0.4, Number.isFinite(scale) && scale > 0 ? scale : 1))
})

const highlightedSegments = computed(() => {
  const requestedPaths = new Map(
    (props.highlightedPaths ?? []).map(path => [path.routeId, new Set(path.childPersonIds)]),
  )
  return props.routes.flatMap(route => {
    // Shared child-path trunks would accumulate opacity and cancel the drag fade.
    if (fadedRouteIdSet.value.has(route.id)) return []
    const children = requestedPaths.get(route.id)
    if (!children) return []
    // An owner can contain siblings: only route metadata identifies the exact branch.
    return (route.childPaths ?? [])
      .filter(path => children.has(path.childPersonId))
      .flatMap(path => path.segments.map((segment, index) => ({
        key: `${route.id}:${path.childPersonId}:${index}`,
        route,
        childPersonId: path.childPersonId,
        segment,
      })))
  })
})

function routeOpacity(routeId: string): number | undefined {
  if (fadedRouteIdSet.value.has(routeId)) return 0.25
  if (props.highlightedPaths !== undefined) return 0.18
  return undefined
}

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
        <template v-for="(segment, index) in route.segments" :key="`${route.id}:${index}`">
          <path
            v-if="segment.orientation === 'bridge'"
            data-testid="line-bridge-underlay"
            :style="{ opacity: routeOpacity(route.id) }"
            :d="pathData(segment)"
            stroke="#f1f5f9"
            :stroke-width="7 * strokeCompensation"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
          <path
            :data-route-id="route.id"
            :style="{ opacity: routeOpacity(route.id) }"
            :d="pathData(segment)"
            :stroke="route.accent"
            :stroke-dasharray="route.kind === 'primary' ? undefined : '8 6'"
            :stroke-width="2 * strokeCompensation"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </template>
        <circle
          v-for="(junction, index) in route.junctions ?? []"
          :key="`${route.id}:junction:${index}`"
          data-testid="line-junction"
          :cx="junction.x"
          :cy="junction.y"
          :r="2.5 * strokeCompensation"
          :fill="route.accent"
          :style="{ opacity: routeOpacity(route.id) }"
        />
      </template>
    </g>
    <g v-if="highlightedPaths !== undefined" data-testid="lineage-route-overlay">
      <template v-for="value in highlightedSegments" :key="value.key">
        <path
          v-if="value.segment.orientation === 'bridge'"
          data-testid="lineage-bridge-underlay"
          :d="pathData(value.segment)"
          stroke="#f1f5f9"
          :stroke-width="8 * strokeCompensation"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <path
          data-testid="lineage-route"
          :data-route-id="value.route.id"
          :data-child-person-id="value.childPersonId"
          :d="pathData(value.segment)"
          :stroke="value.route.accent"
          :stroke-dasharray="value.route.kind === 'primary' ? undefined : '8 6'"
          :stroke-width="3 * strokeCompensation"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </template>
    </g>
  </svg>
</template>
