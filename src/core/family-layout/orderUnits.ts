import type {
  FamilyUnit,
  LayoutPreferences,
  LayoutScene,
  LineageCluster,
  OrderedGeneration,
  ParentageFact,
  ParentageGroup,
  PersonFact,
} from './types'

export interface OrderUnitsInput {
  units: FamilyUnit[]
  people: PersonFact[]
  parentageGroups: ParentageGroup[]
  primaryParentages: ParentageFact[]
  clusters: LineageCluster[]
  preferences: LayoutPreferences
  previousScene?: LayoutScene
  changedIds?: string[]
}

export function orderUnits(input: OrderUnitsInput): OrderedGeneration[] {
  const unitById = new Map(input.units.map(unit => [unit.id, unit]))
  const unitIdByPersonId = new Map<string, string>()
  input.units.forEach(unit => unit.memberIds.forEach(personId => (
    unitIdByPersonId.set(personId, unit.id)
  )))
  const birthDateByPersonId = new Map(
    input.people.map(person => [person.id, person.member.birthDate]),
  )
  const unitsByGeneration = new Map<number, FamilyUnit[]>()
  for (const unit of input.units) {
    const generationUnits = unitsByGeneration.get(unit.generation) ?? []
    generationUnits.push(unit)
    unitsByGeneration.set(unit.generation, generationUnits)
  }

  const rows = [...unitsByGeneration.entries()]
    .sort(([left], [right]) => left - right)
    .map(([generation, units]) => ({
      generation,
      unitIds: [...units]
        .sort((left, right) => compareBirthDate(left, right, birthDateByPersonId))
        .map(unit => unit.id),
    }))
  const constraintsByGeneration = buildOrderConstraints(
    rows,
    input,
    unitIdByPersonId,
  )
  const lineageAffinity = buildLineageAffinity(input, unitIdByPersonId)
  const edges = parentageEdges(input.parentageGroups, unitIdByPersonId)

  for (const row of rows) {
    row.unitIds = applySiblingBlocks(
      row.unitIds,
      input.parentageGroups,
      input.clusters,
      unitIdByPersonId,
    )
    row.unitIds = applyBridgeBands(row.unitIds, input.clusters)
    if (
      input.previousScene !== undefined
      && input.changedIds === undefined
      && !hasRowStructure(row.unitIds, edges, lineageAffinity)
    ) {
      row.unitIds = restorePreviousOrder(
        row.unitIds,
        row.generation,
        input.previousScene,
      )
    }
    row.unitIds = improveConstraintOrder(
      row.unitIds,
      constraintsByGeneration.get(row.generation) ?? [],
    )
  }

  const context: OrderingContext = {
    input,
    unitIdByPersonId,
    constraintsByGeneration,
    edges,
    bloodCoreUnitIds: lineageAffinity.bloodCoreUnitIds,
    affinityLinks: lineageAffinity.relationLinks,
    previousPositionByUnitId: buildPreviousPositions(input.previousScene),
  }
  for (let pass = 0; pass < 3; pass++) {
    sweep(rows, 'down', context)
  }
  for (let pass = 0; pass < 3; pass++) {
    sweep(rows, 'up', context)
  }

  return rows.map(row => ({
    generation: row.generation,
    unitIds: [...row.unitIds],
  }))
}

interface OrderingContext {
  input: OrderUnitsInput
  unitIdByPersonId: Map<string, string>
  constraintsByGeneration: Map<number, OrderConstraint[]>
  edges: ParentageEdge[]
  bloodCoreUnitIds: string[][]
  affinityLinks: AffinityLink[]
  previousPositionByUnitId: Map<string, number>
}

interface OrderConstraint { beforeId: string; afterId: string }
interface AffinityLink { leftId: string; rightId: string; weight: number }
interface ParentageEdge { sourceId: string; childId: string }
interface Row { generation: number; unitIds: string[] }
interface RowPosition { generation: number; index: number }
interface LineageAffinity {
  bloodCoreUnitIds: string[][]
  relationLinks: AffinityLink[]
}

