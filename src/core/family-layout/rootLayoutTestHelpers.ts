import { assignGenerations } from './assignGenerations'
import { discoverRootFamilies } from './discoverRootFamilies'
import { propagateRootSignatures } from './propagateRootSignatures'
import {
  buildProjectedInput,
  familyData,
  linkParent,
  linkSpouse,
  member,
} from './testHelpers'
import type {
  AssignRootAccentsInput,
  FamilyUnit,
  ParentageGroup,
  ProjectedFamily,
} from './types'
import { EMPTY_LAYOUT_PREFERENCES } from './types'

export interface RootFixture {
  projected: ProjectedFamily
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  generationByUnitId: Record<string, number>
}

export function twoRootMarriageFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const a1 = member('a1')
  const a2 = member('a2')
  const b0 = member('b0')
  const b0Spouse = member('b0-spouse')
  const b1 = member('b1')
  const crossChild = member('cross-child')

  linkSpouse(a0, a0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)
  linkParent(a2, a1)
  linkSpouse(b0, b0Spouse)
  linkParent(b1, b0)
  linkParent(b1, b0Spouse)
  linkSpouse(a2, b1)
  linkParent(crossChild, a2)
  linkParent(crossChild, b1)

  return buildRootFixture([
    a0,
    a0Spouse,
    a1,
    a2,
    b0,
    b0Spouse,
    b1,
    crossChild,
  ])
}

export function unequalDepthMarriageFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const a1 = member('a1')
  const a2 = member('a2')
  const a3 = member('a3')
  const b0 = member('b0')
  const b0Spouse = member('b0-spouse')
  const b1 = member('b1')

  linkSpouse(a0, a0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)
  linkParent(a2, a1)
  linkParent(a3, a2)
  linkSpouse(b0, b0Spouse)
  linkParent(b1, b0)
  linkParent(b1, b0Spouse)
  linkSpouse(a3, b1)

  return buildRootFixture([a0, a0Spouse, a1, a2, a3, b0, b0Spouse, b1])
}

export function sameRootCousinMarriageFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const leftParent = member('left-parent')
  const rightParent = member('right-parent')
  const leftCousin = member('left-cousin')
  const rightCousin = member('right-cousin')

  linkSpouse(a0, a0Spouse)
  linkParent(leftParent, a0)
  linkParent(leftParent, a0Spouse)
  linkParent(rightParent, a0)
  linkParent(rightParent, a0Spouse)
  linkParent(leftCousin, leftParent)
  linkParent(rightCousin, rightParent)
  linkSpouse(leftCousin, rightCousin)

  return buildRootFixture([
    a0,
    a0Spouse,
    leftParent,
    rightParent,
    leftCousin,
    rightCousin,
  ])
}

export function denseThreeRootFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const b0 = member('b0')
  const b0Spouse = member('b0-spouse')
  const c0 = member('c0')
  const c0Spouse = member('c0-spouse')
  const aAb = member('a-ab')
  const bAb = member('b-ab')
  const bBc = member('b-bc')
  const cBc = member('c-bc')
  const aAc = member('a-ac')
  const cAc = member('c-ac')

  linkSpouse(a0, a0Spouse)
  linkSpouse(b0, b0Spouse)
  linkSpouse(c0, c0Spouse)
  linkParent(aAb, a0)
  linkParent(aAb, a0Spouse)
  linkParent(aAc, a0)
  linkParent(aAc, a0Spouse)
  linkParent(bAb, b0)
  linkParent(bAb, b0Spouse)
  linkParent(bBc, b0)
  linkParent(bBc, b0Spouse)
  linkParent(cBc, c0)
  linkParent(cBc, c0Spouse)
  linkParent(cAc, c0)
  linkParent(cAc, c0Spouse)
  linkSpouse(aAb, bAb)
  linkSpouse(bBc, cBc)
  linkSpouse(aAc, cAc)

  return buildRootFixture([
    a0,
    a0Spouse,
    b0,
    b0Spouse,
    c0,
    c0Spouse,
    aAb,
    bAb,
    bBc,
    cBc,
    aAc,
    cAc,
  ])
}

