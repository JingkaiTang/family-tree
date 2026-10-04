import { routeAuxiliaryEdges } from './routeAuxiliaryEdges'
import { addCrossingBridges } from './routeFamilyLanes'
import type {
  AuxiliaryRelation,
  LayoutMetrics,
  LayoutScene,
  ParentageFact,
  ParentageGroup,
  RoutedFamilyEdge,
} from './types'
import { validateScene } from './validateScene'

/** Complete the final geometry, including safe fallback, without moving any cards. */
export function completePrimaryParentageRoutes(
  scene: LayoutScene,
  parentages: ParentageFact[],
  groups: ParentageGroup[],
  metrics: LayoutMetrics,
): LayoutScene {
  const parentageById = new Map(parentages.map(parentage => [parentage.id, parentage]))
  const unitById = new Map(scene.units.map(unit => [unit.id, unit]))
  const sourceParentsByGroupId = new Map(groups.map(group => {
    const represented = group.sourceAnchorPersonId === undefined
      ? unitById.get(group.sourceUnitId)?.memberIds ?? []
      : [group.sourceAnchorPersonId]
    return [group.id, represented.filter(id => parentageById.get(group.id)?.parentIds.includes(id))]
  }))
  const routes = scene.routes.map(route => {
    const sourceParentIds = sourceParentsByGroupId.get(route.routeOwnerId)
    return route.kind !== 'primary' || sourceParentIds === undefined
      ? route
      : { ...route, parentageId: route.routeOwnerId, sourceParentIds }
  })
  const missing = groups.flatMap(group => {
    const parentage = parentageById.get(group.id)
    const represented = sourceParentsByGroupId.get(group.id) ?? []
    return (parentage?.parentIds ?? []).filter(id => !represented.includes(id))
      .flatMap(parentId => group.childPersonIds.map(childId => ({
        id: `primary-parent:${JSON.stringify([group.id, parentId, childId])}`,
        kind: 'secondary-parentage' as const,
        sourceId: parentId,
        targetId: childId,
        parentageId: group.id,
      })))
  }).sort((left, right) => left.id.localeCompare(right.id))
  if (missing.length === 0) return { ...scene, routes }

  const relationById = new Map(missing.map(relation => [relation.id, relation]))
  const cardById = new Map(scene.cards.map(card => [card.id, card]))
  const supplemental = routeAuxiliaryEdges({
    geometry: scene,
    auxiliaryRelations: missing satisfies AuxiliaryRelation[],
    primaryRoutes: routes,
    metrics,
  }).map<RoutedFamilyEdge>(route => {
    const relation = relationById.get(route.routeOwnerId)!
    const sourceCard = cardById.get(relation.sourceId)
    return {
      ...route,
      kind: 'primary',
      parentageId: relation.parentageId,
      sourceParentIds: [relation.sourceId],
      sourcePersonId: relation.sourceId,
      accent: sourceCard === undefined ? route.accent : unitById.get(sourceCard.unitId)?.accent ?? route.accent,
      childPaths: [{ childPersonId: relation.targetId, segments: route.segments }],
      junctions: [],
    }
  })
  const withSupplements = (supplements: RoutedFamilyEdge[]): LayoutScene => {
    const bridged = new Map(addCrossingBridges([
      ...routes.filter(route => route.kind === 'primary'),
      ...supplements,
    ], metrics.routeSubgrid).map(route => [route.id, route]))
    return {
      ...scene,
      routes: [...routes, ...supplements].map(route => bridged.get(route.id) ?? route),
    }
  }
  const candidate = withSupplements(supplemental)
  const validation = validateScene(candidate, metrics)
  const invalidIds = new Set(validation.flatMap(diagnostic => diagnostic.ids))
  const safe = supplemental.filter(route => !invalidIds.has(route.routeOwnerId))
  const routedIds = new Set(safe.map(route => route.routeOwnerId))
  const result = safe.length === supplemental.length ? candidate : withSupplements(safe)
  return {
    ...result,
    diagnostics: [...scene.diagnostics, ...missing.filter(relation => !routedIds.has(relation.id))
      .map(relation => ({
        code: 'UNROUTABLE_PRIMARY_EDGE' as const,
        ids: [relation.id, relation.sourceId, relation.targetId],
        message: `Unable to route primary parent ${relation.sourceId} to child ${relation.targetId}`,
      }))],
  }
}