function hasRowStructure(
  unitIds: string[],
  edges: ParentageEdge[],
  lineageAffinity: LineageAffinity,
): boolean {
  const rowUnitIds = new Set(unitIds)
  return edges.some(edge => (
    rowUnitIds.has(edge.sourceId) || rowUnitIds.has(edge.childId)
  )) || hasInternalAffinity(
    unitIds,
    lineageAffinity.bloodCoreUnitIds,
    lineageAffinity.relationLinks,
  )
}

function restorePreviousOrder(
  unitIds: string[],
  generation: number,
  scene: LayoutScene,
): string[] {
  const currentUnitIds = new Set(unitIds)
  const previousRow = scene.rows
    .filter(row => row.generation === generation)
    .map(row => ({
      row,
      overlap: row.unitIds.filter(unitId => currentUnitIds.has(unitId)).length,
    }))
    .filter(value => value.overlap > 0)
    .sort((left, right) => (
      right.overlap - left.overlap || left.row.id.localeCompare(right.row.id)
    ))[0]?.row
  if (previousRow === undefined) return unitIds

  const previousPositions = new Map(
    previousRow.unitIds.map((unitId, index) => [unitId, index]),
  )
  const restoredIds = unitIds
    .filter(unitId => previousPositions.has(unitId))
    .sort((left, right) => (
      (previousPositions.get(left) ?? 0) - (previousPositions.get(right) ?? 0)
      || left.localeCompare(right)
    ))
  const newIds = unitIds.filter(unitId => !previousPositions.has(unitId))
  return [...restoredIds, ...newIds]
}

function sweep(rows: Row[], direction: 'down' | 'up', context: OrderingContext) {
  const orderedRows = direction === 'down' ? rows : [...rows].reverse()
  for (const row of orderedRows) {
    const hasNeighbors = hasDirectionalNeighbors(row.unitIds, direction, context.edges)
    if (!hasNeighbors && !hasInternalAffinity(
      row.unitIds,
      context.bloodCoreUnitIds,
      context.affinityLinks,
    )) continue
    const blocks = buildBlocks(
      row.unitIds,
      context.input.parentageGroups,
      context.input.clusters,
      context.unitIdByPersonId,
    )
    if (hasNeighbors) {
      const positions = positionsByUnitId(rows)
      const candidateBlocks = [...blocks].sort((left, right) => {
        const leftCenter = barycenter(left, direction, context.edges, positions)
        const rightCenter = barycenter(right, direction, context.edges, positions)
        if (leftCenter !== rightCenter) return leftCenter - rightCenter
        return blockId(left).localeCompare(blockId(right))
      })
      acceptCandidate(rows, row, candidateBlocks.flat(), context)
    }

    const currentBlocks = buildBlocks(
      row.unitIds,
      context.input.parentageGroups,
      context.input.clusters,
      context.unitIdByPersonId,
    )
    const currentScore = scoreRows(rows, context)
    let bestIds = row.unitIds
    let bestScore = currentScore
    for (let index = 0; index < currentBlocks.length - 1; index++) {
      const swapped = [...currentBlocks]
      ;[swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]]
      const candidateIds = swapped.flat()
      const previousIds = row.unitIds
      row.unitIds = candidateIds
      const candidateScore = scoreRows(rows, context)
      row.unitIds = previousIds
      const comparison = compareScores(candidateScore, bestScore)
      if (
        comparison < 0
        || (comparison === 0 && candidateIds.join('\0') < bestIds.join('\0'))
      ) {
        bestIds = candidateIds
        bestScore = candidateScore
      }
    }
    if (compareScores(bestScore, currentScore) < 0) row.unitIds = bestIds
  }
}

function acceptCandidate(
  rows: Row[],
  row: Row,
  candidateIds: string[],
  context: OrderingContext,
): boolean {
  if (candidateIds.join('\0') === row.unitIds.join('\0')) return false
  const currentScore = scoreRows(rows, context)
  const previousIds = row.unitIds
  row.unitIds = candidateIds
  const candidateScore = scoreRows(rows, context)
  const comparison = compareScores(candidateScore, currentScore)
  if (comparison < 0) {
    return true
  }
  row.unitIds = previousIds
  return false
}

