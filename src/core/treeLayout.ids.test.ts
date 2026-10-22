import { describe, expect, it } from 'vitest'
import { assertFamilyIntegrity } from './familyIntegrity'
import { normalizeFacts } from './family-graph/normalizeFacts'
import { buildLineageIndex, traceLineage } from './family-graph/lineage'
import { familyData, linkParent, linkSpouse, member } from './family-layout/testHelpers'
import { DEFAULT_FAMILY_VIEW_POLICY, DEFAULT_LAYOUT_METRICS } from './family-layout/types'
import { projectView } from './family-layout/projectView'
import { validateScene } from './family-layout/validateScene'
import { layoutFocusFlow } from './focus-flow/layoutFocusFlow'
import { listSiblingOrderGroups, reconcileSiblingOrders } from './siblingOrder'
import { rootSignatureKey } from './family-layout/rootSignatures'
import { layoutFamilyTreeSync } from './treeLayoutCore'
import { createEmptyMeta } from './schema'
import { validateLoadedProject } from '@/services/projectValidation'

const sorted = (ids: readonly string[]) => [...ids].sort((a, b) => a.localeCompare(b))

describe('family layouts with opaque member IDs', () => {
  it.each(['__proto__', 'constructor', 'toString'])('honors the saved primary parent choice for child %s', id => {
    const blood = member('blood')
    const adoptive = member('adoptive')
    const child = member(id)
    linkParent(child, blood, 'blood')
    linkParent(child, adoptive, 'adopted')
    const { family: data } = validateLoadedProject({
      ref: { providerId: 'test', id: 'project', displayName: '测试' },
      meta: createEmptyMeta('测试'),
      family: familyData([blood, adoptive, child], {
        childLayoutAssignments: Object.fromEntries([[id, { primaryParentId: adoptive.id }]]),
      }),
    })

    const scene = layoutFamilyTreeSync(Object.values(data.members), { data })

    expect(scene.primaryParentageGroups?.map(group => group.id)).toEqual(['parentage:adoptive'])
    expect(scene.primaryParentageGroups?.[0].childPersonIds).toEqual([id])
  })

  describe.each(['__proto__', 'constructor', 'toString'])('loaded member ID %s', id => {
    it.each([0, 1, 2])('preserves relationship types and both layouts at generation %s', specialGeneration => {
      const people = [0, 1, 2].map(generation => member(generation === specialGeneration ? id : `person-${generation}`))
      linkParent(people[1], people[0], 'adopted')
      linkParent(people[2], people[1], 'step')
      const data = validateLoadedProject({
        ref: { providerId: 'test', id: 'project', displayName: '测试' },
        meta: createEmptyMeta('测试'),
        family: familyData(people),
      }).family
      const snapshot = JSON.stringify(data)
      const { facts } = normalizeFacts(data)
      for (const child of people.slice(1)) {
        const parent = child.parents[0]
        const parentage = facts.parentages.find(fact => fact.childIds.includes(child.id))!
        expect(Object.hasOwn(parentage.typeByChildId, child.id)).toBe(true)
        expect(parentage.typeByChildId[child.id]).toBe(parent.type)
      }

      const grid = layoutFamilyTreeSync(Object.values(data.members), { data })
      expect(sorted(grid.cards.map(card => card.id))).toEqual(sorted(people.map(person => person.id)))
      for (const [generation, person] of people.entries()) {
        expect(grid.cards.find(card => card.id === person.id)?.generation).toBe(generation)
      }
      expect(validateScene(grid, DEFAULT_LAYOUT_METRICS)).toEqual([])
      for (const child of people.slice(1)) {
        const flow = layoutFocusFlow(data, { focusId: child.id })
        expect(flow.focusId).toBe(child.id)
        expect(flow.sections.find(section => section.kind === 'parents')?.blocks).toContainEqual(
          expect.objectContaining({ memberIds: [child.parents[0].id], parentageType: child.parents[0].type }),
        )
      }
      expect(JSON.stringify(data)).toBe(snapshot)
    })
  })

  it('canonicalizes distinct collation-equivalent member IDs regardless of relation or member order', () => {
    const composed = member('\u00e9')
    const decomposed = member('e\u0301')
    const firstChild = member('child-\u00e9')
    const secondChild = member('child-e\u0301')
    linkSpouse(composed, decomposed)
    linkParent(firstChild, composed)
    linkParent(firstChild, decomposed)
    linkParent(secondChild, decomposed)
    linkParent(secondChild, composed)
    const data = familyData([composed, decomposed, firstChild, secondChild])
    assertFamilyIntegrity(data)

    const { facts } = normalizeFacts(data)
    expect(facts.partnerships).toHaveLength(1)
    expect(facts.parentages).toHaveLength(1)
    expect(facts.parentages[0].childIds).toHaveLength(2)
    const reordered = structuredClone(data)
    reordered.members = Object.fromEntries(Object.entries(reordered.members).reverse())
    for (const person of Object.values(reordered.members)) {
      person.parents.reverse()
      person.children.reverse()
      person.spouses.reverse()
    }
    const reorderedFacts = normalizeFacts(reordered).facts
    expect(reorderedFacts.partnerships).toEqual(facts.partnerships)
    expect(reorderedFacts.parentages).toEqual(facts.parentages)
    expect(listSiblingOrderGroups(reordered)).toEqual(listSiblingOrderGroups(data))
    expect(layoutFamilyTreeSync(Object.values(reordered.members), { data: reordered }))
      .toEqual(layoutFamilyTreeSync(Object.values(data.members), { data }))
    expect(layoutFocusFlow(reordered, { focusId: firstChild.id }))
      .toEqual(layoutFocusFlow(data, { focusId: firstChild.id }))
    expect(rootSignatureKey([composed.id, decomposed.id]))
      .toBe(rootSignatureKey([decomposed.id, composed.id]))
  })

  it('keeps colliding legacy parent and partner tuples separate in both layouts and lineage', () => {
    const a = member('a')
    const bc = member('b+c')
    const ab = member('a+b')
    const c = member('c')
    const firstChild = member('first-child')
    const secondChild = member('second-child')
    linkSpouse(a, bc)
    linkSpouse(ab, c)
    linkParent(firstChild, a)
    linkParent(firstChild, bc)
    linkParent(secondChild, ab)
    linkParent(secondChild, c)
    const data = familyData([a, bc, ab, c, firstChild, secondChild])
    assertFamilyIntegrity(data)

    const { facts } = normalizeFacts(data)
    expect(facts.partnerships).toHaveLength(2)
    expect(facts.parentages).toHaveLength(2)
    expect(new Set(facts.partnerships.map(fact => fact.id)).size).toBe(2)
    expect(new Set(facts.parentages.map(fact => fact.id)).size).toBe(2)
    const grid = layoutFamilyTreeSync(Object.values(data.members), { data })
    expect(grid.units.filter(unit => unit.kind === 'couple')).toHaveLength(2)
    expect(grid.rootDomains).toHaveLength(2)
    expect(new Set(grid.rootDomains.map(domain => domain.id)).size).toBe(2)
    expect(grid.diagnostics).toEqual([])
    expect(validateScene(grid, DEFAULT_LAYOUT_METRICS)).toEqual([])
    for (const [child, parents] of [
      [firstChild, [a, bc]], [secondChild, [ab, c]],
    ] as const) {
      const expectedIds = sorted(parents.map(parent => parent.id))
      expect(sorted(grid.routes
        .filter(route => route.childPaths?.some(path => path.childPersonId === child.id))
        .flatMap(route => route.sourceParentIds ?? []))).toEqual(expectedIds)
      const flow = layoutFocusFlow(data, { focusId: child.id })
      expect(flow.sections.find(section => section.kind === 'parents')?.blocks
        .flatMap(block => block.memberIds)).toEqual(expectedIds)
      expect(traceLineage(buildLineageIndex(facts), child.id).ancestorIds).toEqual(expectedIds)
    }
  })

  it.each(['+', '%', '%2B', '|', ':', '\0', '中文', '\ud800'])('preserves %j inside actual relationship IDs', suffix => {
    const parent = member(`parent${suffix}`)
    const partner = member(`partner${suffix}`)
    const child = member(`child${suffix}`)
    linkSpouse(parent, partner)
    linkParent(child, parent)
    linkParent(child, partner)
    const data = familyData([parent, partner, child])
    assertFamilyIntegrity(data)

    const grid = layoutFamilyTreeSync(Object.values(data.members), { data })
    expect(sorted(grid.cards.map(card => card.id))).toEqual(sorted(Object.keys(data.members)))
    expect(grid.routes.flatMap(route => route.sourceParentIds ?? []).sort()).toEqual([parent.id, partner.id].sort())
    expect(grid.diagnostics).toEqual([])
    const flow = layoutFocusFlow(data, { focusId: child.id })
    expect(flow.sections.find(section => section.kind === 'parents')?.blocks[0].memberIds)
      .toEqual(sorted([parent.id, partner.id]))
  })

  it('preserves independent sibling orders when old joined group IDs collide', () => {
    const ids = ['a', 'b+c', 'a+b', 'c']
    const people = ids.map(id => member(id))
    for (const [left, right] of [[people[0], people[1]], [people[2], people[3]]]) {
      left.siblings.push({ id: right.id, type: 'blood' })
      right.siblings.push({ id: left.id, type: 'blood' })
    }
    const data = familyData(people)
    const groups = listSiblingOrderGroups(data)
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map(group => group.id)).size).toBe(2)
    data.siblingOrders = Object.fromEntries(groups.map(group => [group.id, [...group.memberIds].reverse()]))
    expect(reconcileSiblingOrders(data)).toEqual(data.siblingOrders)
  })

  it('keeps unrelated bridge domains distinct when root IDs contain the signature delimiter', () => {
    const roots = ['a|root:b', 'c', 'a', 'b|root:c'].map(id => member(id))
    const children = roots.map((root, index) => {
      const child = member(`child-${index}`)
      linkParent(child, root)
      return child
    })
    linkSpouse(children[0], children[1])
    linkSpouse(children[2], children[3])
    const data = familyData([...roots, ...children])
    assertFamilyIntegrity(data)

    const grid = layoutFamilyTreeSync(Object.values(data.members), { data })

    expect(grid.cards).toHaveLength(8)
    expect(grid.bridgeDomains).toHaveLength(2)
    expect(new Set(grid.bridgeDomains.map(domain => domain.id)).size).toBe(2)
    expect(grid.diagnostics).toEqual([])
    expect(validateScene(grid, DEFAULT_LAYOUT_METRICS)).toEqual([])
  })

  it('keeps godparent edges with ambiguous greater-than delimiters distinct', () => {
    const sourceA = member('p>a')
    const targetA = member('b')
    const sourceB = member('p')
    const targetB = member('a>b')
    for (const [source, target] of [[sourceA, targetA], [sourceB, targetB]]) {
      source.godchildren.push({ id: target.id, type: 'godchild' })
      target.godparents.push({ id: source.id, type: 'godparent' })
    }
    const data = familyData([sourceA, targetA, sourceB, targetB])
    assertFamilyIntegrity(data)
    const { facts } = normalizeFacts(data)
    const projected = projectView(facts, { ...DEFAULT_FAMILY_VIEW_POLICY, showGodparentRelations: true })
    expect(projected.auxiliaryRelations).toHaveLength(2)
    for (const [source, target] of [[sourceA, targetA], [sourceB, targetB]]) {
      const scene = layoutFamilyTreeSync(Object.values(data.members), {
        data, view: { showGodparentRelations: true }, auxiliaryFocusPersonId: target.id,
      })
      expect(scene.routes.filter(route => route.kind === 'godparent')).toHaveLength(1)
      expect(scene.diagnostics).toEqual([])
      const flow = layoutFocusFlow(data, { focusId: target.id, showAuxiliaryRelations: true })
      expect(flow.sections.find(section => section.kind === 'godparents')?.blocks[0].memberIds).toEqual([source.id])
    }
  })

  it('gives both ancestor blocks distinct keys when parent IDs contain parentage prefixes', () => {
    const firstParent = member('a')
    const secondParent = member('a:parentage:b')
    const firstGrandparent = member('b:parentage:c')
    const secondGrandparent = member('c')
    const child = member('child')
    linkParent(firstParent, firstGrandparent)
    linkParent(secondParent, secondGrandparent)
    linkParent(child, firstParent)
    linkParent(child, secondParent)
    const data = familyData([firstParent, secondParent, firstGrandparent, secondGrandparent, child])
    assertFamilyIntegrity(data)

    const flow = layoutFocusFlow(data, { focusId: child.id, expandedBranchIds: [`ancestors:${child.id}`] })
    const ancestors = flow.sections.find(section => section.kind === 'ancestors')!.blocks

    expect(ancestors).toHaveLength(2)
    expect(new Set(ancestors.map(block => block.id)).size).toBe(2)
    expect(sorted(ancestors.flatMap(block => block.memberIds))).toEqual(sorted([firstGrandparent.id, secondGrandparent.id]))
  })
})
