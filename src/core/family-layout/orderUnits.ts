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

  for (const row of rows) {
    row.unitIds = applySiblingBlocks(
      row.unitIds,
      input.parentageGroups,
      input.clusters,
      unitIdByPersonId,
    )
    row.unitIds = applyBridgeBands(row.unitIds, input.clusters)
    row.unitIds = improveConstraintOrder(
      row.unitIds,
      constraintsByGeneration.get(row.generation) ?? [],
    )
  }

  const context: OrderingContext = {
    input,
    unitIdByPersonId,
    constraintsByGeneration,
    affinityLinks: buildAffinityLinks(input, unitIdByPersonId),
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
  affinityLinks: AffinityLink[]
  previousPositionByUnitId: Map<string, number>
}

interface OrderConstraint { beforeId: string; afterId: string }
interface AffinityLink { leftId: string; rightId: string; weight: number }
interface Row { generation: number; unitIds: string[] }

function sweep(rows: Row[], direction: 'down' | 'up', context: OrderingContext) {
  const orderedRows = direction === 'down' ? rows : [...rows].reverse()
  for (const row of orderedRows) {
    const blocks = buildBlocks(
      row.unitIds,
      context.input.parentageGroups,
      context.input.clusters,
      context.unitIdByPersonId,
    )
    const positions = positionsByUnitId(rows)
    const candidateBlocks = [...blocks].sort((left, right) => {
      const leftCenter = barycenter(left, direction, context.input.parentageGroups, context.unitIdByPersonId, positions)
      const rightCenter = barycenter(right, direction, context.input.parentageGroups, context.unitIdByPersonId, positions)
      if (leftCenter !== rightCenter) return leftCenter - rightCenter
      return blockId(left).localeCompare(blockId(right))
    })
    acceptCandidate(rows, row, candidateBlocks.flat(), context)

    let improved = true
    while (improved) {
      improved = false
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
      if (compareScores(bestScore, currentScore) < 0) {
        row.unitIds = bestIds
        improved = true
      }
    }
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

  const edges = parentageEdges(context.input.parentageGroups, context.unitIdByPersonId)
  let crossings = 0
  for (let left = 0; left < edges.length; left++) {
    for (let right = left + 1; right < edges.length; right++) {
      const first = edges[left]
      const second = edges[right]
      if (first.sourceId === second.sourceId || first.childId === second.childId) continue
      const firstSource = positions.get(first.sourceId)
      const secondSource = positions.get(second.sourceId)
      const firstChild = positions.get(first.childId)
      const secondChild = positions.get(second.childId)
      if (
        firstSource !== undefined
        && secondSource !== undefined
        && firstChild !== undefined
        && secondChild !== undefined
        && (firstSource - secondSource) * (firstChild - secondChild) < 0
      ) crossings++
    }
  }

  let lineageDistance = 0
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
  for (const edge of edges) {
    const source = positions.get(edge.sourceId)
    const child = positions.get(edge.childId)
    if (source !== undefined && child !== undefined) totalSpan += Math.abs(source - child)
  }
  return [savedViolations, crossings, lineageDistance, previousMovement, totalSpan]
}

function buildAffinityLinks(
  input: OrderUnitsInput,
  unitIdByPersonId: Map<string, string>,
): AffinityLink[] {
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

  for (const cluster of input.clusters) {
    const affiliatedUnitIds = input.units
      .filter(unit => (
        cluster.unitIds.includes(unit.id)
        || unit.memberIds.some(personId => cluster.personIds.includes(personId))
      ))
      .map(unit => unit.id)
      .sort()
    for (let left = 0; left < affiliatedUnitIds.length; left++) {
      for (let right = left + 1; right < affiliatedUnitIds.length; right++) {
        add(affiliatedUnitIds[left], affiliatedUnitIds[right], 1)
      }
    }
  }
  for (const parentage of input.primaryParentages) {
    for (const childId of parentage.childIds) {
      const weight = parentage.typeByChildId[childId] === 'blood' ? 1 : 0.5
      for (const parentId of parentage.parentIds) {
        add(unitIdByPersonId.get(parentId), unitIdByPersonId.get(childId), weight)
      }
    }
  }
  return [...weights.values()].sort((left, right) => (
    left.leftId.localeCompare(right.leftId) || left.rightId.localeCompare(right.rightId)
  ))
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
  const disjointSet = new UnitDisjointSet(unitIds)
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
  parentageGroups: ParentageGroup[],
  unitIdByPersonId: Map<string, string>,
  positions: Map<string, number>,
): number {
  const neighbors: number[] = []
  for (const edge of parentageEdges(parentageGroups, unitIdByPersonId)) {
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
) {
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
  const disjointSet = new UnitDisjointSet(units.map(unit => unit.id))
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

class UnitDisjointSet {
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
