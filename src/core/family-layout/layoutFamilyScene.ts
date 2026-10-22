import { assignGenerations } from './assignGenerations'
import { assignRootAccents } from './assignRootAccents'
import { buildFamilyUnits } from './buildFamilyUnits'
import { buildRootDomains } from './buildRootDomains'
import { buildSafeFallbackScene } from './buildSafeFallbackScene'
import { completePrimaryParentageRoutes } from './completePrimaryParentageRoutes'
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
  const built = buildFamilyUnits(
    projected,
    request.preferences,
    request.metrics,
    request.siblingOrders,
  )
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
    siblingOrders: request.siblingOrders,
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
    discovery.previousRootIdByRootId,
  )

  if (!first.routingDiagnostics.some(value => (
    value.code === 'UNROUTABLE_PRIMARY_EDGE'
  ))) {
    const scene = hasUnsafeDiagnostic(first.scene)
      ? buildSafeFallbackScene(
          units,
          domainModel.domains,
          built.parentageGroups,
          request.metrics,
          retainedDiagnostics,
        )
      : first.scene
    return withPrimaryParentageGroups(
      completeAuxiliaryRoutes(
        completePrimaryParentageRoutes(scene, projected.primaryParentages, built.parentageGroups, request.metrics),
        projected.auxiliaryRelations,
        request.auxiliaryFocusPersonId,
        request.metrics,
      ),
      built.parentageGroups,
    )
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
    discovery.previousRootIdByRootId,
  )
  const needsFallback = hasUnsafeDiagnostic(retry.scene)
  const scene = needsFallback
    ? buildSafeFallbackScene(
        units,
        domainModel.domains,
        built.parentageGroups,
        request.metrics,
        retainedDiagnostics,
      )
    : retry.scene
  const finalMetrics = needsFallback ? request.metrics : retryMetrics
  return withPrimaryParentageGroups(
    completeAuxiliaryRoutes(
      completePrimaryParentageRoutes(scene, projected.primaryParentages, built.parentageGroups, finalMetrics),
      projected.auxiliaryRelations,
      request.auxiliaryFocusPersonId,
      finalMetrics,
    ),
    built.parentageGroups,
  )
}

function withPrimaryParentageGroups(
  scene: LayoutScene,
  groups: ParentageGroup[],
): LayoutScene {
  return {
    ...scene,
    primaryParentageGroups: groups.map(group => ({
      ...group,
      childPersonIds: [...group.childPersonIds],
    })),
  }
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
  scene.diagnostics.push(...validateScene(scene, metrics))
  scene.diagnostics.sort(compareDiagnostics)
  return { scene, routingDiagnostics: routing.diagnostics }
}

/** Auxiliary visibility must not change primary geometry, including safe fallback. */
function completeAuxiliaryRoutes(
  scene: LayoutScene,
  auxiliaryRelations: AuxiliaryRelation[],
  focusId: string | undefined,
  metrics: LayoutMetrics,
): LayoutScene {
  if (focusId === undefined) return scene
  const focusedRelations = auxiliaryRelations.filter(relation => (
    relation.sourceId === focusId || relation.targetId === focusId
  ))
  if (focusedRelations.length === 0) return scene

  const auxiliaryRoutes = routeAuxiliaryEdges({
    geometry: scene,
    auxiliaryRelations: focusedRelations,
    primaryRoutes: scene.routes,
    metrics,
  })
  // Validate all candidates together once; only new auxiliary owners may be removed.
  const invalidOwnerIds = new Set(auxiliaryRoutes.length === 0 ? [] : validateScene({
    ...scene,
    routes: [...scene.routes, ...auxiliaryRoutes],
  }, metrics).flatMap(diagnostic => diagnostic.ids))
  const safeRoutes = auxiliaryRoutes.filter(route => !invalidOwnerIds.has(route.routeOwnerId))
  const routedOwnerIds = new Set(safeRoutes.map(route => route.routeOwnerId))
  const diagnostics: LayoutDiagnostic[] = [
    ...scene.diagnostics,
    ...focusedRelations.filter(relation => !routedOwnerIds.has(relation.id)).map(relation => ({
      code: 'UNROUTABLE_AUXILIARY_EDGE' as const,
      ids: [relation.id, relation.sourceId, relation.targetId],
      message: '部分辅助连线暂时无法显示：当前卡片间没有找到安全通道。',
    })),
  ]
  return {
    ...scene,
    routes: [...scene.routes, ...safeRoutes],
    diagnostics: diagnostics.sort(compareDiagnostics),
  }
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
