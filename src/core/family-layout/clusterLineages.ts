import type {
  FamilyUnit,
  LineageCluster,
  ParentageGroup,
  ProjectedFamily,
} from './types'

export function clusterLineages(
  projected: ProjectedFamily,
  units: FamilyUnit[],
  _parentageGroups: ParentageGroup[],
): LineageCluster[] {
  const personIds = [...new Set([
    ...projected.people.map(person => person.id),
    ...units.flatMap(unit => unit.memberIds),
  ])].sort(compareIds)
  const disjointSet = new DisjointSet(personIds)

  for (const parentage of projected.primaryParentages) {
    for (const childId of parentage.childIds) {
      if (parentage.typeByChildId[childId] !== 'blood') continue
      for (const parentId of parentage.parentIds) {
        disjointSet.union(parentId, childId)
      }
    }
  }

  const peopleByCoreId = new Map<string, string[]>()
  for (const personId of personIds) {
    const rootId = disjointSet.find(personId)
    const coreId = `core:${rootId}`
    const corePeople = peopleByCoreId.get(coreId) ?? []
    corePeople.push(personId)
    peopleByCoreId.set(coreId, corePeople)
  }
  const coreIdByPersonId = new Map<string, string>()
  for (const [coreId, corePeople] of peopleByCoreId) {
    corePeople.forEach(personId => coreIdByPersonId.set(personId, coreId))
  }

  const unitByPartnershipId = new Map(
    units
      .filter(unit => unit.kind === 'couple')
      .map(unit => [unit.id.slice('unit:'.length), unit]),
  )
  const bridgeEdges: BridgeEdge[] = []
  const bridgeUnitIds = new Set<string>()
  for (const partnership of [...projected.primaryPartnerships].sort(
    (left, right) => compareIds(left.id, right.id),
  )) {
    const unit = unitByPartnershipId.get(partnership.id)
    if (unit === undefined) continue
    const coreIds = [...new Set(
      partnership.partnerIds
        .map(personId => coreIdByPersonId.get(personId))
        .filter((coreId): coreId is string => coreId !== undefined),
    )].sort(compareIds)
    if (coreIds.length < 2) continue
    bridgeEdges.push({ coreIds, unit })
    bridgeUnitIds.add(unit.id)
  }

  const unitIdsByCoreId = new Map<string, string[]>()
  for (const unit of [...units].sort((left, right) => compareIds(left.id, right.id))) {
    if (bridgeUnitIds.has(unit.id)) continue
    const coreIds = [...new Set(
      unit.memberIds
        .map(personId => coreIdByPersonId.get(personId))
        .filter((coreId): coreId is string => coreId !== undefined),
    )]
    if (coreIds.length !== 1) continue
    const coreUnits = unitIdsByCoreId.get(coreIds[0]) ?? []
    coreUnits.push(unit.id)
    unitIdsByCoreId.set(coreIds[0], coreUnits)
  }

  const edgesByPairId = new Map<string, BridgeEdge[]>()
  for (const edge of bridgeEdges) {
    const pairId = edge.coreIds.join('|')
    const pairEdges = edgesByPairId.get(pairId) ?? []
    pairEdges.push(edge)
    edgesByPairId.set(pairId, pairEdges)
  }
  const graph = new Map<string, Set<string>>()
  for (const edge of bridgeEdges) {
    for (const leftCoreId of edge.coreIds) {
      const adjacent = graph.get(leftCoreId) ?? new Set<string>()
      for (const rightCoreId of edge.coreIds) {
        if (leftCoreId !== rightCoreId) adjacent.add(rightCoreId)
      }
      graph.set(leftCoreId, adjacent)
    }
  }

  const superCoreIds = new Set<string>()
  const clusters: LineageCluster[] = []
  for (const componentCoreIds of connectedComponents(graph)) {
    const coreIdSet = new Set(componentCoreIds)
    const componentPairs = [...edgesByPairId.entries()].filter(([, edges]) => (
      edges.some(edge => edge.coreIds.every(coreId => coreIdSet.has(coreId)))
    ))
    const hasSimpleCycle = componentPairs.length >= componentCoreIds.length
    const hasDensePair = componentPairs.some(([, edges]) => edges.length >= 3)
    if (!hasSimpleCycle && !hasDensePair) continue

    componentCoreIds.forEach(coreId => superCoreIds.add(coreId))
    const componentEdges = bridgeEdges.filter(edge => (
      edge.coreIds.every(coreId => coreIdSet.has(coreId))
    ))
    clusters.push({
      id: `supercomponent:${componentCoreIds.join('+')}`,
      kind: 'supercomponent',
      unitIds: [...new Set([
        ...componentCoreIds.flatMap(coreId => unitIdsByCoreId.get(coreId) ?? []),
        ...componentEdges.map(edge => edge.unit.id),
      ])].sort(compareIds),
      personIds: [...new Set(
        componentCoreIds.flatMap(coreId => peopleByCoreId.get(coreId) ?? []),
      )].sort(compareIds),
    })
  }

  for (const [coreId, corePeople] of peopleByCoreId) {
    if (superCoreIds.has(coreId)) continue
    clusters.push({
      id: coreId,
      kind: 'core',
      unitIds: [...(unitIdsByCoreId.get(coreId) ?? [])].sort(compareIds),
      personIds: [...corePeople].sort(compareIds),
    })
  }
  for (const [pairId, edges] of edgesByPairId) {
    if (edges.some(edge => edge.coreIds.some(coreId => superCoreIds.has(coreId)))) continue
    clusters.push({
      id: `bridge:${pairId}`,
      kind: 'bridge',
      unitIds: edges.map(edge => edge.unit.id).sort(compareIds),
      personIds: [...new Set(edges.flatMap(edge => edge.unit.memberIds))].sort(compareIds),
    })
  }

  return clusters.sort((left, right) => compareIds(left.id, right.id))
}

interface BridgeEdge {
  coreIds: string[]
  unit: FamilyUnit
}

function connectedComponents(graph: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>()
  const components: string[][] = []
  for (const startId of [...graph.keys()].sort(compareIds)) {
    if (visited.has(startId)) continue
    const component: string[] = []
    const pending = [startId]
    visited.add(startId)
    while (pending.length > 0) {
      const coreId = pending.shift()
      if (coreId === undefined) break
      component.push(coreId)
      for (const adjacentId of [...(graph.get(coreId) ?? [])].sort(compareIds)) {
        if (visited.has(adjacentId)) continue
        visited.add(adjacentId)
        pending.push(adjacentId)
      }
    }
    components.push(component.sort(compareIds))
  }
  return components
}

class DisjointSet {
  private readonly parentById = new Map<string, string>()

  constructor(ids: string[]) {
    ids.forEach(id => this.parentById.set(id, id))
  }

  find(id: string): string {
    if (!this.parentById.has(id)) this.parentById.set(id, id)
    const parentId = this.parentById.get(id) ?? id
    if (parentId === id) return id
    const rootId = this.find(parentId)
    this.parentById.set(id, rootId)
    return rootId
  }

  union(leftId: string, rightId: string) {
    const leftRoot = this.find(leftId)
    const rightRoot = this.find(rightId)
    if (leftRoot === rightRoot) return
    const [rootId, childId] = [leftRoot, rightRoot].sort(compareIds)
    this.parentById.set(childId, rootId)
  }
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right)
}