export function adoptedPrimaryFixture(): RootFixture {
  const adoptiveA = member('adoptive-a')
  const adoptiveB = member('adoptive-b')
  const adopted = member('adopted')

  linkSpouse(adoptiveA, adoptiveB)
  linkParent(adopted, adoptiveA, 'adopted')
  linkParent(adopted, adoptiveB, 'adopted')

  return buildRootFixture([adoptiveA, adoptiveB, adopted])
}

export function incomingSpouseFixture(): RootFixture {
  const rootA = member('root-a')
  const rootB = member('root-b')
  const descendant = member('descendant')
  const incoming = member('incoming')

  linkSpouse(rootA, rootB)
  linkParent(descendant, rootA)
  linkParent(descendant, rootB)
  linkSpouse(descendant, incoming)

  return buildRootFixture([rootA, rootB, descendant, incoming])
}

export function overlappingSignatureMarriageFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const b0 = member('b0')
  const b0Spouse = member('b0-spouse')
  const c0 = member('c0')
  const c0Spouse = member('c0-spouse')
  const a1 = member('a1')
  const b1Left = member('b1-left')
  const b1Right = member('b1-right')
  const c1 = member('c1')
  const ab = member('ab')
  const bc = member('bc')
  const abc = member('abc')

  linkSpouse(a0, a0Spouse)
  linkSpouse(b0, b0Spouse)
  linkSpouse(c0, c0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)
  linkParent(b1Left, b0)
  linkParent(b1Left, b0Spouse)
  linkParent(b1Right, b0)
  linkParent(b1Right, b0Spouse)
  linkParent(c1, c0)
  linkParent(c1, c0Spouse)
  linkSpouse(a1, b1Left)
  linkParent(ab, a1)
  linkParent(ab, b1Left)
  linkSpouse(b1Right, c1)
  linkParent(bc, b1Right)
  linkParent(bc, c1)
  linkSpouse(ab, bc)
  linkParent(abc, ab)
  linkParent(abc, bc)

  return buildRootFixture([
    a0,
    a0Spouse,
    b0,
    b0Spouse,
    c0,
    c0Spouse,
    a1,
    b1Left,
    b1Right,
    c1,
    ab,
    bc,
    abc,
  ])
}

export function disconnectedRootsFixture(): RootFixture {
  const leftA = member('left-a')
  const leftB = member('left-b')
  const rightA = member('right-a')
  const rightB = member('right-b')

  linkSpouse(leftA, leftB)
  linkSpouse(rightA, rightB)

  return buildRootFixture([leftA, leftB, rightA, rightB])
}

export function rootAccentInputForFixture(
  fixture: RootFixture,
): AssignRootAccentsInput {
  const discovery = discoverRootFamilies(fixture)
  const signatures = propagateRootSignatures({
    ...fixture,
    roots: discovery,
  })

  return {
    roots: discovery.roots,
    signatures,
    preferences: EMPTY_LAYOUT_PREFERENCES,
  }
}

export function rootAccentInputAfterAddingAncestor(): AssignRootAccentsInput {
  const newA0 = member('new-a0')
  const newA0Spouse = member('new-a0-spouse')
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const a1 = member('a1')

  linkSpouse(newA0, newA0Spouse)
  linkParent(a0, newA0)
  linkParent(a0, newA0Spouse)
  linkSpouse(a0, a0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)

  const input = rootAccentInputForFixture(buildRootFixture([
    newA0,
    newA0Spouse,
    a0,
    a0Spouse,
    a1,
  ]))

  return {
    ...input,
    previousScene: {
      rootDomains: [{
        id: 'domain:root:a0+a0-spouse',
        rootIds: ['root:a0+a0-spouse'],
        personIds: ['a0', 'a0-spouse', 'a1'],
        accent: '#4F7CAC',
      }],
    },
  }
}

function buildRootFixture(members: ReturnType<typeof member>[]): RootFixture {
  const { projected, built } = buildProjectedInput(familyData(members))
  const generations = assignGenerations(projected, built)
  const units = built.units.map(unit => ({
    ...unit,
    generation: generations.generationByUnitId[unit.id] ?? 0,
  }))

  return {
    projected,
    units,
    parentageGroups: built.parentageGroups,
    generationByUnitId: generations.generationByUnitId,
  }
}
