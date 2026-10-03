import { normalizeFacts } from '@/core/family-graph/normalizeFacts'
import type {
  FamilyFacts,
  ParentageFact,
  PartnershipFact,
} from '@/core/family-graph/types'
import type { FamilyData, Member } from '@/core/schema'
import {
  findSiblingOrderForMembers,
  orderSiblingIds,
} from '@/core/siblingOrder'
import type {
  FocusFlowBlock,
  FocusFlowBranchSummary,
  FocusFlowScene,
  FocusFlowSection,
  FocusFlowSectionKind,
} from './types'

const CORE_PREVIEW_LIMIT = 4

export interface LayoutFocusFlowOptions {
  focusId?: string | null
  expandedBranchIds?: readonly string[]
  showAuxiliaryRelations?: boolean
}

interface FocusFlowContext {
  data: FamilyData
  facts: FamilyFacts
  memberById: Map<string, Member>
  expandedBranchIds: Set<string>
  showAuxiliaryRelations: boolean
}

/** 独立于网格几何的移动端聚焦纵流布局。 */
export function layoutFocusFlow(
  data: FamilyData,
  options: LayoutFocusFlowOptions = {},
): FocusFlowScene {
  const normalized = normalizeFacts(data)
  const focusId = resolveFocusId(normalized.facts, options.focusId)
  if (focusId === null) {
    return {
      kind: 'focus-flow',
      focusId: null,
      sections: [],
      branches: [],
      diagnostics: normalized.diagnostics,
    }
  }

  const context: FocusFlowContext = {
    data,
    facts: normalized.facts,
    memberById: new Map(normalized.facts.people.map(person => [person.id, person.member])),
    expandedBranchIds: new Set(options.expandedBranchIds ?? []),
    showAuxiliaryRelations: options.showAuxiliaryRelations === true,
  }
  const sections: FocusFlowSection[] = []
  const branches: FocusFlowBranchSummary[] = []

  const parentages = parentagesForChild(context.facts, focusId)
  const parentBlocks = parentages.map(parentage => block(
    `parents:${focusId}:${parentage.id}`,
    parentage.parentIds,
    'parents',
    parentageLabel(parentage.typeByChildId[focusId]),
    parentage.typeByChildId[focusId],
  ))
  pushSection(sections, 'parents', '父母家庭', parentBlocks)

  pushSection(sections, 'focus', '当前家庭', focusBlocks(context, focusId))

  const siblingIds = siblingIdsFor(context, focusId)
  const siblingBranchId = `siblings:${focusId}`
  const siblingExpanded = context.expandedBranchIds.has(siblingBranchId)
  const siblingBlocks = siblingIds.map(memberId => memberFamilyBlock(
    context,
    memberId,
    'siblings',
  ))
  pushPreviewSection(
    sections,
    'siblings',
    '兄弟姐妹家庭',
    siblingBlocks,
    siblingBranchId,
    siblingExpanded,
  )

  const childIds = orderRelatedIds(context, childIdsFor(context.facts, focusId))
  const childBranchId = `children:${focusId}`
  const childExpanded = context.expandedBranchIds.has(childBranchId)
  const childBlocks = childIds.map(childId => memberFamilyBlock(
    context,
    childId,
    'children',
    childContextLabel(context, focusId, childId),
  ))
  pushPreviewSection(
    sections,
    'children',
    '子女家庭',
    childBlocks,
    childBranchId,
    childExpanded,
  )

  const ancestorBlocks = ancestorBlocksFor(context, focusId)
  addProgressiveBranch(
    context,
    sections,
    branches,
    `ancestors:${focusId}`,
    'ancestors',
    '更早的祖辈',
    ancestorBlocks,
  )

  const descendantBlocks = descendantBlocksFor(context, focusId)
  addProgressiveBranch(
    context,
    sections,
    branches,
    `descendants:${focusId}`,
    'descendants',
    '更晚的后代',
    descendantBlocks,
    false,
    descendantBlocks.length,
  )

  const historicalBlocks = partnershipBlocks(
    context,
    focusId,
    'historical',
    'historical',
  )
  addProgressiveBranch(
    context,
    sections,
    branches,
    `historical:${focusId}`,
    'historical',
    '历史伴侣',
    historicalBlocks,
    true,
    historicalBlocks.length,
  )

  const focusMember = context.memberById.get(focusId)!
  const godparentBlocks = uniqueKnownIds(
    focusMember.godparents.map(value => value.id),
    context.memberById,
  ).map(memberId => memberFamilyBlock(context, memberId, 'godparents'))
  addProgressiveBranch(
    context,
    sections,
    branches,
    `godparents:${focusId}`,
    'godparents',
    '干亲长辈',
    godparentBlocks,
    true,
    godparentBlocks.length,
  )

  const godchildBlocks = uniqueKnownIds(
    focusMember.godchildren.map(value => value.id),
    context.memberById,
  ).map(memberId => memberFamilyBlock(context, memberId, 'godchildren'))
  addProgressiveBranch(
    context,
    sections,
    branches,
    `godchildren:${focusId}`,
    'godchildren',
    '干亲晚辈',
    godchildBlocks,
    true,
    godchildBlocks.length,
  )

  return {
    kind: 'focus-flow',
    focusId,
    sections,
    branches,
    diagnostics: normalized.diagnostics,
  }
}

