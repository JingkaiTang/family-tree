import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { normalizeFacts } from './family-layout/normalizeFacts'
import { layoutFamilyTree } from './treeLayout'

describe('layoutFamilyTree mixed parentage', () => {
  it('preserves each relation type in a separate reasonable parentage group', () => {
    const data = mixedParentageFamily()

    const normalized = normalizeFacts(data)

    expect(normalized.facts.parentages).toEqual([
      {
        id: 'parentage:adoptive-parent',
        parentIds: ['adoptive-parent'],
        childIds: ['child'],
        typeByChildId: { child: 'adopted' },
      },
      {
        id: 'parentage:blood-a+blood-b',
        parentIds: ['blood-a', 'blood-b'],
        childIds: ['child'],
        typeByChildId: { child: 'blood' },
      },
      {
        id: 'parentage:step-parent',
        parentIds: ['step-parent'],
        childIds: ['child'],
        typeByChildId: { child: 'step' },
      },
    ])
  })

  it('keeps the blood couple primary and exposes adoptive and step parents as secondary', async () => {
    const data = mixedParentageFamily()

    const scene = await layoutFamilyTree(Object.values(data.members), {
      data,
      view: { showSecondaryParentage: true },
      auxiliaryFocusPersonId: 'child',
    })

    expect(scene.cards.map(card => card.id).sort()).toEqual([
      'adoptive-parent',
      'blood-a',
      'blood-b',
      'child',
      'step-parent',
    ])
    expect(Object.fromEntries(scene.cards.map(card => [card.id, card.generation]))).toEqual({
      'adoptive-parent': 0,
      'blood-a': 0,
      'blood-b': 0,
      child: 1,
      'step-parent': 0,
    })
    expect(scene.units).toContainEqual(expect.objectContaining({
      id: 'unit:partnership:current:blood-a+blood-b',
      kind: 'couple',
      memberIds: ['blood-a', 'blood-b'],
      generation: 0,
    }))
    expect(scene.routes.map(route => ({
      owner: route.routeOwnerId,
      kind: route.kind,
    }))).toEqual([
      {
        owner: 'parentage:blood-a+blood-b',
        kind: 'primary',
      },
      {
        owner: 'aux:parentage:adoptive-parent:adoptive-parent:child',
        kind: 'secondary-parentage',
      },
      {
        owner: 'aux:parentage:step-parent:step-parent:child',
        kind: 'secondary-parentage',
      },
    ])
  })
})

function mixedParentageFamily(): FamilyData {
  const bloodA = member('blood-a')
  const bloodB = member('blood-b')
  const adoptiveParent = member('adoptive-parent')
  const stepParent = member('step-parent')
  const child = member('child')
  linkSpouse(bloodA, bloodB)
  linkParent(child, bloodA, 'blood')
  linkParent(child, bloodB, 'blood')
  linkParent(child, adoptiveParent, 'adopted')
  linkParent(child, stepParent, 'step')
  const data = createEmptyFamily()
  data.members = Object.fromEntries([
    stepParent,
    child,
    bloodB,
    adoptiveParent,
    bloodA,
  ].map(value => [value.id, value]))
  return data
}

function member(id: string): Member {
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
  }
}

function linkSpouse(left: Member, right: Member) {
  left.spouses.push({ id: right.id, type: 'married' })
  right.spouses.push({ id: left.id, type: 'married' })
}

function linkParent(
  child: Member,
  parent: Member,
  type: Member['parents'][number]['type'],
) {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}
