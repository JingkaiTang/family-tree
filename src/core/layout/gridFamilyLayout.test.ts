import { describe, expect, it } from 'vitest'
import type { FamilyData, Member } from '@/core/schema'
import { createEmptyFamily } from '@/core/schema'
import { layoutGridFamilyTree } from './gridFamilyLayout'

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

function data(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
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

describe('layoutGridFamilyTree', () => {
  it('places current spouses on the same row and children below', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = await layoutGridFamilyTree(data([dad, mom, kid]))

    const dadNode = result.nodes.find((node) => node.id === 'dad')!
    const momNode = result.nodes.find((node) => node.id === 'mom')!
    const kidNode = result.nodes.find((node) => node.id === 'kid')!
    expect(dadNode.top).toBe(momNode.top)
    expect(kidNode.top).toBeGreaterThan(dadNode.top)
    expect(result.couples[0].memberIds).toEqual(['dad', 'mom'])
  })

  it('keeps siblings contiguous and ordered by birth date', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const older = member('older', { birthDate: '2000-01-01' })
    const younger = member('younger', { birthDate: '2005-01-01' })
    linkSpouse(dad, mom)
    for (const child of [younger, older]) {
      linkParent(child, dad)
      linkParent(child, mom)
    }

    const result = await layoutGridFamilyTree(data([dad, mom, younger, older]))

    expect(result.nodes
      .filter((node) => ['older', 'younger'].includes(node.id))
      .sort((left, right) => left.cx - right.cx)
      .map((node) => node.id),
    ).toEqual(['older', 'younger'])
  })

  it('emits grid metadata for slot-aware dragging', async () => {
    const a = member('a')
    const b = member('b')

    const result = await layoutGridFamilyTree(data([a, b], {
      gridLayoutOverrides: { 'person:b': { order: -1 } },
    }))

    expect(result.grid?.memberSlotIds).toEqual({
      a: 'person:a',
      b: 'person:b',
    })
    expect(result.grid?.slotPositions['person:b'].order).toBe(0)
    expect(result.grid?.columnWidth).toBeGreaterThan(0)
  })

  it('ignores legacy manualPositions', async () => {
    const a = member('a')

    const result = await layoutGridFamilyTree(data([a], {
      manualPositions: { a: { cx: 100, top: 100 } },
    }))

    expect(result.nodes[0].cx).not.toBe(100 + result.offsetX)
    expect(result.nodes[0].top).toBe(0)
  })
})
