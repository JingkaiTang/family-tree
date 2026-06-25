import { describe, expect, it } from 'vitest'
import type { Member } from '@/core/schema'
import { layoutConstraintFamilyTree } from './constraintFamilyLayout'

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

function expectNoOverlap(nodes: Array<{ cx: number; top: number }>) {
  const width = 2
  const height = 4
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const overlap = !(
        a.cx + width / 2 <= b.cx - width / 2 ||
        b.cx + width / 2 <= a.cx - width / 2 ||
        a.top + height <= b.top ||
        b.top + height <= a.top
      )
      expect(overlap).toBe(false)
    }
  }
}

describe('layoutConstraintFamilyTree', () => {
  it('returns an empty layout for empty input', async () => {
    const result = await layoutConstraintFamilyTree([])

    expect(result).toEqual({
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
    })
  })

  it('places parents above children', async () => {
    const parent = member('parent')
    const child = member('child')
    linkParent(child, parent)

    const result = await layoutConstraintFamilyTree([child, parent])

    const parentNode = result.nodes.find(node => node.id === 'parent')!
    const childNode = result.nodes.find(node => node.id === 'child')!
    expect(parentNode.top).toBeLessThan(childNode.top)
    expect(parentNode.generation).toBeLessThan(childNode.generation)
  })

  it('keeps spouses on the same row with stable horizontal spacing', async () => {
    const a = member('a')
    const b = member('b')
    linkSpouse(a, b)

    const result = await layoutConstraintFamilyTree([b, a])

    const aNode = result.nodes.find(node => node.id === 'a')!
    const bNode = result.nodes.find(node => node.id === 'b')!
    const distance = Math.abs(aNode.cx - bNode.cx)
    expect(aNode.top).toBe(bNode.top)
    expect(distance).toBeGreaterThanOrEqual(2)
    expect(distance).toBeLessThan(3)
  })

  it('keeps siblings under same parents contiguous and ordered by birthDate', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const a = member('a', { birthDate: '1990-01-01' })
    const b = member('b', { birthDate: '1995-01-01' })
    const c = member('c', { birthDate: '2000-01-01' })
    linkSpouse(dad, mom)
    for (const child of [c, a, b]) {
      linkParent(child, dad)
      linkParent(child, mom)
    }

    const result = await layoutConstraintFamilyTree([dad, mom, c, b, a])

    const siblingNodes = result.nodes
      .filter(node => ['a', 'b', 'c'].includes(node.id))
      .sort((left, right) => left.cx - right.cx)
    expect(siblingNodes.map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(siblingNodes.every(node => node.top === siblingNodes[0].top)).toBe(true)
  })

  it('does not overlap nodes in a three-generation family', async () => {
    const grandpa = member('grandpa')
    const grandma = member('grandma')
    const dad = member('dad')
    const mom = member('mom')
    const childA = member('childA')
    const childB = member('childB')
    linkSpouse(grandpa, grandma)
    linkSpouse(dad, mom)
    linkParent(dad, grandpa)
    linkParent(dad, grandma)
    linkParent(childA, dad)
    linkParent(childA, mom)
    linkParent(childB, dad)
    linkParent(childB, mom)

    const result = await layoutConstraintFamilyTree([
      childB,
      mom,
      grandma,
      childA,
      dad,
      grandpa,
    ])

    expectNoOverlap(result.nodes)
  })

  it('separates disconnected components horizontally', async () => {
    const leftParent = member('leftParent')
    const leftChild = member('leftChild')
    const rightParent = member('rightParent')
    const rightChild = member('rightChild')
    linkParent(leftChild, leftParent)
    linkParent(rightChild, rightParent)

    const result = await layoutConstraintFamilyTree([
      rightChild,
      leftChild,
      rightParent,
      leftParent,
    ])

    const leftNodes = result.nodes.filter(node => node.id.startsWith('left'))
    const rightNodes = result.nodes.filter(node => node.id.startsWith('right'))
    const leftRight = Math.max(...leftNodes.map(node => node.cx + 1))
    const rightLeft = Math.min(...rightNodes.map(node => node.cx - 1))
    expect(rightLeft - leftRight).toBeGreaterThanOrEqual(3.5)
  })

  it('uses component union ids without duplicating a person in multiple unions', async () => {
    const parentA = member('parentA')
    const parentB = member('parentB')
    const parentC = member('parentC')
    const childAB = member('childAB')
    const childAC = member('childAC')
    linkSpouse(parentA, parentB)
    linkSpouse(parentA, parentC)
    linkParent(childAB, parentA)
    linkParent(childAB, parentB)
    linkParent(childAC, parentA)
    linkParent(childAC, parentC)

    const result = await layoutConstraintFamilyTree([
      parentC,
      childAC,
      parentA,
      childAB,
      parentB,
    ])

    expect(result.nodes.filter(node => node.id === 'parentA')).toHaveLength(1)
    expect(result.nodes.filter(node => node.id === 'childAB')).toHaveLength(1)
    expect(result.nodes.filter(node => node.id === 'childAC')).toHaveLength(1)
    expect(result.nodes.map(node => node.id).sort()).toEqual([
      'childAB',
      'childAC',
      'parentA',
      'parentB',
      'parentC',
    ])

    const parentANode = result.nodes.find(node => node.id === 'parentA')!
    const childABNode = result.nodes.find(node => node.id === 'childAB')!
    const childACNode = result.nodes.find(node => node.id === 'childAC')!
    expect(childABNode.top).toBeGreaterThan(parentANode.top)
    expect(childACNode.top).toBeGreaterThan(parentANode.top)
    expectNoOverlap(result.nodes)
  })
})
