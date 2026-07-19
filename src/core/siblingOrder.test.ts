import { describe, expect, it } from 'vitest'
import { createEmptyFamily } from './schema'
import { addParent, mk } from '@/__tests__/fixtures/families'
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
})
