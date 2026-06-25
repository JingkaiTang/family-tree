import { describe, expect, it } from 'vitest'
import type { Member } from '@/core/schema'
import { buildFamilyGraphModel } from './familyGraphModel'

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

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

describe('buildFamilyGraphModel', () => {
  it('creates one parent union for a two-parent child group', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkParent(kid, dad)
    linkParent(kid, mom)
    linkSpouse(dad, mom)

    const model = buildFamilyGraphModel([dad, mom, kid])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'parents:dad+mom',
      partnerIds: ['dad', 'mom'],
      childIds: ['kid'],
    })
  })

  it('creates one single-parent union when a child has one known parent', () => {
    const mom = member('mom')
    const kid = member('kid')
    linkParent(kid, mom)

    const model = buildFamilyGraphModel([mom, kid])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'parents:mom',
      partnerIds: ['mom'],
      childIds: ['kid'],
    })
  })

  it('creates a spouse-only union when partners have no child group', () => {
    const a = member('a')
    const b = member('b')
    linkSpouse(a, b)

    const model = buildFamilyGraphModel([a, b])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'spouse:a+b',
      partnerIds: ['a', 'b'],
      childIds: [],
    })
  })

  it('does not create a spouse-only union when spouses share a parent union', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    const kid = member('kid')
    linkParent(kid, a)
    linkParent(kid, b)
    linkParent(kid, c)
    linkSpouse(a, b)

    const model = buildFamilyGraphModel([a, b, c, kid])

    expect(model.unions.map((union) => union.id)).toEqual(['parents:a+b+c'])
  })

  it('orders child ids by birth date then id', () => {
    const dad = member('dad')
    const zEarly = member('z_early', { birthDate: '1990-01-01' })
    const bSameDay = member('b_same_day', { birthDate: '1990-01-01' })
    const aSameDay = member('a_same_day', { birthDate: '1990-01-01' })
    const aLater = member('a_later', { birthDate: '2000-01-01' })
    linkParent(aLater, dad)
    linkParent(zEarly, dad)
    linkParent(bSameDay, dad)
    linkParent(aSameDay, dad)

    const model = buildFamilyGraphModel([dad, aLater, zEarly, bSameDay, aSameDay])

    expect(model.unions[0].childIds).toEqual([
      'a_same_day',
      'b_same_day',
      'z_early',
      'a_later',
    ])
  })

  it('separates disconnected components', () => {
    const a = member('a')
    const b = member('b')

    const model = buildFamilyGraphModel([a, b])

    expect(model.components.map(c => c.personIds)).toEqual([['a'], ['b']])
  })
})