function scoreRows(rows: Row[], context: OrderingContext): number[] {
  const positions = positionsByUnitId(rows)
  let savedViolations = 0
  for (const constraints of context.constraintsByGeneration.values()) {
    for (const constraint of constraints) {
      const before = positions.get(constraint.beforeId)
      const after = positions.get(constraint.afterId)
      if (before !== undefined && after !== undefined && before > after) savedViolations++
    }
  }

  const crossings = countCrossings(context.edges, rows)

  let lineageDistance = 0
  for (const bloodCoreUnitIds of context.bloodCoreUnitIds) {
    const corePositions = bloodCoreUnitIds
      .map(unitId => positions.get(unitId))
      .filter((position): position is number => position !== undefined)
      .sort((left, right) => left - right)
    let prefixSum = 0
    corePositions.forEach((position, index) => {
      lineageDistance += position * index - prefixSum
      prefixSum += position
    })
  }
  for (const link of context.affinityLinks) {
    const left = positions.get(link.leftId)
    const right = positions.get(link.rightId)
    if (left !== undefined && right !== undefined) {
      lineageDistance += Math.abs(left - right) * link.weight
    }
  }
  let previousMovement = 0
  for (const [unitId, previousPosition] of context.previousPositionByUnitId) {
    const position = positions.get(unitId)
    if (position !== undefined) previousMovement += Math.abs(position - previousPosition)
  }
  let totalSpan = 0
  for (const edge of context.edges) {
    const source = positions.get(edge.sourceId)
    const child = positions.get(edge.childId)
    if (source !== undefined && child !== undefined) totalSpan += Math.abs(source - child)
  }
  return [savedViolations, crossings, lineageDistance, previousMovement, totalSpan]
}

function countCrossings(edges: ParentageEdge[], rows: Row[]): number {
  const rowPositionByUnitId = new Map<string, RowPosition>()
  for (const row of rows) {
    row.unitIds.forEach((unitId, index) => {
      rowPositionByUnitId.set(unitId, { generation: row.generation, index })
    })
  }
  const edgesByRowPair = new Map<string, Array<{
    sourceIndex: number
    childIndex: number
    sourceId: string
    childId: string
  }>>()
  for (const edge of edges) {
    const source = rowPositionByUnitId.get(edge.sourceId)
    const child = rowPositionByUnitId.get(edge.childId)
    if (source === undefined || child === undefined) continue
    const key = `${source.generation}\0${child.generation}`
    const rowEdges = edgesByRowPair.get(key) ?? []
    rowEdges.push({
      sourceIndex: source.index,
      childIndex: child.index,
      sourceId: edge.sourceId,
      childId: edge.childId,
    })
    edgesByRowPair.set(key, rowEdges)
  }

  let crossings = 0
  for (const rowEdges of edgesByRowPair.values()) {
    rowEdges.sort((left, right) => (
      left.sourceIndex - right.sourceIndex
      || left.childIndex - right.childIndex
      || left.sourceId.localeCompare(right.sourceId)
      || left.childId.localeCompare(right.childId)
    ))
    const childIndexes = [...new Set(rowEdges.map(edge => edge.childIndex))]
      .sort((left, right) => left - right)
    const rankByChildIndex = new Map(
      childIndexes.map((childIndex, rank) => [childIndex, rank]),
    )
    const fenwick = new FenwickTree(childIndexes.length)
    let insertedEdges = 0
    let start = 0
    while (start < rowEdges.length) {
      let end = start + 1
      while (
        end < rowEdges.length
        && rowEdges[end].sourceIndex === rowEdges[start].sourceIndex
      ) end++
      for (let index = start; index < end; index++) {
        const childRank = rankByChildIndex.get(rowEdges[index].childIndex) ?? 0
        crossings += insertedEdges - fenwick.prefixSum(childRank)
      }
      for (let index = start; index < end; index++) {
        const childRank = rankByChildIndex.get(rowEdges[index].childIndex) ?? 0
        fenwick.add(childRank, 1)
        insertedEdges++
      }
      start = end
    }
  }
  return crossings
}

