import type { FamilyData, Member, SiblingOrders } from './schema'
import { normalizeFacts } from './family-layout/normalizeFacts'

export interface SiblingOrderGroup {
  id: string
  parentIds: string[]
  memberIds: string[]
}

export function listSiblingOrderGroups(data: FamilyData): SiblingOrderGroup[] {
  const { facts } = normalizeFacts(data)
  return facts.parentages
    .filter(parentage => parentage.childIds.length > 1)
    .map(parentage => ({
      id: parentage.id,
      parentIds: [...parentage.parentIds],
      memberIds: orderSiblingIds(
        parentage.childIds,
        data.members,
        data.siblingOrders?.[parentage.id],
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

/** 仅当两人存在于同一份共享顺序中时返回先后关系。 */
export function compareSiblingOrderIds(
  leftId: string,
  rightId: string,
  siblingOrders: SiblingOrders,
): number | null {
  for (const order of Object.values(siblingOrders)) {
    const leftIndex = order.indexOf(leftId)
    const rightIndex = order.indexOf(rightId)
    if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) continue
    return leftIndex - rightIndex
  }
  return null
}

export function reconcileSiblingOrders(data: FamilyData): SiblingOrders {
  const groupsById = new Map(listSiblingOrderGroups({
    ...data,
    siblingOrders: {},
  }).map(group => [group.id, group]))
  const next: SiblingOrders = {}

  for (const [groupId, preferredOrder] of Object.entries(data.siblingOrders ?? {})) {
    const group = groupsById.get(groupId)
    if (group === undefined) continue
    next[groupId] = orderSiblingIds(group.memberIds, data.members, preferredOrder)
  }
  return next
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
