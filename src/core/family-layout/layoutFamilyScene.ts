import { assignGenerations } from './assignGenerations'
import { buildFamilyUnits } from './buildFamilyUnits'
import { buildSafeFallbackScene } from './buildSafeFallbackScene'
import { clusterLineages } from './clusterLineages'
import { compactGrid } from './compactGrid'
import { orderUnits } from './orderUnits'
import { projectView } from './projectView'
import { routeFamilyLanes } from './routeFamilyLanes'
import type {
  FamilyUnit,
  LayoutDiagnostic,
  LayoutMetrics,
  LayoutRequest,
  LayoutScene,
  OrderedGeneration,
  ParentageGroup,
} from './types'
import { validateScene } from './validateScene'

const UNSAFE_CODES = new Set<LayoutDiagnostic['code']>([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
])

export function layoutFamilyScene(request: LayoutRequest): LayoutScene {
  const projected = projectView(request.facts, request.view)
  const built = buildFamilyUnits(projected, request.preferences, request.metrics)
  const generations = assignGenerations(projected, built)
  const units = built.units.map(unit => ({
    ...unit,
    generation: generations.generationByUnitId[unit.id] ?? 0,
  }))
  const clusters = clusterLineages(projected, units, built.parentageGroups)
  const rows = orderUnits({
    units,
    people: projected.people,
    parentageGroups: built.parentageGroups,
    primaryParentages: projected.primaryParentages,
    clusters,
    preferences: request.preferences,
    previousScene: request.previousScene,
    changedIds: request.changedIds,
  })
  const retainedDiagnostics = [
    ...request.inputDiagnostics,
    ...projected.diagnostics,
    ...generations.diagnostics,
  ]
  const first = buildAttempt(
    units,
    rows,
    built.parentageGroups,
    request.metrics,
    retainedDiagnostics,
    request,
  )

  if (!first.routingDiagnostics.some(value => (
    value.code === 'UNROUTABLE_PRIMARY_EDGE'
  ))) {
    return hasUnsafeDiagnostic(first.scene)
      ? buildSafeFallbackScene(
          units,
          built.parentageGroups,
          request.metrics,
          first.scene.diagnostics,
        )
      : first.scene
  }

  const retryMetrics = withExpandedGenerationGap(
    request.metrics,
    built.parentageGroups.length,
  )
  const retry = buildAttempt(
    units,
    rows,
    built.parentageGroups,
    retryMetrics,
    retainedDiagnostics,
    request,
  )
  return hasUnsafeDiagnostic(retry.scene)
    ? buildSafeFallbackScene(
        units,
        built.parentageGroups,
        request.metrics,
        retry.scene.diagnostics,
      )
    : retry.scene
}

interface LayoutAttempt {
  scene: LayoutScene
  routingDiagnostics: LayoutDiagnostic[]
}

function buildAttempt(
  units: FamilyUnit[],
  rows: OrderedGeneration[],
  parentageGroups: ParentageGroup[],
  metrics: LayoutMetrics,
  retainedDiagnostics: LayoutDiagnostic[],
  request: LayoutRequest,
): LayoutAttempt {
  const geometry = compactGrid({
    units,
    rows,
    parentageGroups,
    metrics,
    previousScene: request.previousScene,
    changedIds: request.changedIds,
  })
  const routing = routeFamilyLanes({
    geometry,
    units,
    parentageGroups,
    metrics,
  })
  const scene: LayoutScene = {
    ...geometry,
    routes: routing.routes,
    diagnostics: [...retainedDiagnostics, ...routing.diagnostics],
  }
  scene.diagnostics.push(...validateScene(scene, metrics))
  scene.diagnostics.sort(compareDiagnostics)
  return { scene, routingDiagnostics: routing.diagnostics }
}

function withExpandedGenerationGap(
  metrics: LayoutMetrics,
  parentageGroupCount: number,
): LayoutMetrics {
  const expandedGap = metrics.generationGap
    + metrics.routeSubgrid * (parentageGroupCount + 2)
  return {
    ...metrics,
    generationGap: Math.ceil(expandedGap / metrics.gridSize) * metrics.gridSize,
  }
}

function hasUnsafeDiagnostic(scene: LayoutScene): boolean {
  return scene.diagnostics.some(value => UNSAFE_CODES.has(value.code))
}

function compareDiagnostics(left: LayoutDiagnostic, right: LayoutDiagnostic): number {
  return left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
}
