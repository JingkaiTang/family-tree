import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'
import { buildFamilyUnits } from './buildFamilyUnits'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'
import type { RouteSegment } from './types'

export function member(id: string, patch: Partial<Member> = {}): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
    ...patch,
  }
}

export function familyData(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(value => [value.id, value])),
    ...patch,
  }
}

export function linkParent(child: Member, parent: Member, type: 'blood' | 'adopted' | 'step' = 'blood') {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}

export function linkSpouse(left: Member, right: Member, type: 'married' | 'divorced' = 'married') {
  left.spouses.push({ id: right.id, type })
  right.spouses.push({ id: left.id, type })
}

export function buildProjectedInput(data: FamilyData) {
  const normalized = normalizeFacts(data)
  const projected = projectView(normalized.facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(
    projected,
    EMPTY_LAYOUT_PREFERENCES,
    DEFAULT_LAYOUT_METRICS,
  )
  return { normalized, projected, built }
}

export function segmentKey(segment: RouteSegment): string {
  const points = segment.points.map(point => `${point.x},${point.y}`).join('>')
  return `${segment.orientation}:${points}`
}

export function positiveCollinearOverlap(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation !== right.orientation) return false
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const [a0, a1] = left.points
  const [b0, b1] = right.points
  if (left.orientation === 'horizontal') {
    if (a0.y !== b0.y) return false
    return Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x))
      < Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x))
  }
  if (a0.x !== b0.x) return false
  return Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y))
    < Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y))
}
