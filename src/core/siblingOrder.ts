import type { FamilyData, Member, SiblingOrders } from './schema'
import { normalizeFacts } from './family-layout/normalizeFacts'

export interface SiblingOrderGroup {
  id: string
  parentIds: string[]
  memberIds: string[]
}

export interface SiblingOrderMatch {
  groupId: string
  memberIds: string[]
}

export function listSiblingOrderGroups(data: FamilyData): SiblingOrderGroup[] {
  return discoverSiblingOrderGroups(data).map(group => ({
    ...group,
    memberIds: orderSiblingIds(
      group.memberIds,
      data.members,
      preferredOrderForGroup(group, data.siblingOrders ?? {}),
    ),
  }))
}

export function siblingOrderGroupsForMember(
  data: FamilyData,
  memberId: string,
): SiblingOrderGroup[] {
  return listSiblingOrderGroups(data).filter(group => group.memberIds.includes(memberId))
}

export function orderSiblingIds(
  childIds: string[],
  members: FamilyData['members'] | ReadonlyMap<string, Member>,
  preferredOrder?: string[],
): string[] {
  const memberById = members instanceof Map
    ? members
    : new Map(Object.entries(members))
  const automatic = [...new Set(childIds)]
    .filter(id => memberById.has(id))
    .sort((leftId, rightId) => compareAutomaticOrder(
      memberById.get(leftId),
      memberById.get(rightId),
      leftId,
      rightId,
    ))
  if (preferredOrder === undefined) return automatic

  const availableIds = new Set(automatic)
  const seenIds = new Set<string>()
  const preferred = preferredOrder.filter(id => {
    if (!availableIds.has(id) || seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })
  return [...preferred, ...automatic.filter(id => !seenIds.has(id))]
}

/** 找到与指定成员重叠最多的一份共享顺序。 */
export function findSiblingOrderForMembers(
  memberIds: string[],
  siblingOrders: SiblingOrders,
  minimumOverlap = 2,
): SiblingOrderMatch | undefined {
  const requestedIds = new Set(memberIds)
  return Object.entries(siblingOrders)
    .map(([groupId, order]) => {
      const uniqueOrder = [...new Set(order)]
      return {
        groupId,
        memberIds: uniqueOrder,
        overlap: uniqueOrder.filter(id => requestedIds.has(id)).length,
      }
    })
    .filter(match => match.overlap >= minimumOverlap)
    .sort((left, right) => (
      right.overlap - left.overlap
      || right.memberIds.length - left.memberIds.length
      || left.groupId.localeCompare(right.groupId)
    ))[0]
}

/** 仅当两人存在于同一份共享顺序中时返回先后关系。 */
export function compareSiblingOrderIds(
  leftId: string,
  rightId: string,
  siblingOrders: SiblingOrders,
): number | null {
  for (const [, order] of Object.entries(siblingOrders)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const leftIndex = order.indexOf(leftId)
    const rightIndex = order.indexOf(rightId)
    if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) continue
    return leftIndex - rightIndex
  }
  return null
}

export function reconcileSiblingOrders(data: FamilyData): SiblingOrders {
  const next: SiblingOrders = {}

  for (const group of discoverSiblingOrderGroups(data)) {
    const preferredOrder = preferredOrderForGroup(group, data.siblingOrders ?? {})
    if (preferredOrder === undefined) continue
    next[group.id] = orderSiblingIds(group.memberIds, data.members, preferredOrder)
  }
  return next
}

function discoverSiblingOrderGroups(data: FamilyData): SiblingOrderGroup[] {
  const { facts } = normalizeFacts(data)
  const knownIds = new Set(facts.people.map(person => person.id))
  const parentByMemberId = new Map<string, string>()
  const participatingIds = new Set<string>()

  const findRoot = (memberId: string): string => {
    const parentId = parentByMemberId.get(memberId) ?? memberId
    if (parentId === memberId) return memberId
    const rootId = findRoot(parentId)
    parentByMemberId.set(memberId, rootId)
    return rootId
  }
  const union = (leftId: string, rightId: string): void => {
    if (!knownIds.has(leftId) || !knownIds.has(rightId) || leftId === rightId) return
    participatingIds.add(leftId)
    participatingIds.add(rightId)
    const leftRootId = findRoot(leftId)
    const rightRootId = findRoot(rightId)
    if (leftRootId !== rightRootId) parentByMemberId.set(rightRootId, leftRootId)
  }

  const childIdsByParentId = new Map<string, string[]>()
  for (const parentage of facts.parentages) {
    for (const parentId of parentage.parentIds) {
      const childIds = childIdsByParentId.get(parentId) ?? []
      childIds.push(...parentage.childIds)
      childIdsByParentId.set(parentId, childIds)
    }
  }
  for (const childIds of childIdsByParentId.values()) {
    const uniqueChildIds = [...new Set(childIds)]
    for (let index = 1; index < uniqueChildIds.length; index += 1) {
      union(uniqueChildIds[0], uniqueChildIds[index])
    }
  }
  for (const person of facts.people) {
    for (const sibling of person.member.siblings) {
      union(person.id, sibling.id)
    }
  }

  const componentByRootId = new Map<string, string[]>()
  for (const memberId of participatingIds) {
    const rootId = findRoot(memberId)
    const component = componentByRootId.get(rootId) ?? []
    component.push(memberId)
    componentByRootId.set(rootId, component)
  }

  return [...componentByRootId.values()]
    .map(memberIds => [...memberIds].sort((left, right) => left.localeCompare(right)))
    .filter(memberIds => memberIds.length > 1)
    .map(memberIds => {
      const memberIdSet = new Set(memberIds)
      const exactParentage = facts.parentages.find(parentage => (
        parentage.childIds.length === memberIds.length
        && parentage.childIds.every(id => memberIdSet.has(id))
      ))
      const parentIds = [...new Set(facts.parentages
        .filter(parentage => parentage.childIds.some(id => memberIdSet.has(id)))
        .flatMap(parentage => parentage.parentIds))]
        .sort((left, right) => left.localeCompare(right))
      return {
        id: exactParentage?.id ?? `siblings:${memberIds.join('+')}`,
        parentIds,
        memberIds,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

function preferredOrderForGroup(
  group: SiblingOrderGroup,
  siblingOrders: SiblingOrders,
): string[] | undefined {
  return siblingOrders[group.id]
    ?? findSiblingOrderForMembers(group.memberIds, siblingOrders)?.memberIds
}

function compareAutomaticOrder(
  left: Member | undefined,
  right: Member | undefined,
  leftId: string,
  rightId: string,
): number {
  const leftBirthDate = left?.birthDate
  const rightBirthDate = right?.birthDate
  if (leftBirthDate && rightBirthDate && leftBirthDate !== rightBirthDate) {
    return leftBirthDate.localeCompare(rightBirthDate)
  }
  if (leftBirthDate && !rightBirthDate) return -1
  if (!leftBirthDate && rightBirthDate) return 1
  return leftId.localeCompare(rightId)
}