function resolveFocusId(facts: FamilyFacts, requestedId: string | null | undefined): string | null {
  if (requestedId && facts.people.some(person => person.id === requestedId)) return requestedId
  return facts.people[0]?.id ?? null
}

function parentagesForChild(facts: FamilyFacts, childId: string): ParentageFact[] {
  const typeRank = { blood: 0, adopted: 1, step: 2 } as const
  return facts.parentages
    .filter(parentage => parentage.childIds.includes(childId))
    .sort((left, right) => (
      typeRank[left.typeByChildId[childId]] - typeRank[right.typeByChildId[childId]]
      || left.id.localeCompare(right.id)
    ))
}

function parentageLabel(type: ParentageFact['typeByChildId'][string]): string {
  if (type === 'adopted') return '养父母家庭'
  if (type === 'step') return '继父母家庭'
  return '生父母家庭'
}

function focusBlocks(context: FocusFlowContext, focusId: string): FocusFlowBlock[] {
  const current = partnershipsFor(context.facts, focusId, 'current')
  if (current.length === 0) return [block(`focus:${focusId}`, [focusId], 'focus')]
  return current.map(partnership => block(
    `focus:${partnership.id}`,
    [focusId, ...partnership.partnerIds.filter(id => id !== focusId)],
    'focus',
  ))
}

function partnershipBlocks(
  context: FocusFlowContext,
  focusId: string,
  status: PartnershipFact['status'],
  relation: FocusFlowSectionKind,
): FocusFlowBlock[] {
  return partnershipsFor(context.facts, focusId, status).map(partnership => block(
    `${relation}:${partnership.id}`,
    [focusId, ...partnership.partnerIds.filter(id => id !== focusId)],
    relation,
  ))
}