function hasDirectionalNeighbors(
  unitIds: string[],
  direction: 'down' | 'up',
  edges: ParentageEdge[],
): boolean {
  const rowUnitIds = new Set(unitIds)
  return edges.some(edge => rowUnitIds.has(
    direction === 'down' ? edge.childId : edge.sourceId,
  ))
}

function hasInternalAffinity(
  unitIds: string[],
  bloodCoreUnitIds: string[][],
  links: AffinityLink[],
): boolean {
  const rowUnitIds = new Set(unitIds)
  return bloodCoreUnitIds.some(coreUnitIds => {
    const affiliatedCount = coreUnitIds.filter(unitId => rowUnitIds.has(unitId)).length
    return affiliatedCount > 1 && affiliatedCount < unitIds.length
  }) || links.some(link => (
    rowUnitIds.has(link.leftId) && rowUnitIds.has(link.rightId)
  ))
}

class FenwickTree {
  private readonly values: number[]

  constructor(size: number) {
    this.values = Array.from({ length: size + 1 }, () => 0)
  }

  add(index: number, value: number) {
    for (let cursor = index + 1; cursor < this.values.length; cursor += cursor & -cursor) {
      this.values[cursor] += value
    }
  }

  prefixSum(index: number): number {
    let result = 0
    for (let cursor = index + 1; cursor > 0; cursor -= cursor & -cursor) {
      result += this.values[cursor]
    }
    return result
  }
}

function buildLineageAffinity(
  input: OrderUnitsInput,
  unitIdByPersonId: Map<string, string>,
): LineageAffinity {
  const weights = new Map<string, AffinityLink>()
  const add = (leftId: string | undefined, rightId: string | undefined, weight: number) => {
    if (leftId === undefined || rightId === undefined || leftId === rightId) return
    const [firstId, secondId] = [leftId, rightId].sort()
    const key = `${firstId}\0${secondId}`
    const existing = weights.get(key)
    weights.set(key, {
      leftId: firstId,
      rightId: secondId,
      weight: Math.max(existing?.weight ?? 0, weight),
    })
  }

  const bloodCores = new StableDisjointSet(input.people.map(person => person.id))
  for (const parentage of input.primaryParentages) {
    for (const childId of parentage.childIds) {
      if (parentage.typeByChildId[childId] !== 'blood') continue
      for (const parentId of parentage.parentIds) bloodCores.union(parentId, childId)
    }
  }
  const unitIdsByBloodCore = new Map<string, string[]>()
  const bloodCoreIdsByUnitId = new Map<string, Set<string>>()
  for (const unit of input.units) {
    const bloodCoreIds = [...new Set(unit.memberIds.map(personId => bloodCores.find(personId)))]
    bloodCoreIdsByUnitId.set(unit.id, new Set(bloodCoreIds))
    for (const bloodCoreId of bloodCoreIds) {
      const affiliatedUnitIds = unitIdsByBloodCore.get(bloodCoreId) ?? []
      affiliatedUnitIds.push(unit.id)
      unitIdsByBloodCore.set(bloodCoreId, affiliatedUnitIds)
    }
  }
  for (const parentage of input.primaryParentages) {
    for (const childId of parentage.childIds) {
      if (parentage.typeByChildId[childId] === 'blood') continue
      for (const parentId of parentage.parentIds) {
        const parentUnitId = unitIdByPersonId.get(parentId)
        const childUnitId = unitIdByPersonId.get(childId)
        const parentCoreIds = parentUnitId === undefined
          ? undefined
          : bloodCoreIdsByUnitId.get(parentUnitId)
        const childCoreIds = childUnitId === undefined
          ? undefined
          : bloodCoreIdsByUnitId.get(childUnitId)
        const sharesBloodCore = parentCoreIds !== undefined && childCoreIds !== undefined
          && [...parentCoreIds].some(coreId => childCoreIds.has(coreId))
        if (!sharesBloodCore) add(parentUnitId, childUnitId, 0.5)
      }
    }
  }
  return {
    bloodCoreUnitIds: [...unitIdsByBloodCore.values()]
      .map(unitIds => [...unitIds].sort())
      .filter(unitIds => unitIds.length > 1)
      .sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? '')),
    relationLinks: [...weights.values()].sort((left, right) => (
      left.leftId.localeCompare(right.leftId) || left.rightId.localeCompare(right.rightId)
    )),
  }
}

