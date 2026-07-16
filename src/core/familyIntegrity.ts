import type { FamilyData, Member } from './schema'

type RelationKey = keyof Pick<
  Member,
  'parents' | 'children' | 'siblings' | 'spouses' | 'godparents' | 'godchildren'
>

interface RelationRef {
  id: string
  type: string
}

const RELATIONS: ReadonlyArray<{
  key: RelationKey
  reverse: RelationKey
  label: string
}> = [
  { key: 'parents', reverse: 'children', label: '父母' },
  { key: 'children', reverse: 'parents', label: '子女' },
  { key: 'siblings', reverse: 'siblings', label: '兄弟姐妹' },
  { key: 'spouses', reverse: 'spouses', label: '配偶' },
  { key: 'godparents', reverse: 'godchildren', label: '干亲长辈' },
  { key: 'godchildren', reverse: 'godparents', label: '干亲晚辈' },
]

const MAX_REPORTED_ISSUES = 50

/**
 * 校验 Zod 无法表达的跨成员约束。返回可直接展示给用户的定位信息。
 */
export function validateFamilyIntegrity(family: FamilyData): string[] {
  const issues: string[] = []
  let hiddenIssueCount = 0
  const addIssue = (message: string) => {
    if (issues.length < MAX_REPORTED_ISSUES) issues.push(message)
    else hiddenIssueCount += 1
  }
  const members = family.members
  const memberIds = Object.keys(members).sort((a, b) => a.localeCompare(b))

  for (const memberId of memberIds) {
    const member = members[memberId]
    if (!memberId) addIssue('members 包含空 ID')
    if (member.id !== memberId) {
      addIssue(`members.${memberId}.id 应为 ${memberId}，实际为 ${member.id}`)
    }

    for (const relation of RELATIONS) {
      const seen = new Set<string>()
      const refs = member[relation.key] as RelationRef[]
      for (const ref of refs) {
        const path = `members.${memberId}.${relation.key}`
        if (seen.has(ref.id)) addIssue(`${path} 重复引用 ${ref.id}`)
        seen.add(ref.id)

        if (ref.id === memberId) {
          addIssue(`${path} 不能引用成员自身`)
          continue
        }
        const target = members[ref.id]
        if (!target) {
          addIssue(`${path} 引用了不存在的成员 ${ref.id}`)
          continue
        }
        const reverseRefs = target[relation.reverse] as RelationRef[]
        const reverseType = relation.key === 'godparents'
          ? 'godchild'
          : relation.key === 'godchildren'
            ? 'godparent'
            : ref.type
        if (!reverseRefs.some(reverse => reverse.id === memberId && reverse.type === reverseType)) {
          addIssue(
            `${path} 中 ${ref.id} 的${relation.label}关系缺少同类型反向引用 ${relation.reverse}`,
          )
        }
      }
    }

    const currentSpouses = member.spouses.filter(spouse => spouse.type === 'married')
    if (currentSpouses.length > 1) {
      addIssue(`members.${memberId}.spouses 同时存在多个当前配偶`)
    }
  }

  validateMemberPointer(family.rootMemberId, 'rootMemberId', members, addIssue)
  validateMemberPointer(family.defaultViewpointId, 'defaultViewpointId', members, addIssue)

  for (const [fromId, overrides] of Object.entries(family.nicknameOverrides)) {
    validateMemberPointer(fromId, `nicknameOverrides.${fromId}`, members, addIssue)
    for (const toId of Object.keys(overrides)) {
      validateMemberPointer(toId, `nicknameOverrides.${fromId}.${toId}`, members, addIssue)
    }
  }
  for (const memberId of Object.keys(family.manualPositions)) {
    validateMemberPointer(memberId, `manualPositions.${memberId}`, members, addIssue)
  }
  for (const [memberId, assignment] of Object.entries(family.childLayoutAssignments)) {
    validateMemberPointer(memberId, `childLayoutAssignments.${memberId}`, members, addIssue)
    validateMemberPointer(
      assignment.primaryParentId,
      `childLayoutAssignments.${memberId}.primaryParentId`,
      members,
      addIssue,
    )
    validateMemberPointer(
      assignment.primarySpouseId,
      `childLayoutAssignments.${memberId}.primarySpouseId`,
      members,
      addIssue,
    )
  }

  const cycle = findAncestryCycle(members)
  if (cycle) addIssue(`亲子关系包含祖先环：${cycle.join(' -> ')}`)

  if (hiddenIssueCount > 0) issues.push(`另有 ${hiddenIssueCount} 个问题未显示`)
  return issues
}

export function assertFamilyIntegrity(family: FamilyData): void {
  const issues = validateFamilyIntegrity(family)
  if (issues.length > 0) {
    throw new Error(`家族关系完整性校验失败：${issues.join('; ')}`)
  }
}

function validateMemberPointer(
  memberId: string | undefined,
  path: string,
  members: FamilyData['members'],
  addIssue: (message: string) => void,
) {
  if (memberId !== undefined && !members[memberId]) {
    addIssue(`${path} 引用了不存在的成员 ${memberId}`)
  }
}

/** 迭代 DFS，避免畸形超深家谱触发调用栈溢出。 */
function findAncestryCycle(members: FamilyData['members']): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>()
  const memberIds = Object.keys(members).sort((a, b) => a.localeCompare(b))

  for (const startId of memberIds) {
    if (state.has(startId)) continue

    const activePath: string[] = [startId]
    const activeIndex = new Map<string, number>([[startId, 0]])
    const stack = [{ id: startId, nextParent: 0 }]
    state.set(startId, 'visiting')

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const parents = members[frame.id].parents
      if (frame.nextParent >= parents.length) {
        state.set(frame.id, 'done')
        activeIndex.delete(frame.id)
        activePath.pop()
        stack.pop()
        continue
      }

      const parentId = parents[frame.nextParent++].id
      if (!members[parentId]) continue
      if (state.get(parentId) === 'visiting') {
        const cycleStart = activeIndex.get(parentId) ?? 0
        return [...activePath.slice(cycleStart), parentId]
      }
      if (state.get(parentId) === 'done') continue

      state.set(parentId, 'visiting')
      activeIndex.set(parentId, activePath.length)
      activePath.push(parentId)
      stack.push({ id: parentId, nextParent: 0 })
    }
  }
  return null
}
