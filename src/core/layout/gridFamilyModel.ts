import type { FamilyData, Member } from '@/core/schema'

export interface GridSlot {
  id: string
  kind: 'person' | 'couple' | 'single-parent'
  memberIds: string[]
  generation: number
  order: number
}

export interface GridChildGroup {
  id: string
  parentSlotId: string
  childIds: string[]
}

export interface GridRow {
  generation: number
  slotIds: string[]
}

export interface GridFamilyModel {
  members: Member[]
  slots: GridSlot[]
  rows: GridRow[]
  childGroups: GridChildGroup[]
  memberSlotIds: Record<string, string>
}

interface ResolvedChildAssignment {
  primaryParentId: string
  primarySpouseId?: string
}

export function buildGridFamilyModel(data: FamilyData): GridFamilyModel {
  const members = Object.values(data.members).sort((left, right) => compareIds(left.id, right.id))
  const memberById = new Map(members.map((member) => [member.id, member]))
  const generations = assignGenerations(members, memberById, data)
  const currentCouples = buildCurrentCouples(members, memberById, generations)
  const slotsById = new Map<string, GridSlot>()
  const memberSlotIds: Record<string, string> = {}

  for (const couple of currentCouples) {
    const id = coupleSlotId(couple[0], couple[1])
    const generation = Math.max(generations.get(couple[0]) ?? 0, generations.get(couple[1]) ?? 0)
    slotsById.set(id, {
      id,
      kind: 'couple',
      memberIds: couple,
      generation,
      order: defaultSlotOrder(id, data),
    })
    memberSlotIds[couple[0]] = id
    memberSlotIds[couple[1]] = id
  }

  const childGroupsBySlotId = new Map<string, string[]>()
  for (const child of members) {
    const assignment = resolveChildAssignment(child, memberById, data)
    if (!assignment) continue

    const parentSlotId = parentSlotIdForAssignment(assignment, memberSlotIds, slotsById, generations, data)
    const childIds = childGroupsBySlotId.get(parentSlotId) ?? []
    childIds.push(child.id)
    childGroupsBySlotId.set(parentSlotId, childIds)
  }

  for (const member of members) {
    if (memberSlotIds[member.id]) continue
    const id = personSlotId(member.id)
    slotsById.set(id, {
      id,
      kind: 'person',
      memberIds: [member.id],
      generation: generations.get(member.id) ?? 0,
      order: defaultSlotOrder(id, data),
    })
    memberSlotIds[member.id] = id
  }

  const childGroups = [...childGroupsBySlotId.entries()]
    .map(([parentSlotId, childIds]) => ({
      id: `children:${parentSlotId}`,
      parentSlotId,
      childIds: childIds.sort((left, right) => compareMembersForChildOrder(left, right, memberById)),
    }))
    .sort((left, right) => compareIds(left.parentSlotId, right.parentSlotId))
  const slots = [...slotsById.values()].sort(compareSlots)
  const rows = buildRows(slots)

  return {
    members,
    slots,
    rows,
    childGroups,
    memberSlotIds,
  }
}

export function personSlotId(id: string): string {
  return `person:${id}`
}

export function coupleSlotId(leftId: string, rightId: string): string {
  return `couple:${[leftId, rightId].sort(compareIds).join('+')}`
}

export function singleParentSlotId(id: string): string {
  return `single-parent:${id}`
}

function parentSlotIdForAssignment(
  assignment: ResolvedChildAssignment,
  memberSlotIds: Record<string, string>,
  slotsById: Map<string, GridSlot>,
  generations: Map<string, number>,
  data: FamilyData,
): string {
  if (assignment.primarySpouseId) {
    return coupleSlotId(assignment.primaryParentId, assignment.primarySpouseId)
  }

  const existingParentSlotId = memberSlotIds[assignment.primaryParentId]
  if (existingParentSlotId) return existingParentSlotId

  const parentSlotId = singleParentSlotId(assignment.primaryParentId)
  if (!slotsById.has(parentSlotId)) {
    slotsById.set(parentSlotId, {
      id: parentSlotId,
      kind: 'single-parent',
      memberIds: [assignment.primaryParentId],
      generation: generations.get(assignment.primaryParentId) ?? 0,
      order: defaultSlotOrder(parentSlotId, data),
    })
    memberSlotIds[assignment.primaryParentId] = parentSlotId
  }
  return parentSlotId
}

