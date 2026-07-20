import { describe, expect, it } from 'vitest'
import {
  auxiliaryRelationsFamily,
  extendedFamily,
  largeFamily,
  multiUnionFamily,
  threeGenFamily,
  twoDisconnectedRootComponents,
} from '@/__tests__/fixtures/families'
import { createEmptyFamily } from '@/core/schema'
import { layoutFocusFlow } from './layoutFocusFlow'

describe('layoutFocusFlow', () => {
  it('projects a deterministic one-hop family neighborhood around the focus', () => {
    const data = { ...createEmptyFamily(), members: threeGenFamily() }
    const scene = layoutFocusFlow(data, { focusId: 'self' })

    expect(scene.kind).toBe('focus-flow')
    expect(scene.focusId).toBe('self')
    expect(scene.sections.map(section => section.kind)).toEqual(['parents', 'focus'])
    expect(scene.sections[0].blocks).toMatchObject([{
      kind: 'couple',
      memberIds: ['dad', 'mom'],
      parentageType: 'blood',
    }])
    expect(scene.sections[1].blocks[0].memberIds).toEqual(['self'])
    expect(scene.branches).toContainEqual({
      id: 'ancestors:self',
      kind: 'ancestors',
      label: '更早的祖辈',
      count: 4,
      expanded: false,
    })
    expect(layoutFocusFlow(data, { focusId: 'self' })).toEqual(scene)
  })

  it('keeps the focus couple and child couples inside indivisible blocks', () => {
    const members = threeGenFamily()
    members.self.spouses.push({ id: 'partner', type: 'married' })
    members.partner = {
      ...members.self,
      id: 'partner',
      firstName: 'partner',
      parents: [],
      children: [],
      spouses: [{ id: 'self', type: 'married' }],
    }
    const data = { ...createEmptyFamily(), members }
    const scene = layoutFocusFlow(data, { focusId: 'dad' })

    expect(scene.sections.find(section => section.kind === 'focus')?.blocks[0]).toMatchObject({
      kind: 'couple',
      memberIds: ['dad', 'mom'],
    })
    expect(scene.sections.find(section => section.kind === 'children')?.blocks[0]).toMatchObject({
      kind: 'couple',
      memberIds: ['self', 'partner'],
    })
  })

  it('uses shared sibling preferences before birth date and id fallback', () => {
    const data = { ...createEmptyFamily(), members: extendedFamily() }
    data.siblingOrders = {
      'parentage:dad+mom': ['sis', 'self', 'bro'],
    }
    const scene = layoutFocusFlow(data, { focusId: 'self' })
    const siblingOwners = scene.sections
      .find(section => section.kind === 'siblings')
      ?.blocks.map(block => block.memberIds[0])

    expect(siblingOwners).toEqual(['sis', 'bro'])
  })

  it('preserves multi-union context and exposes historical partnerships progressively', () => {
    const data = { ...createEmptyFamily(), members: multiUnionFamily() }
    const collapsed = layoutFocusFlow(data, { focusId: 'parentA' })

    expect(collapsed.sections.find(section => section.kind === 'focus')?.blocks[0].memberIds)
      .toEqual(['parentA', 'parentB'])
    expect(collapsed.sections.find(section => section.kind === 'children')?.blocks
      .map(block => block.memberIds[0]))
      .toEqual(['childAB1', 'childAB2', 'childAC'])
    expect(collapsed.branches).toContainEqual({
      id: 'historical:parentA',
      kind: 'historical',
      label: '历史伴侣',
      count: 1,
      expanded: false,
    })

    const expanded = layoutFocusFlow(data, {
      focusId: 'parentA',
      expandedBranchIds: ['historical:parentA'],
    })
    expect(expanded.sections.find(section => section.kind === 'historical')?.blocks[0])
      .toMatchObject({ kind: 'couple', memberIds: ['parentA', 'parentC'] })
  })

  it('keeps adopted, step and godparent relationships visible without grid preferences', () => {
    const data = { ...createEmptyFamily(), members: auxiliaryRelationsFamily() }
    data.layoutPreferences.rowOrders.push({
      id: 'grid-only',
      domainId: 'grid-only',
      generation: 0,
      unitIds: ['unit:grid-only'],
    })

    const bloodChild = layoutFocusFlow(data, {
      focusId: 'blood-child',
      expandedBranchIds: ['godparents:blood-child'],
    })
    expect(bloodChild.sections.find(section => section.kind === 'parents')?.blocks
      .map(value => value.parentageType))
      .toEqual(['blood', 'step'])
    expect(bloodChild.sections.find(section => section.kind === 'godparents')?.blocks[0]
      .memberIds[0])
      .toBe('godparent')

    const adoptedChild = layoutFocusFlow(data, { focusId: 'adopted-child' })
    expect(adoptedChild.sections.find(section => section.kind === 'parents')?.blocks[0]
      .parentageType)
      .toBe('adopted')
    expect(JSON.stringify(bloodChild)).not.toContain('grid-only')
  })

  it('caps wide core branches until explicitly expanded', () => {
    const members = extendedFamily()
    for (let index = 1; index <= 6; index += 1) {
      const id = `extra-${index}`
      members[id] = {
        ...members.self,
        id,
        firstName: id,
        parents: [
          { id: 'dad', type: 'blood' },
          { id: 'mom', type: 'blood' },
        ],
        children: [],
        siblings: [],
        spouses: [],
      }
      members.dad.children.push({ id, type: 'blood' })
      members.mom.children.push({ id, type: 'blood' })
    }
    const data = { ...createEmptyFamily(), members }
    const collapsed = layoutFocusFlow(data, { focusId: 'self' })
    const collapsedSiblings = collapsed.sections.find(section => section.kind === 'siblings')!

    expect(collapsedSiblings.blocks).toHaveLength(4)
    expect(collapsedSiblings.branch).toMatchObject({
      id: 'siblings:self',
      totalCount: 8,
      visibleCount: 4,
      expanded: false,
    })

    const expanded = layoutFocusFlow(data, {
      focusId: 'self',
      expandedBranchIds: ['siblings:self'],
    })
    expect(expanded.sections.find(section => section.kind === 'siblings')?.blocks).toHaveLength(8)
  })

  it('keeps disconnected and large projects local to the visible focus neighborhood', () => {
    const disconnected = twoDisconnectedRootComponents()
    expect(layoutFocusFlow(disconnected, { focusId: 'a' }).sections
      .flatMap(section => section.blocks)
      .flatMap(block => block.memberIds))
      .not.toContain('b')

    const data = { ...createEmptyFamily(), members: largeFamily(23, 500) }
    const first = layoutFocusFlow(data, { focusId: 'person-0001' })
    const second = layoutFocusFlow(data, { focusId: 'person-0001' })
    expect(second).toEqual(first)
    expect(first.sections.flatMap(section => section.blocks).flatMap(block => block.memberIds).length)
      .toBeLessThan(50)
  })
})
