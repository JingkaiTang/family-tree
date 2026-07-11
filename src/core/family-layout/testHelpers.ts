import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'

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