function assignGenerations(
  members: Member[],
  memberById: Map<string, Member>,
  data: FamilyData,
): Map<string, number> {
  const generations = new Map(members.map((member) => [member.id, 0]))
  if (generations.size === 0) return generations

  const maxIterations = Math.max(1, members.length * members.length)
  for (let i = 0; i < maxIterations; i++) {
    let changed = false
    for (const member of members) {
      const assignment = resolveChildAssignment(member, memberById, data)

      if (assignment) {
        const parentGeneration = generations.get(assignment.primaryParentId) ?? 0
        if ((generations.get(member.id) ?? 0) < parentGeneration + 1) {
          generations.set(member.id, parentGeneration + 1)
          changed = true
        }

        if (assignment.primarySpouseId) {
          const spouseGeneration = generations.get(assignment.primarySpouseId) ?? parentGeneration
          const targetGeneration = Math.max(parentGeneration, spouseGeneration)
          if ((generations.get(assignment.primaryParentId) ?? 0) !== targetGeneration) {
            generations.set(assignment.primaryParentId, targetGeneration)
            changed = true
          }
          if ((generations.get(assignment.primarySpouseId) ?? 0) !== targetGeneration) {
            generations.set(assignment.primarySpouseId, targetGeneration)
            changed = true
          }
        }
      }

      for (const godparent of member.godparents) {
        if (!memberById.has(godparent.id)) continue
        const godparentGeneration = generations.get(godparent.id) ?? 0
        if ((generations.get(member.id) ?? 0) < godparentGeneration + 1) {
          generations.set(member.id, godparentGeneration + 1)
          changed = true
        }
      }

      for (const godchild of member.godchildren) {
        if (!memberById.has(godchild.id)) continue
        const godparentGeneration = generations.get(member.id) ?? 0
        if ((generations.get(godchild.id) ?? 0) < godparentGeneration + 1) {
          generations.set(godchild.id, godparentGeneration + 1)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  const minGeneration = Math.min(...generations.values())
  for (const [id, generation] of generations) {
    generations.set(id, generation - minGeneration)
  }
  return generations
}

function buildCurrentCouples(
  members: Member[],
  memberById: Map<string, Member>,
  generations: Map<string, number>,
): Array<[string, string]> {
  const seen = new Set<string>()
  const couples: Array<[string, string]> = []

  for (const member of members) {
    const spouseId = member.spouses.find((spouse) => spouse.type === 'married' && memberById.has(spouse.id))?.id
    if (!spouseId) continue

    const pair = [member.id, spouseId].sort(compareIds) as [string, string]
    const key = pair.join('+')
    if (seen.has(key)) continue
    seen.add(key)

    const generation = Math.max(generations.get(pair[0]) ?? 0, generations.get(pair[1]) ?? 0)
    generations.set(pair[0], generation)
    generations.set(pair[1], generation)
    couples.push(pair)
  }

  return couples.sort((left, right) => compareIds(left[0], right[0]) || compareIds(left[1], right[1]))
}

function resolveChildAssignment(
  child: Member,
  memberById: Map<string, Member>,
  data: FamilyData,
): ResolvedChildAssignment | null {
  const explicit = data.childLayoutAssignments[child.id]
  if (explicit?.primaryParentId && memberById.has(explicit.primaryParentId)) {
    const spouseId = explicit.primarySpouseId
    if (spouseId && memberById.has(spouseId) && areCurrentSpouses(explicit.primaryParentId, spouseId, memberById)) {
      const pair = [explicit.primaryParentId, spouseId].sort(compareIds)
      return { primaryParentId: pair[0], primarySpouseId: pair[1] }
    }
    return { primaryParentId: explicit.primaryParentId }
  }

  const parentIds = uniqueSortedIds(child.parents.map((parent) => parent.id).filter((id) => memberById.has(id)))
  if (parentIds.length === 0) return null

  for (const parentId of parentIds) {
    const spouseId = memberById.get(parentId)?.spouses.find((spouse) =>
      spouse.type === 'married' && parentIds.includes(spouse.id),
    )?.id
    if (spouseId) {
      const pair = [parentId, spouseId].sort(compareIds)
      return { primaryParentId: pair[0], primarySpouseId: pair[1] }
    }
  }

  return { primaryParentId: parentIds[0] }
}

function areCurrentSpouses(leftId: string, rightId: string, memberById: Map<string, Member>): boolean {
  return Boolean(
    memberById.get(leftId)?.spouses.some((spouse) => spouse.id === rightId && spouse.type === 'married') ||
      memberById.get(rightId)?.spouses.some((spouse) => spouse.id === leftId && spouse.type === 'married'),
  )
}

function defaultSlotOrder(id: string, data: FamilyData): number {
  return data.gridLayoutOverrides[id]?.order ?? 0
}

function buildRows(slots: GridSlot[]): GridRow[] {
  const slotIdsByGeneration = new Map<number, string[]>()
  for (const slot of slots) {
    const row = slotIdsByGeneration.get(slot.generation) ?? []
    row.push(slot.id)
    slotIdsByGeneration.set(slot.generation, row)
  }

  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  return [...slotIdsByGeneration.entries()]
    .sort(([left], [right]) => left - right)
    .map(([generation, slotIds]) => ({
      generation,
      slotIds: slotIds.sort((leftId, rightId) => {
        const left = slotById.get(leftId)!
        const right = slotById.get(rightId)!
        return left.order - right.order || compareIds(left.id, right.id)
      }),
    }))
}

function compareSlots(left: GridSlot, right: GridSlot): number {
  return left.generation - right.generation || left.order - right.order || compareIds(left.id, right.id)
}

function compareMembersForChildOrder(
  leftId: string,
  rightId: string,
  memberById: Map<string, Member>,
): number {
  const leftBirth = memberById.get(leftId)?.birthDate
  const rightBirth = memberById.get(rightId)?.birthDate
  if (leftBirth && rightBirth && leftBirth !== rightBirth) return leftBirth.localeCompare(rightBirth)
  if (leftBirth && !rightBirth) return -1
  if (!leftBirth && rightBirth) return 1
  return compareIds(leftId, rightId)
}

function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort(compareIds)
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}
