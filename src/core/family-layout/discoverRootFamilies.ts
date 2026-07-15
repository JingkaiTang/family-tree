import type {
  FamilyUnit,
  ProjectedFamily,
  RootDiscoveryResult,
  RootFamily,
} from './types'

export interface DiscoverRootFamiliesInput {
  projected: ProjectedFamily
  units: FamilyUnit[]
  generationByUnitId: Record<string, number>
}

interface IncomingSpouseInput {
  personId: string
  partnerId: string
  parentIdsByChild: ReadonlyMap<string, string[]>
  childIdsByParent: ReadonlyMap<string, string[]>
  parentageByChild: ReadonlyMap<string, string>
}

export function discoverRootFamilies(
  input: DiscoverRootFamiliesInput,
): RootDiscoveryResult {
  const peopleIds = input.projected.people
    .map(person => person.id)
    .sort((left, right) => left.localeCompare(right))
  const {
    childIdsByParent,
    parentageByChild,
    parentIdsByChild,
  } = buildPrimaryParentageMaps(input.projected)
  const partnerIdByPersonId = buildCurrentPartnerMap(input.projected)
  const sourcePersonIds = peopleIds.filter(personId => (
    (parentIdsByChild.get(personId)?.length ?? 0) === 0
  ))
  const suppressedIncomingPersonIds = sourcePersonIds.filter(personId => {
    const partnerId = partnerIdByPersonId.get(personId)
    return partnerId !== undefined && isUnexpandedIncomingSpouse({
      personId,
      partnerId,
      parentIdsByChild,
      childIdsByParent,
      parentageByChild,
    })
  })
  const suppressedSet = new Set(suppressedIncomingPersonIds)
  const rootCandidateIds = sourcePersonIds.filter(personId => !suppressedSet.has(personId))
  const rootCandidateSet = new Set(rootCandidateIds)
  const componentIdByPersonId = buildComponentIds(
    peopleIds,
    input.projected,
    parentIdsByChild,
  )
  const unitIdByPersonId = new Map(input.units.flatMap(unit => (
    unit.memberIds.map(personId => [personId, unit.id] as const)
  )))
  const roots: RootFamily[] = []
  const seedRootIdByPersonId: Record<string, string> = {}
  const assignedSeeds = new Set<string>()

  for (const personId of rootCandidateIds) {
    if (assignedSeeds.has(personId)) continue
    const partnerId = partnerIdByPersonId.get(personId)
    const seedPersonIds = partnerId !== undefined
      && rootCandidateSet.has(partnerId)
      && !assignedSeeds.has(partnerId)
      ? [personId, partnerId].sort((left, right) => left.localeCompare(right))
      : [personId]
    const rootUnitId = unitIdByPersonId.get(seedPersonIds[0])
    if (rootUnitId === undefined) continue
    const rootId = `root:${seedPersonIds.join('+')}`
    const componentId = componentIdByPersonId.get(seedPersonIds[0])
      ?? `component:${seedPersonIds[0]}`
    roots.push({
      id: rootId,
      rootUnitId,
      seedPersonIds,
      generation: input.generationByUnitId[rootUnitId] ?? 0,
      componentId,
    })
    for (const seedPersonId of seedPersonIds) {
      assignedSeeds.add(seedPersonId)
      seedRootIdByPersonId[seedPersonId] = rootId
    }
  }

  roots.sort((left, right) => (
    left.componentId.localeCompare(right.componentId)
    || left.generation - right.generation
    || left.id.localeCompare(right.id)
  ))

  return {
    roots,
    seedRootIdByPersonId,
    suppressedIncomingPersonIds: suppressedIncomingPersonIds
      .sort((left, right) => left.localeCompare(right)),
    diagnostics: [],
  }
}

export function isUnexpandedIncomingSpouse(
  input: IncomingSpouseInput,
): boolean {
  if ((input.parentIdsByChild.get(input.partnerId)?.length ?? 0) === 0) return false
  return (input.childIdsByParent.get(input.personId) ?? []).every(childId => (
    input.parentageByChild.has(childId)
    && (input.parentIdsByChild.get(childId) ?? []).includes(input.partnerId)
  ))
}

function buildPrimaryParentageMaps(projected: ProjectedFamily): {
  parentIdsByChild: Map<string, string[]>
  childIdsByParent: Map<string, string[]>
  parentageByChild: Map<string, string>
} {
  const parentIdsByChild = new Map<string, string[]>()
  const childIdsByParent = new Map<string, string[]>()
  const parentageByChild = new Map<string, string>()

  for (const parentage of [...projected.primaryParentages]
    .sort((left, right) => left.id.localeCompare(right.id))) {
    for (const childId of parentage.childIds) {
      if (parentage.typeByChildId[childId] === 'step') continue
      const parentIds = [...new Set(parentage.parentIds)]
        .sort((left, right) => left.localeCompare(right))
      parentIdsByChild.set(childId, parentIds)
      parentageByChild.set(childId, parentage.id)
      for (const parentId of parentIds) {
        const childIds = childIdsByParent.get(parentId) ?? []
        if (!childIds.includes(childId)) childIds.push(childId)
        childIds.sort((left, right) => left.localeCompare(right))
        childIdsByParent.set(parentId, childIds)
      }
    }
  }

  return { parentIdsByChild, childIdsByParent, parentageByChild }
}

function buildCurrentPartnerMap(projected: ProjectedFamily): Map<string, string> {
  const partnerIdByPersonId = new Map<string, string>()
  for (const partnership of [...projected.primaryPartnerships]
    .filter(value => value.status === 'current')
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const [leftId, rightId] = partnership.partnerIds
    if (leftId === undefined || rightId === undefined) continue
    partnerIdByPersonId.set(leftId, rightId)
    partnerIdByPersonId.set(rightId, leftId)
  }
  return partnerIdByPersonId
}

function buildComponentIds(
  peopleIds: string[],
  projected: ProjectedFamily,
  parentIdsByChild: ReadonlyMap<string, string[]>,
): Map<string, string> {
  const adjacentIdsByPersonId = new Map(
    peopleIds.map(personId => [personId, new Set<string>()]),
  )
  const connect = (leftId: string, rightId: string) => {
    adjacentIdsByPersonId.get(leftId)?.add(rightId)
    adjacentIdsByPersonId.get(rightId)?.add(leftId)
  }

  for (const [childId, parentIds] of parentIdsByChild) {
    for (const parentId of parentIds) connect(parentId, childId)
  }
  for (const partnership of projected.primaryPartnerships) {
    const [leftId, rightId] = partnership.partnerIds
    if (leftId !== undefined && rightId !== undefined) connect(leftId, rightId)
  }

  const componentIdByPersonId = new Map<string, string>()
  const visited = new Set<string>()
  for (const personId of peopleIds) {
    if (visited.has(personId)) continue
    const componentPeople: string[] = []
    const pending = [personId]
    visited.add(personId)
    while (pending.length > 0) {
      const currentId = pending.pop()
      if (currentId === undefined) break
      componentPeople.push(currentId)
      const adjacentIds = [...(adjacentIdsByPersonId.get(currentId) ?? [])]
        .sort((left, right) => right.localeCompare(left))
      for (const adjacentId of adjacentIds) {
        if (visited.has(adjacentId)) continue
        visited.add(adjacentId)
        pending.push(adjacentId)
      }
    }
    componentPeople.sort((left, right) => left.localeCompare(right))
    const componentId = `component:${componentPeople[0]}`
    componentPeople.forEach(value => componentIdByPersonId.set(value, componentId))
  }
  return componentIdByPersonId
}
