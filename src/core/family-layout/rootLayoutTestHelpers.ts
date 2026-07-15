import { assignGenerations } from './assignGenerations'
import { assignRootAccents } from './assignRootAccents'
import { buildRootDomains } from './buildRootDomains'
import { decorateRootedUnits } from './decorateRootedUnits'
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
  BuildRootDomainsInput,
  DecorateRootedUnitsInput,
  FamilyUnit,
  ParentageGroup,
  PlaceRootDomainsInput,
  ProjectedFamily,
  Rect,
} from './types'
import { DEFAULT_LAYOUT_METRICS, EMPTY_LAYOUT_PREFERENCES } from './types'

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

export function twoRootMultipleMarriagesFixture(): RootFixture {
  const a0 = member('a0')
  const a0Spouse = member('a0-spouse')
  const a1 = member('a1')
  const a2 = member('a2')
  const b0 = member('b0')
  const b0Spouse = member('b0-spouse')
  const b1 = member('b1')
  const b2 = member('b2')

  linkSpouse(a0, a0Spouse)
  linkParent(a1, a0)
  linkParent(a1, a0Spouse)
  linkParent(a2, a0)
  linkParent(a2, a0Spouse)
  linkSpouse(b0, b0Spouse)
  linkParent(b1, b0)
  linkParent(b1, b0Spouse)
  linkParent(b2, b0)
  linkParent(b2, b0Spouse)
  linkSpouse(a1, b1)
  linkSpouse(a2, b2)

  return buildRootFixture([
    a0,
    a0Spouse,
    a1,
    a2,
    b0,
    b0Spouse,
    b1,
    b2,
  ])
}

export function wideThreeFamiliesFixture(): RootFixture {
  const rootA = member('root-a')
  const rootB = member('root-b')
  const members = [rootA, rootB]
  linkSpouse(rootA, rootB)

  for (const branchId of ['a', 'b', 'c']) {
    const branch = member(`branch-${branchId}`)
    const spouse = member(`branch-${branchId}-spouse`)
    const firstChild = member(`branch-${branchId}-child-1`)
    const secondChild = member(`branch-${branchId}-child-2`)
    linkParent(branch, rootA)
    linkParent(branch, rootB)
    linkSpouse(branch, spouse)
    linkParent(firstChild, branch)
    linkParent(firstChild, spouse)
    linkParent(secondChild, branch)
    linkParent(secondChild, spouse)
    members.push(branch, spouse, firstChild, secondChild)
  }

  return buildRootFixture(members)
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

export function singlePersonFixture(): RootFixture {
  return buildRootFixture([member('single')])
}

export function asymmetricRootFixture(): RootFixture {
  const rootA = member('root-a')
  const rootB = member('root-b')
  const leftChild = member('left-child')
  const rightChild = member('right-child')
  const leftGrandchildA = member('left-grandchild-a')
  const leftGrandchildB = member('left-grandchild-b')
  const leftGrandchildC = member('left-grandchild-c')

  linkSpouse(rootA, rootB)
  linkParent(leftChild, rootA)
  linkParent(leftChild, rootB)
  linkParent(rightChild, rootA)
  linkParent(rightChild, rootB)
  linkParent(leftGrandchildA, leftChild)
  linkParent(leftGrandchildB, leftChild)
  linkParent(leftGrandchildC, leftChild)

  return buildRootFixture([
    rootA,
    rootB,
    leftChild,
    rightChild,
    leftGrandchildA,
    leftGrandchildB,
    leftGrandchildC,
  ])
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

export function addedAncestorFixture(): RootFixture {
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

  return buildRootFixture([
    newA0,
    newA0Spouse,
    a0,
    a0Spouse,
    a1,
  ])
}

export function rootAccentInputAfterAddingAncestor(): AssignRootAccentsInput {
  const input = rootAccentInputForFixture(addedAncestorFixture())

  return {
    ...input,
    previousRootIdByRootId: {
      'root:new-a0+new-a0-spouse': 'root:a0+a0-spouse',
    },
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

export function rootDomainInputForFixture(
  fixture: RootFixture,
): BuildRootDomainsInput {
  const accentInput = rootAccentInputForFixture(fixture)
  const accents = assignRootAccents(accentInput)

  return {
    projected: fixture.projected,
    units: fixture.units,
    roots: accentInput.roots,
    signatures: accentInput.signatures,
    accents,
    preferences: accentInput.preferences,
  }
}

export function preparedRootDomains(
  fixture: RootFixture,
  options: { rootOrder?: string[] } = {},
): DecorateRootedUnitsInput {
  const input = rootDomainInputForFixture(fixture)
  const componentId = input.roots.find(root => (
    options.rootOrder?.includes(root.id)
  ))?.componentId
  const preferences = componentId !== undefined && options.rootOrder !== undefined
    ? {
        ...input.preferences,
        rootOrders: [{ componentId, rootIds: options.rootOrder }],
      }
    : input.preferences
  const preparedInput = { ...input, preferences }

  return {
    baseUnits: fixture.units,
    roots: input.roots,
    signatures: input.signatures,
    domains: buildRootDomains(preparedInput),
    accents: input.accents,
    preferences,
  }
}

export function preparedTwoRootLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(twoRootMarriageFixture())
}

export function preparedAsymmetricRootLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(asymmetricRootFixture())
}

export function preparedDenseRootLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(denseThreeRootFixture())
}

export function preparedDisconnectedRootLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(disconnectedRootsFixture())
}

export function preparedSameRootCousinLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(sameRootCousinMarriageFixture())
}

export function preparedUnequalDepthLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(unequalDepthMarriageFixture())
}

export function preparedSinglePersonLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(singlePersonFixture())
}

export function preparedAdoptedRootLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(adoptedPrimaryFixture())
}

export function preparedIncomingSpouseLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(incomingSpouseFixture())
}

export function preparedOverlappingSignatureLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(overlappingSignatureMarriageFixture())
}

export function preparedTwoRootMultipleMarriagesLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(twoRootMultipleMarriagesFixture())
}

export function preparedWideThreeFamiliesLayout(): PlaceRootDomainsInput {
  return preparedRootLayout(wideThreeFamiliesFixture())
}

export function centerX(rect: Rect): number {
  return rect.x + rect.width / 2
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function preparedRootLayout(fixture: RootFixture): PlaceRootDomainsInput {
  const prepared = preparedRootDomains(fixture)
  return {
    units: decorateRootedUnits(prepared),
    parentageGroups: fixture.parentageGroups,
    domains: prepared.domains.domains,
    preferences: prepared.preferences,
    metrics: DEFAULT_LAYOUT_METRICS,
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