function buildOrderConstraints(
  rows: Row[],
  input: OrderUnitsInput,
  unitIdByPersonId: Map<string, string>,
): Map<number, OrderConstraint[]> {
  const constraints = new Map<number, OrderConstraint[]>()
  for (const row of rows) {
    const rowIds = new Set(row.unitIds)
    const saved = [...input.preferences.rowOrders]
      .map(preference => ({
        preference,
        overlap: preference.unitIds.filter(unitId => rowIds.has(unitId)).length,
      }))
      .filter(value => value.overlap > 0)
      .sort((left, right) => (
        right.overlap - left.overlap || left.preference.id.localeCompare(right.preference.id)
      ))[0]?.preference
    if (saved !== undefined) {
      addSequenceConstraints(
        constraints,
        row.generation,
        saved.unitIds.filter(unitId => rowIds.has(unitId)),
      )
    }
  }

  if (input.previousScene === undefined || input.changedIds === undefined) return constraints
  const affectedPersonIds = new Set(input.changedIds)
  for (const parentage of input.primaryParentages) {
    if (
      affectedPersonIds.has(parentage.id)
      || parentage.parentIds.some(id => affectedPersonIds.has(id))
      || parentage.childIds.some(id => affectedPersonIds.has(id))
    ) {
      parentage.parentIds.forEach(id => affectedPersonIds.add(id))
      parentage.childIds.forEach(id => affectedPersonIds.add(id))
    }
  }
  const components = unitComponents(input.units, input.parentageGroups, unitIdByPersonId)
  const frozenUnitIds = new Set(
    components
      .filter(component => component.every(unitId => (
        input.units
          .find(unit => unit.id === unitId)
          ?.memberIds.every(personId => !affectedPersonIds.has(personId)) ?? true
      )))
      .flat(),
  )
  for (const previousRow of input.previousScene.rows) {
    addSequenceConstraints(
      constraints,
      previousRow.generation,
      previousRow.unitIds.filter(unitId => frozenUnitIds.has(unitId)),
    )
  }
  return constraints
}

function addSequenceConstraints(
  constraints: Map<number, OrderConstraint[]>,
  generation: number,
  unitIds: string[],
) {
  const rowConstraints = constraints.get(generation) ?? []
  for (let left = 0; left < unitIds.length; left++) {
    for (let right = left + 1; right < unitIds.length; right++) {
      rowConstraints.push({ beforeId: unitIds[left], afterId: unitIds[right] })
    }
  }
  constraints.set(generation, rowConstraints)
}

function applySiblingBlocks(
  unitIds: string[],
  parentageGroups: ParentageGroup[],
  clusters: LineageCluster[],
  unitIdByPersonId: Map<string, string>,
): string[] {
  let orderedIds = [...unitIds]
  const bridgeUnitIds = new Set(
    clusters.filter(cluster => cluster.kind === 'bridge').flatMap(cluster => cluster.unitIds),
  )
  for (const group of parentageGroups) {
    const siblingIds = [...new Set(group.childPersonIds
      .map(personId => unitIdByPersonId.get(personId))
      .filter((unitId): unitId is string => (
        unitId !== undefined && orderedIds.includes(unitId) && !bridgeUnitIds.has(unitId)
      )))]
    if (siblingIds.length < 2) continue
    orderedIds = contiguate(orderedIds, siblingIds)
  }
  return orderedIds
}

