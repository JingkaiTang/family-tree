import type { Member } from '@/core/schema'

export interface FamilyPersonNode {
  id: string
  member: Member
}

export interface FamilyUnionNode {
  id: string
  partnerIds: string[]
  childIds: string[]
}

export interface FamilyComponent {
  id: string
  personIds: string[]
  unionIds: string[]
}

export interface FamilyGraphModel {
  people: FamilyPersonNode[]
  unions: FamilyUnionNode[]
  components: FamilyComponent[]
}

export function buildFamilyGraphModel(members: Member[]): FamilyGraphModel {
  const sortedMembers = [...members].sort((a, b) => compareIds(a.id, b.id))
  const memberById = new Map(sortedMembers.map((member) => [member.id, member]))
  const people = sortedMembers.map((member) => ({ id: member.id, member }))
  const unionsById = new Map<string, FamilyUnionNode>()

  for (const child of sortedMembers) {
    const parentIds = knownUniqueIds(
      child.parents.map((parent) => parent.id),
      memberById,
    ).sort(compareIds)

    if (parentIds.length === 0) continue

    const unionId = `parents:${parentIds.join('+')}`
    const union = unionsById.get(unionId) ?? {
      id: unionId,
      partnerIds: parentIds,
      childIds: [],
    }

    union.childIds.push(child.id)
    unionsById.set(unionId, union)
  }

  for (const union of unionsById.values()) {
    union.childIds = [...new Set(union.childIds)].sort((a, b) =>
      compareMemberIdsByBirthDateThenId(a, b, memberById),
    )
  }

  const parentPartnerIdSets = [...unionsById.values()].map(
    (union) => new Set(union.partnerIds),
  )

  for (const person of sortedMembers) {
    for (const spouse of person.spouses) {
      if (!memberById.has(spouse.id) || spouse.id === person.id) continue

      const partnerIds = [person.id, spouse.id].sort(compareIds)
      const partnerKey = partnerIds.join('+')
      if (
        parentPartnerIdSets.some((parentIds) =>
          partnerIds.every((id) => parentIds.has(id)),
        )
      ) {
        continue
      }

      const unionId = `spouse:${partnerKey}`
      if (!unionsById.has(unionId)) {
        unionsById.set(unionId, {
          id: unionId,
          partnerIds,
          childIds: [],
        })
      }
    }
  }

  const unions = [...unionsById.values()].sort((a, b) => compareIds(a.id, b.id))
  const components = buildComponents(people, unions)

  return {
    people,
    unions,
    components,
  }
}

function buildComponents(
  people: FamilyPersonNode[],
  unions: FamilyUnionNode[],
): FamilyComponent[] {
  const unionById = new Map(unions.map((union) => [union.id, union]))
  const personToUnions = new Map(people.map((person) => [person.id, [] as string[]]))

  for (const union of unions) {
    for (const personId of [...union.partnerIds, ...union.childIds]) {
      personToUnions.get(personId)?.push(union.id)
    }
  }

  for (const unionIds of personToUnions.values()) unionIds.sort(compareIds)

  const visitedPeople = new Set<string>()
  const visitedUnions = new Set<string>()
  const components: FamilyComponent[] = []

  for (const person of people) {
    if (visitedPeople.has(person.id)) continue

    const personIds = new Set<string>()
    const unionIds = new Set<string>()
    const pending: Array<{ kind: 'person' | 'union'; id: string }> = [
      { kind: 'person', id: person.id },
    ]

    while (pending.length > 0) {
      const item = pending.shift()!

      if (item.kind === 'person') {
        if (visitedPeople.has(item.id)) continue

        visitedPeople.add(item.id)
        personIds.add(item.id)

        for (const unionId of personToUnions.get(item.id) ?? []) {
          pending.push({ kind: 'union', id: unionId })
        }
        continue
      }

      if (visitedUnions.has(item.id)) continue

      visitedUnions.add(item.id)
      unionIds.add(item.id)

      const union = unionById.get(item.id)
      if (!union) continue

      for (const nextPersonId of [...union.partnerIds, ...union.childIds].sort(compareIds)) {
        pending.push({ kind: 'person', id: nextPersonId })
      }
    }

    const sortedPersonIds = [...personIds].sort(compareIds)
    const sortedUnionIds = [...unionIds].sort(compareIds)

    components.push({
      id: `component:${sortedPersonIds.join('+')}`,
      personIds: sortedPersonIds,
      unionIds: sortedUnionIds,
    })
  }

  return components.sort((a, b) => compareIds(a.personIds[0] ?? '', b.personIds[0] ?? ''))
}

function knownUniqueIds(ids: string[], memberById: Map<string, Member>): string[] {
  return [...new Set(ids)].filter((id) => memberById.has(id))
}

function compareMemberIdsByBirthDateThenId(
  a: string,
  b: string,
  memberById: Map<string, Member>,
): number {
  const aBirthDate = memberById.get(a)?.birthDate
  const bBirthDate = memberById.get(b)?.birthDate

  if (aBirthDate && bBirthDate && aBirthDate !== bBirthDate) {
    return aBirthDate.localeCompare(bBirthDate)
  }

  if (aBirthDate && !bBirthDate) return -1
  if (!aBirthDate && bBirthDate) return 1

  return compareIds(a, b)
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}
