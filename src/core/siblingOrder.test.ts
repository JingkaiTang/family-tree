import { describe, expect, it } from 'vitest'
import { createEmptyFamily } from './schema'
import { addParent, addSibling, mk } from '@/__tests__/fixtures/families'
import {
  reconcileSiblingOrders,
  siblingOrderGroupsForMember,
} from './siblingOrder'

describe('siblingOrder', () => {
  it('shares one parentage order across every sibling detail', () => {
    const parentA = mk('parent-a')
    const parentB = mk('parent-b')
    const childA = mk('child-a')
    const childB = mk('child-b')
    const childC = mk('child-c')
    for (const child of [childA, childB, childC]) {
      addParent(child, parentA)
      addParent(child, parentB)
    }
    const data = createEmptyFamily()
    data.members = Object.fromEntries(
      [parentA, parentB, childA, childB, childC].map(member => [member.id, member]),
    )
    data.siblingOrders['parentage:parent-a+parent-b'] = [
      'child-c',
      'child-a',
      'child-b',
    ]

    expect(siblingOrderGroupsForMember(data, 'child-a')[0].memberIds).toEqual([
      'child-c',
      'child-a',
      'child-b',
    ])
    expect(siblingOrderGroupsForMember(data, 'child-b')[0].memberIds).toEqual([
      'child-c',
      'child-a',
      'child-b',
    ])
  })

  it('drops stale members and appends new siblings deterministically', () => {
    const parent = mk('parent')
    const older = mk('older', { birthDate: '1990-01-01' })
    const younger = mk('younger', { birthDate: '2000-01-01' })
    for (const child of [older, younger]) addParent(child, parent)
    const data = createEmptyFamily()
    data.members = Object.fromEntries([parent, older, younger].map(member => [member.id, member]))
    data.siblingOrders['parentage:parent'] = ['missing', 'younger']

    expect(reconcileSiblingOrders(data)).toEqual({
      'parentage:parent': ['younger', 'older'],
    })
  })

  it('shares one order for explicit siblings without parent data', () => {
    const siblingA = mk('sibling-a')
    const siblingB = mk('sibling-b')
    const siblingC = mk('sibling-c')
    addSibling(siblingA, siblingB)
    addSibling(siblingB, siblingC)
    const data = createEmptyFamily()
    data.members = Object.fromEntries(
      [siblingA, siblingB, siblingC].map(member => [member.id, member]),
    )
    data.siblingOrders['siblings:sibling-a+sibling-b+sibling-c'] = [
      'sibling-c',
      'sibling-a',
      'sibling-b',
    ]

    expect(siblingOrderGroupsForMember(data, 'sibling-a')).toEqual([{
      id: 'siblings:sibling-a+sibling-b+sibling-c',
      parentIds: [],
      memberIds: ['sibling-c', 'sibling-a', 'sibling-b'],
    }])
    expect(siblingOrderGroupsForMember(data, 'sibling-c')[0].memberIds).toEqual([
      'sibling-c',
      'sibling-a',
      'sibling-b',
    ])
  })

  it('merges half siblings from different parentages into one order', () => {
    const sharedParent = mk('shared-parent')
    const otherParentA = mk('other-parent-a')
    const otherParentB = mk('other-parent-b')
    const siblingA = mk('sibling-a')
    const siblingB = mk('sibling-b')
    addParent(siblingA, sharedParent)
    addParent(siblingA, otherParentA)
    addParent(siblingB, sharedParent)
    addParent(siblingB, otherParentB)
    const data = createEmptyFamily()
    data.members = Object.fromEntries([
      sharedParent,
      otherParentA,
      otherParentB,
      siblingA,
      siblingB,
    ].map(member => [member.id, member]))

    const groups = siblingOrderGroupsForMember(data, 'sibling-a')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'siblings:sibling-a+sibling-b',
      memberIds: ['sibling-a', 'sibling-b'],
    })
    expect(groups[0].parentIds).toEqual([
      'other-parent-a',
      'other-parent-b',
      'shared-parent',
    ])
  })
})