function applyBridgeBands(
  unitIds: string[],
  clusters: LineageCluster[],
): string[] {
  let orderedIds = [...unitIds]
  const coreClusters = clusters.filter(cluster => cluster.kind === 'core')
  for (const bridge of clusters.filter(cluster => cluster.kind === 'bridge')) {
    const bandIds = bridge.unitIds.filter(unitId => orderedIds.includes(unitId)).sort()
    if (bandIds.length === 0) continue
    const relatedCores = coreClusters
      .filter(core => bridge.personIds.some(personId => core.personIds.includes(personId)))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (relatedCores.length < 2) continue
    const leftIds = relatedCores[0].unitIds.filter(unitId => orderedIds.includes(unitId))
    const rightIds = relatedCores[1].unitIds.filter(unitId => orderedIds.includes(unitId))
    const participantIds = [...leftIds, ...bandIds, ...rightIds]
    if (participantIds.length === bandIds.length) continue
    const firstIndex = Math.min(...participantIds.map(unitId => orderedIds.indexOf(unitId)))
    const participants = new Set(participantIds)
    orderedIds = orderedIds.filter(unitId => !participants.has(unitId))
    orderedIds.splice(firstIndex, 0, ...leftIds, ...bandIds, ...rightIds)
  }
  return orderedIds
}

function buildBlocks(
  unitIds: string[],
  parentageGroups: ParentageGroup[],
  clusters: LineageCluster[],
  unitIdByPersonId: Map<string, string>,
): string[][] {
  const disjointSet = new StableDisjointSet(unitIds)
  const bridgeUnitIds = new Set(
    clusters.filter(cluster => cluster.kind === 'bridge').flatMap(cluster => cluster.unitIds),
  )
  for (const group of parentageGroups) {
    const childUnitIds = [...new Set(group.childPersonIds
      .map(personId => unitIdByPersonId.get(personId))
      .filter((unitId): unitId is string => (
        unitId !== undefined && unitIds.includes(unitId) && !bridgeUnitIds.has(unitId)
      )))]
    childUnitIds.slice(1).forEach(unitId => disjointSet.union(childUnitIds[0], unitId))
  }
  for (const cluster of clusters.filter(cluster => cluster.kind === 'bridge')) {
    const bandUnitIds = cluster.unitIds.filter(unitId => unitIds.includes(unitId))
    bandUnitIds.slice(1).forEach(unitId => disjointSet.union(bandUnitIds[0], unitId))
  }
  const blocksByRoot = new Map<string, string[]>()
  for (const unitId of unitIds) {
    const rootId = disjointSet.find(unitId)
    const block = blocksByRoot.get(rootId) ?? []
    block.push(unitId)
    blocksByRoot.set(rootId, block)
  }
  return [...blocksByRoot.values()]
}

function improveConstraintOrder(unitIds: string[], constraints: OrderConstraint[]): string[] {
  const result = [...unitIds]
  let improved = true
  while (improved) {
    improved = false
    const currentViolations = constraintViolations(result, constraints)
    for (let index = 0; index < result.length - 1; index++) {
      const candidate = [...result]
      ;[candidate[index], candidate[index + 1]] = [candidate[index + 1], candidate[index]]
      if (constraintViolations(candidate, constraints) < currentViolations) {
        result.splice(0, result.length, ...candidate)
        improved = true
        break
      }
    }
  }
  return result
}

function constraintViolations(unitIds: string[], constraints: OrderConstraint[]): number {
  const positions = new Map(unitIds.map((unitId, index) => [unitId, index]))
  return constraints.filter(constraint => (
    (positions.get(constraint.beforeId) ?? -1) > (positions.get(constraint.afterId) ?? -1)
  )).length
}

function barycenter(
  block: string[],
  direction: 'down' | 'up',
  edges: ParentageEdge[],
  positions: Map<string, number>,
): number {
  const neighbors: number[] = []
  for (const edge of edges) {
    if (direction === 'down' && block.includes(edge.childId)) {
      const position = positions.get(edge.sourceId)
      if (position !== undefined) neighbors.push(position)
    }
    if (direction === 'up' && block.includes(edge.sourceId)) {
      const position = positions.get(edge.childId)
      if (position !== undefined) neighbors.push(position)
    }
  }
  if (neighbors.length === 0) {
    const ownPositions = block
      .map(unitId => positions.get(unitId))
      .filter((position): position is number => position !== undefined)
    return average(ownPositions)
  }
  return average(neighbors)
}

