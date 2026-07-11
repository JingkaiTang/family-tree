import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'
import { buildFamilyUnits } from './buildFamilyUnits'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'

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
