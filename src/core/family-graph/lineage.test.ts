import { describe, expect, it } from 'vitest'
import { addParent, addSpouse, mk } from '@/__tests__/fixtures/families'
import { createEmptyFamily } from '@/core/schema'
import type { FamilyFacts, ParentageFact } from './types'
import { buildLineageIndex, traceLineage } from './lineage'
import { normalizeFacts } from './normalizeFacts'

function parentage(id: string, parentIds: string[], childIds: string[]): ParentageFact {
  return {
    id,
    parentIds,
    childIds,
    typeByChildId: Object.fromEntries(childIds.map(childId => [childId, 'blood'])),
  }
}

function facts(personIds: string[], parentages: ParentageFact[] = []): FamilyFacts {
  return {
    people: personIds.map(id => ({ id, member: mk(id) })),
    partnerships: [],
    parentages,
  }
}

describe('traceLineage', () => {
  it('从选中人物分别向上和向下追踪所有代的直系亲子关系', () => {
    const index = buildLineageIndex(facts([
      'grandparent', 'father', 'mother', 'self', 'child', 'grandchild',
    ], [
      parentage('grandparents', ['grandparent'], ['father']),
      parentage('parents', ['father', 'mother'], ['self']),
      parentage('children', ['self'], ['child']),
      parentage('grandchildren', ['child'], ['grandchild']),
    ]))

    expect(traceLineage(index, 'self')).toEqual({
      personIds: ['child', 'father', 'grandchild', 'grandparent', 'mother', 'self'],
      ancestorIds: ['father', 'grandparent', 'mother'],
      descendantIds: ['child', 'grandchild'],
      parentageChildren: {
        grandparents: ['father'],
        parents: ['self'],
        children: ['child'],
        grandchildren: ['grandchild'],
      },
    })
  })

  it('不从祖先再次向下扩散到兄弟姐妹、叔伯堂亲或他们的支线', () => {
    const index = buildLineageIndex(facts([
      'grandparent', 'parent', 'uncle', 'self', 'sibling', 'cousin', 'niece',
    ], [
      parentage('grandparents', ['grandparent'], ['parent', 'uncle']),
      parentage('parents', ['parent'], ['self', 'sibling']),
      parentage('uncle-family', ['uncle'], ['cousin']),
      parentage('sibling-family', ['sibling'], ['niece']),
    ]))

    expect(traceLineage(index, 'self')).toEqual({
      personIds: ['grandparent', 'parent', 'self'],
      ancestorIds: ['grandparent', 'parent'],
      descendantIds: [],
      parentageChildren: { grandparents: ['parent'], parents: ['self'] },
    })
  })

  it('保留多段婚姻的全部后代，但不纳入共同家长、配偶或后代配偶的祖先', () => {
    const data = facts([
      'self', 'spouse-a', 'spouse-b', 'child-a', 'child-b',
      'child-spouse', 'in-law', 'grandchild',
    ], [
      parentage('first-family', ['self', 'spouse-a'], ['child-a']),
      parentage('second-family', ['self', 'spouse-b'], ['child-b']),
      parentage('child-family', ['child-a', 'child-spouse'], ['grandchild']),
      parentage('in-laws', ['in-law'], ['child-spouse']),
    ])
    data.partnerships = [
      { id: 'marriage-a', partnerIds: ['self', 'spouse-a'], status: 'historical' },
      { id: 'marriage-b', partnerIds: ['self', 'spouse-b'], status: 'current' },
      { id: 'marriage-c', partnerIds: ['child-a', 'child-spouse'], status: 'current' },
    ]

    expect(traceLineage(buildLineageIndex(data), 'self')).toEqual({
      personIds: ['child-a', 'child-b', 'grandchild', 'self'],
      ancestorIds: [],
      descendantIds: ['child-a', 'child-b', 'grandchild'],
      parentageChildren: {
        'first-family': ['child-a'],
        'second-family': ['child-b'],
        'child-family': ['grandchild'],
      },
    })
  })

  it('没有亲子关系时只保留本人，空选中或未知人物则没有高亮', () => {
    const index = buildLineageIndex(facts(['self']))

    expect(traceLineage(index, 'self')).toEqual({
      personIds: ['self'], ancestorIds: [], descendantIds: [], parentageChildren: {},
    })
    for (const personId of ['missing', '', null, undefined]) {
      expect(traceLineage(index, personId)).toEqual({
        personIds: [], ancestorIds: [], descendantIds: [], parentageChildren: {},
      })
    }
  })

  it('共享祖先只出现一次，同时保留到选中人物的每条直系支线', () => {
    const data = facts(['ancestor', 'father', 'mother', 'aunt', 'self'], [
      parentage('shared-ancestor', ['ancestor'], ['mother', 'aunt', 'father']),
      parentage('parents', ['mother', 'father'], ['self']),
    ])
    const expected = {
      personIds: ['ancestor', 'father', 'mother', 'self'],
      ancestorIds: ['ancestor', 'father', 'mother'],
      descendantIds: [],
      parentageChildren: { 'shared-ancestor': ['father', 'mother'], parents: ['self'] },
    }

    expect(traceLineage(buildLineageIndex(data), 'self')).toEqual(expected)
    expect(traceLineage(buildLineageIndex({
      ...data,
      people: [...data.people].reverse(),
      parentages: [...data.parentages].reverse(),
    }), 'self')).toEqual(expected)
  })

  it('异常祖先循环和自引用不会无限遍历，也不会把本人重复当作祖先或后代', () => {
    const index = buildLineageIndex(facts(['a', 'b', 'c'], [
      parentage('a-to-b', ['a'], ['b']),
      parentage('b-to-c', ['b'], ['c']),
      parentage('c-to-a', ['c'], ['a']),
      parentage('self-reference', ['a'], ['a']),
    ]))

    expect(traceLineage(index, 'a')).toEqual({
      personIds: ['a', 'b', 'c'],
      ancestorIds: ['b', 'c'],
      descendantIds: ['b', 'c'],
      parentageChildren: { 'a-to-b': ['b'], 'b-to-c': ['c'], 'c-to-a': ['a'] },
    })
  })

  it('忽略悬空和空 ID，不把无有效父母或子女的组当成关联路径', () => {
    const index = buildLineageIndex(facts(['self', 'child', ''], [
      parentage('missing-child', ['self'], ['missing']),
      parentage('missing-parent', ['missing'], ['self']),
      parentage('valid-family', ['self', 'missing', ''], ['child', '']),
    ]))

    expect(traceLineage(index, 'self')).toEqual({
      personIds: ['child', 'self'],
      ancestorIds: [],
      descendantIds: ['child'],
      parentageChildren: { 'valid-family': ['child'] },
    })
  })

  it('追踪规范化事实中的血缘、收养和继亲关系，但不纳入配偶及干亲', () => {
    const self = mk('self')
    const biologicalParent = mk('biological-parent')
    const adoptiveParent = mk('adoptive-parent')
    const stepParent = mk('step-parent')
    const grandparent = mk('grandparent')
    const child = mk('child')
    const grandchild = mk('grandchild')
    const spouse = mk('spouse')
    const godparent = mk('godparent')
    const godchild = mk('godchild')
    addParent(self, biologicalParent)
    addParent(self, adoptiveParent, 'adopted')
    addParent(self, stepParent, 'step')
    addParent(adoptiveParent, grandparent)
    addParent(child, self, 'adopted')
    addParent(grandchild, child, 'step')
    addSpouse(self, spouse)
    self.godparents.push({ id: godparent.id, type: 'godparent' })
    godparent.godchildren.push({ id: self.id, type: 'godchild' })
    self.godchildren.push({ id: godchild.id, type: 'godchild' })
    godchild.godparents.push({ id: self.id, type: 'godparent' })
    const normalized = normalizeFacts({
      ...createEmptyFamily(),
      members: Object.fromEntries([
        self, biologicalParent, adoptiveParent, stepParent, grandparent,
        child, grandchild, spouse, godparent, godchild,
      ].map(person => [person.id, person])),
    })

    expect(traceLineage(buildLineageIndex(normalized.facts), 'self')).toEqual({
      personIds: [
        'adoptive-parent', 'biological-parent', 'child', 'grandchild', 'grandparent',
        'self', 'step-parent',
      ],
      ancestorIds: ['adoptive-parent', 'biological-parent', 'grandparent', 'step-parent'],
      descendantIds: ['child', 'grandchild'],
      parentageChildren: {
        'parentage:biological-parent': ['self'],
        'parentage:adoptive-parent': ['self'],
        'parentage:step-parent': ['self'],
        'parentage:grandparent': ['adoptive-parent'],
        'parentage:self': ['child'],
        'parentage:child': ['grandchild'],
      },
    })
  })
})