function partnershipsFor(
  facts: FamilyFacts,
  memberId: string,
  status: PartnershipFact['status'],
): PartnershipFact[] {
  return facts.partnerships
    .filter(partnership => (
      partnership.status === status
      && partnership.partnerIds.includes(memberId)
    ))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function currentPartnerIds(context: FocusFlowContext, memberId: string): string[] {
  return uniqueKnownIds(
    partnershipsFor(context.facts, memberId, 'current')
      .flatMap(partnership => partnership.partnerIds)
      .filter(id => id !== memberId),
    context.memberById,
  )
}

function siblingIdsFor(context: FocusFlowContext, focusId: string): string[] {
  const focusMember = context.memberById.get(focusId)!
  const focusParentages = parentagesForChild(context.facts, focusId)
  const biologicalParentIds = new Set(focusParentages
    .filter(parentage => parentage.typeByChildId[focusId] === 'blood')
    .flatMap(parentage => parentage.parentIds))
  const halfSiblingIds = context.facts.parentages
    .filter(parentage => parentage.parentIds.some(id => biologicalParentIds.has(id)))
    .flatMap(parentage => parentage.childIds
      .filter(id => parentage.typeByChildId[id] === 'blood'))
  const ids = uniqueKnownIds([
    ...focusParentages.flatMap(parentage => parentage.childIds),
    ...halfSiblingIds,
    ...focusMember.siblings.map(sibling => sibling.id),
  ], context.memberById).filter(id => id !== focusId)
  return orderRelatedIds(context, ids)
}

function childIdsFor(facts: FamilyFacts, focusId: string): string[] {
  return [...new Set(facts.parentages
    .filter(parentage => parentage.parentIds.includes(focusId))
    .flatMap(parentage => parentage.childIds))]
}

function childContextLabel(
  context: FocusFlowContext,
  focusId: string,
  childId: string,
): string | undefined {
  const coParentIds = uniqueKnownIds(context.facts.parentages
    .filter(parentage => (
      parentage.childIds.includes(childId)
      && parentage.parentIds.includes(focusId)
    ))
    .flatMap(parentage => parentage.parentIds)
    .filter(id => id !== focusId), context.memberById)
  if (coParentIds.length === 0) return undefined
  return `与 ${coParentIds.map(id => memberName(context.memberById.get(id)!)).join('、')} 的子女`
}

function ancestorBlocksFor(context: FocusFlowContext, focusId: string): FocusFlowBlock[] {
  const directParentIds = parentagesForChild(context.facts, focusId)
    .flatMap(parentage => parentage.parentIds)
  const seenParentageIds = new Set<string>()
  const blocks: FocusFlowBlock[] = []
  for (const parentId of directParentIds) {
    for (const parentage of parentagesForChild(context.facts, parentId)) {
      if (seenParentageIds.has(parentage.id)) continue
      seenParentageIds.add(parentage.id)
      blocks.push(block(
        `ancestors:${parentId}:${parentage.id}`,
        parentage.parentIds,
        'ancestors',
        `${memberName(context.memberById.get(parentId)!)}的${parentageLabel(parentage.typeByChildId[parentId])}`,
        parentage.typeByChildId[parentId],
      ))
    }
  }
  return blocks.sort((left, right) => left.id.localeCompare(right.id))
}

function descendantBlocksFor(context: FocusFlowContext, focusId: string): FocusFlowBlock[] {
  const grandchildIds = childIdsFor(context.facts, focusId)
    .flatMap(childId => childIdsFor(context.facts, childId))
  return orderRelatedIds(context, uniqueKnownIds(grandchildIds, context.memberById))
    .map(memberId => memberFamilyBlock(context, memberId, 'descendants'))
}

function memberFamilyBlock(
  context: FocusFlowContext,
  memberId: string,
  relation: FocusFlowSectionKind,
  label?: string,
): FocusFlowBlock {
  return block(
    `${relation}:family:${memberId}`,
    [memberId, ...currentPartnerIds(context, memberId)],
    relation,
    label,
  )
}

function block(
  id: string,
  memberIds: string[],
  relation: FocusFlowSectionKind,
  label?: string,
  parentageType?: FocusFlowBlock['parentageType'],
): FocusFlowBlock {
  const uniqueIds = [...new Set(memberIds)]
  return {
    id,
    kind: uniqueIds.length === 1 ? 'single' : uniqueIds.length === 2 ? 'couple' : 'members',
    memberIds: uniqueIds,
    relation,
    ...(label ? { label } : {}),
    ...(parentageType ? { parentageType } : {}),
  }
}

function pushSection(
  sections: FocusFlowSection[],
  kind: FocusFlowSectionKind,
  title: string,
  blocks: FocusFlowBlock[],
): void {
  if (blocks.length === 0) return
  sections.push({ id: `section:${kind}`, kind, title, blocks })
}

function pushPreviewSection(
  sections: FocusFlowSection[],
  kind: FocusFlowSectionKind,
  title: string,
  blocks: FocusFlowBlock[],
  branchId: string,
  expanded: boolean,
): void {
  if (blocks.length === 0) return
  const visibleBlocks = expanded ? blocks : blocks.slice(0, CORE_PREVIEW_LIMIT)
  sections.push({
    id: `section:${kind}`,
    kind,
    title,
    blocks: visibleBlocks,
    ...(blocks.length > CORE_PREVIEW_LIMIT
      ? {
          branch: {
            id: branchId,
            totalCount: blocks.length,
            visibleCount: visibleBlocks.length,
            expanded,
          },
        }
      : {}),
  })
}

function addProgressiveBranch(
  context: FocusFlowContext,
  sections: FocusFlowSection[],
  branches: FocusFlowBranchSummary[],
  id: string,
  kind: FocusFlowSectionKind,
  label: string,
  blocks: FocusFlowBlock[],
  auxiliary = false,
  relatedCount?: number,
): void {
  if (blocks.length === 0) return
  const expanded = context.expandedBranchIds.has(id)
    || (auxiliary && context.showAuxiliaryRelations)
  const lockedOpen = auxiliary && context.showAuxiliaryRelations
  branches.push({
    id,
    kind,
    label,
    count: relatedCount ?? new Set(blocks.flatMap(value => value.memberIds)).size,
    expanded,
    ...(lockedOpen ? { lockedOpen: true } : {}),
  })
  if (expanded) pushSection(sections, kind, label, blocks)
}

function orderRelatedIds(context: FocusFlowContext, memberIds: string[]): string[] {
  const preferred = findSiblingOrderForMembers(
    memberIds,
    context.data.siblingOrders ?? {},
  )?.memberIds
  return orderSiblingIds(memberIds, context.memberById, preferred)
}

function uniqueKnownIds(memberIds: string[], memberById: Map<string, Member>): string[] {
  return [...new Set(memberIds)]
    .filter(id => memberById.has(id))
    .sort((left, right) => left.localeCompare(right))
}

function memberName(member: Member): string {
  return `${member.lastName}${member.firstName}`.trim()
    || member.nickname?.trim()
    || '未命名'
}