function parentageEdges(
  parentageGroups: ParentageGroup[],
  unitIdByPersonId: Map<string, string>,
): ParentageEdge[] {
  return parentageGroups.flatMap(group => group.childPersonIds.flatMap(childPersonId => {
    const childId = unitIdByPersonId.get(childPersonId)
    return childId === undefined || childId === group.sourceUnitId
      ? []
      : [{ sourceId: group.sourceUnitId, childId }]
  }))
}

function unitComponents(
  units: FamilyUnit[],
  parentageGroups: ParentageGroup[],
  unitIdByPersonId: Map<string, string>,
): string[][] {
  const disjointSet = new StableDisjointSet(units.map(unit => unit.id))
  for (const edge of parentageEdges(parentageGroups, unitIdByPersonId)) {
    disjointSet.union(edge.sourceId, edge.childId)
  }
  const components = new Map<string, string[]>()
  for (const unit of units) {
    const rootId = disjointSet.find(unit.id)
    const component = components.get(rootId) ?? []
    component.push(unit.id)
    components.set(rootId, component)
  }
  return [...components.values()]
}

class StableDisjointSet {
  private readonly parentById = new Map<string, string>()

  constructor(unitIds: string[]) {
    unitIds.forEach(unitId => this.parentById.set(unitId, unitId))
  }

  find(unitId: string): string {
    const parentId = this.parentById.get(unitId) ?? unitId
    if (parentId === unitId) return unitId
    const rootId = this.find(parentId)
    this.parentById.set(unitId, rootId)
    return rootId
  }

  union(leftId: string | undefined, rightId: string | undefined) {
    if (leftId === undefined || rightId === undefined) return
    const leftRoot = this.find(leftId)
    const rightRoot = this.find(rightId)
    if (leftRoot === rightRoot) return
    const [rootId, childId] = [leftRoot, rightRoot].sort()
    this.parentById.set(childId, rootId)
  }
}

function positionsByUnitId(rows: Row[]): Map<string, number> {
  return new Map(rows.flatMap(row => row.unitIds.map((unitId, index) => [unitId, index])))
}

function buildPreviousPositions(scene?: LayoutScene): Map<string, number> {
  return new Map(scene?.rows.flatMap(row => (
    row.unitIds.map((unitId, index) => [unitId, index] as const)
  )) ?? [])
}

function contiguate(unitIds: string[], groupedIds: string[]): string[] {
  const group = new Set(groupedIds)
  const firstIndex = Math.min(...groupedIds.map(unitId => unitIds.indexOf(unitId)))
  const orderedGroup = unitIds.filter(unitId => group.has(unitId))
  const result = unitIds.filter(unitId => !group.has(unitId))
  result.splice(firstIndex, 0, ...orderedGroup)
  return result
}

function compareBirthDate(
  left: FamilyUnit,
  right: FamilyUnit,
  birthDateByPersonId: Map<string, string | undefined>,
): number {
  const leftDate = firstBirthDate(left, birthDateByPersonId)
  const rightDate = firstBirthDate(right, birthDateByPersonId)
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  return left.id.localeCompare(right.id)
}

function firstBirthDate(
  unit: FamilyUnit,
  birthDateByPersonId: Map<string, string | undefined>,
): string {
  return unit.memberIds
    .map(personId => birthDateByPersonId.get(personId))
    .filter((birthDate): birthDate is string => birthDate !== undefined)
    .sort()[0] ?? '\uffff'
}

function compareScores(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function average(values: number[]): number {
  return values.length === 0
    ? Number.POSITIVE_INFINITY
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

function blockId(block: string[]): string {
  return [...block].sort()[0] ?? ''
}
