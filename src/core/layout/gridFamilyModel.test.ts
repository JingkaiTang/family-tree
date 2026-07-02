import { describe, expect, it } from 'vitest'
import type { FamilyData, Member } from '@/core/schema'
import { createEmptyFamily } from '@/core/schema'
import { buildGridFamilyModel } from './gridFamilyModel'

function member(id: string, patch: Partial<Member> = {}): Member {
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

function family(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

describe('buildGridFamilyModel', () => {
  it('creates a couple slot for current spouses and one child group', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const model = buildGridFamilyModel(family([dad, mom, kid]))

    expect(model.slots.map((slot) => slot.id)).toContain('couple:dad+mom')
    expect(model.childGroups).toEqual([
      { id: 'children:couple:dad+mom', parentSlotId: 'couple:dad+mom', childIds: ['kid'] },
    ])
    expect(model.memberSlotIds.kid).toBe('person:kid')
  })

  it('uses explicit child layout assignment instead of biological parent pair', () => {
    const bioDad = member('bioDad')
    const mom = member('mom')
    const stepDad = member('stepDad')
    const kid = member('kid')
    linkSpouse(mom, stepDad)
    linkParent(kid, bioDad)
    linkParent(kid, mom)

    const model = buildGridFamilyModel(family([bioDad, mom, stepDad, kid], {
      childLayoutAssignments: {
        kid: { primaryParentId: 'mom', primarySpouseId: 'stepDad' },
      },
    }))

    expect(model.childGroups).toEqual([
      { id: 'children:couple:mom+stepDad', parentSlotId: 'couple:mom+stepDad', childIds: ['kid'] },
    ])
  })

  it('creates a single-parent slot when child assignment points to one parent', () => {
    const parent = member('parent')
    const kid = member('kid')
    linkParent(kid, parent)

    const model = buildGridFamilyModel(family([parent, kid]))

    expect(model.slots.map((slot) => slot.id)).toContain('single-parent:parent')
    expect(model.childGroups[0].parentSlotId).toBe('single-parent:parent')
  })

  it('applies grid order overrides within rows', () => {
    const a = member('a')
    const b = member('b')

    const model = buildGridFamilyModel(family([a, b], {
      gridLayoutOverrides: {
        'person:b': { order: -1 },
      },
    }))

    expect(model.rows[0].slotIds).toEqual(['person:b', 'person:a'])
  })
})
