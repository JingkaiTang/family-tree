import { assignGenerations } from './assignGenerations'
import { assignRootAccents } from './assignRootAccents'
import { buildFamilyUnits } from './buildFamilyUnits'
import { buildRootDomains } from './buildRootDomains'
import { buildSafeFallbackScene } from './buildSafeFallbackScene'
import { decorateRootedUnits } from './decorateRootedUnits'
import { discoverRootFamilies } from './discoverRootFamilies'
import { placeRootDomains } from './placeRootDomains'
import { projectView } from './projectView'
import { propagateRootSignatures } from './propagateRootSignatures'
import { routeAuxiliaryEdges } from './routeAuxiliaryEdges'
import { routeFamilyLanes } from './routeFamilyLanes'
import type {
  AuxiliaryRelation,
  LayoutDiagnostic,
  LayoutDomain,
  LayoutMetrics,
  LayoutRequest,
  ParentageGroup,
  RootedFamilyUnit,
  LayoutScene,
} from './types'
import { validateScene } from './validateScene'

const UNSAFE_CODES = new Set<LayoutDiagnostic['code']>([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
  'INVALID_ROOT_DOMAIN_ASSIGNMENT',
  'ROOT_DOMAIN_INTRUSION',
])

export function layoutFamilyScene(request: LayoutRequest): LayoutScene {
  const projected = projectView(request.facts, request.view)
  const built = buildFamilyUnits(projected, request.preferences, request.metrics)
  const generations = assignGenerations(projected, built)
  const baseUnits = built.units.map(unit => ({
    ...unit,
    generation: generations.generationByUnitId[unit.id] ?? 0,
  }))
  const discovery = discoverRootFamilies({
    projected,
    units: baseUnits,
    generationByUnitId: generations.generationByUnitId,
    previousScene: request.previousScene,
  })
  const signatures = propagateRootSignatures({
    projected,
    units: baseUnits,
    roots: discovery,
  })
  const accents = assignRootAccents({
    roots: discovery.roots,
    signatures,
    preferences: request.preferences,
    previousScene: request.previousScene,
    previousRootIdByRootId: discovery.previousRootIdByRootId,
  })
  const domainModel = buildRootDomains({
    projected,
    units: baseUnits,
    roots: discovery.roots,
    signatures,
    accents,
    preferences: request.preferences,
    previousScene: request.previousScene,
    previousRootIdByRootId: discovery.previousRootIdByRootId,
    preferredComponentPersonId: request.preferredComponentPersonId,
  })
  const units = decorateRootedUnits({
    baseUnits,
    roots: discovery.roots,
    signatures,
    domains: domainModel,
    accents,
    preferences: request.preferences,
  })
  const retainedDiagnostics = [
    ...request.inputDiagnostics,
    ...projected.diagnostics,
    ...generations.diagnostics,
    ...discovery.diagnostics,
    ...signatures.diagnostics,
    ...domainModel.diagnostics,
  ]
  const first = buildAttempt(
    units,
    domainModel.domains,
    built.parentageGroups,
    request.metrics,
    retainedDiagnostics,
    request,
    projected.auxiliaryRelations,
    discovery.previousRootIdByRootId,
  )

  if (!first.routingDiagnostics.some(value => (
    value.code === 'UNROUTABLE_PRIMARY_EDGE'
  ))) {
    return hasUnsafeDiagnostic(first.scene)
      ? buildSafeFallbackScene(
          units,
          domainModel.domains,
          built.parentageGroups,
          request.metrics,
          retainedDiagnostics,
        )
      : first.scene
  }

  const retryMetrics = withExpandedGenerationGap(
    request.metrics,
    built.parentageGroups.length,
  )
  const retry = buildAttempt(
    units,
    domainModel.domains,
    built.parentageGroups,
    retryMetrics,
    retainedDiagnostics,
    request,
    projected.auxiliaryRelations,
    discovery.previousRootIdByRootId,
  )
  return hasUnsafeDiagnostic(retry.scene)
    ? buildSafeFallbackScene(
        units,
        domainModel.domains,
        built.parentageGroups,
        request.metrics,
        retainedDiagnostics,
      )
    : retry.scene
}

interface LayoutAttempt {
  scene: LayoutScene
  routingDiagnostics: LayoutDiagnostic[]
}

function buildAttempt(
  units: RootedFamilyUnit[],
  domains: LayoutDomain[],
  parentageGroups: ParentageGroup[],
  metrics: LayoutMetrics,
  retainedDiagnostics: LayoutDiagnostic[],
  request: LayoutRequest,
  auxiliaryRelations: AuxiliaryRelation[],
  previousRootIdByRootId: Record<string, string>,
): LayoutAttempt {
  const geometry = placeRootDomains({
    units,
    parentageGroups,
    domains,
    preferences: request.preferences,
    metrics,
    previousScene: request.previousScene,
    previousRootIdByRootId,
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
    gateways: routing.gateways,
    routes: routing.routes,
    diagnostics: [...retainedDiagnostics, ...routing.diagnostics],
  }
  const focusId = request.auxiliaryFocusPersonId
  if (focusId !== undefined) {
    scene.routes.push(...routeAuxiliaryEdges({
      geometry,
      auxiliaryRelations: auxiliaryRelations.filter(relation => (
        relation.sourceId === focusId || relation.targetId === focusId
      )),
      primaryRoutes: routing.routes,
      metrics,
    }))
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

function compareDiagnostics(
  left: LayoutDiagnostic,
  right: LayoutDiagnostic,
): number {
  return left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
}
