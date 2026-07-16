import { describe, expect, it } from 'vitest'
import {
  auxiliaryRelationsFamily,
  crossMarriedSiblingsFamily,
  denseBridgeFamily,
  incomingSpouseFamily,
  largeFamily,
  manySameGenerationFamilies,
  multiHistoricalUnionFamily,
  multiUnionFamily,
  overlappingRootSignatureFamily,
  parentageCycleFamily,
  pedigreeCollapseFamily,
  singleRootThreeGenerationFamily,
  threeRootChainFamily,
  threeRootRingFamily,
  twoDisconnectedRootComponents,
  twoRootMarriageFamilyData,
  unequalDepthRootsFamily,
} from '@/__tests__/fixtures/families'
import { syntheticFamily200 } from '@/__tests__/fixtures/syntheticFamily200'
import { layoutFamilyTree, type LayoutScene } from '@/core/treeLayout'
import type { Member } from '@/core/schema'
import { positiveCollinearOverlap } from '@/core/family-layout/testHelpers'
import {
  DEFAULT_LAYOUT_METRICS,
} from '@/core/family-layout/types'
import { validateScene } from '@/core/family-layout/validateScene'

const UNSAFE_DIAGNOSTIC_CODES = new Set([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
  'INVALID_ROOT_DOMAIN_ASSIGNMENT',
  'ROOT_DOMAIN_INTRUSION',
])

const smallFixtures: Array<[string, () => Record<string, Member>]> = [
  ['single root, three generations', singleRootThreeGenerationFamily],
  ['one cross-root marriage', () => twoRootMarriageFamilyData().members],
  ['cross-married siblings', crossMarriedSiblingsFamily],
  ['dense bridge family', denseBridgeFamily],
  ['three-root chain', threeRootChainFamily],
  ['three-root ring', threeRootRingFamily],
  ['overlapping root signatures', overlappingRootSignatureFamily],
  ['pedigree collapse', pedigreeCollapseFamily],
  ['unexpanded incoming spouse', incomingSpouseFamily],
  ['unequal root depth', unequalDepthRootsFamily],
  ['adoption and auxiliary relations', auxiliaryRelationsFamily],
  ['disconnected components', () => twoDisconnectedRootComponents().members],
  ['many same-generation families', () => manySameGenerationFamilies(5)],
]

const fixtures: Array<[string, () => Record<string, Member>]> = [
  ...smallFixtures,
  ['large deterministic family', () => largeFamily(20260711, 500)],
]

describe('public family layout invariants', () => {
  it.each(fixtures)('renders %s once without hard diagnostics', async (_name, fixture) => {
    const members = Object.values(fixture())
    const scene = await layoutFamilyTree(members)

    expectValidRootLayout(scene, members.map(member => member.id))
  })

  it.each(smallFixtures)('is deterministic under input permutations for %s', async (
    _name,
    fixture,
  ) => {
    const members = Object.values(fixture())
    const baseline = await layoutFamilyTree(permutedMembers(members, 0))

    expect(await layoutFamilyTree(permutedMembers(members, 1))).toEqual(baseline)
    expect(await layoutFamilyTree(permutedMembers(members, 2))).toEqual(baseline)
    expect(await layoutFamilyTree(permutedMembers(members, 0))).toEqual(baseline)
  })

  it('retains both cards and diagnoses a parentage cycle', async () => {
    const scene = await layoutFamilyTree(Object.values(parentageCycleFamily()))

    expect(scene.cards.map(card => card.id).sort()).toEqual(['cycle-a', 'cycle-b'])
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.diagnostics.some(diagnostic => (
      diagnostic.code === 'PARENTAGE_CYCLE'
    ))).toBe(true)
  })

  it('renders one current and one historical partnership without hard diagnostics', async () => {
    const family = multiUnionFamily()
    const members = Object.values(family)
    expect(family.childAC.parents.map(parent => parent.id).sort()).toEqual([
      'parentA',
      'parentC',
    ])
    const scene = await layoutFamilyTree(members, {
      view: { showHistoricalPartnerships: true },
      auxiliaryFocusPersonId: 'parentA',
    })

    expect(scene.cards).toHaveLength(members.length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.routes.some(route => route.kind === 'historical-partnership')).toBe(true)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
    expect(new Set(scene.hubs.map(hub => hub.id)).size).toBe(scene.hubs.length)

    const currentRoute = scene.routes.find(route => (
      route.routeOwnerId === 'parentage:parentA+parentB'
    ))!
    const historicalParentageRoute = scene.routes.find(route => (
      route.routeOwnerId === 'parentage:parentA+parentC'
    ))!
    const currentHub = scene.hubs.find(hub => (
      hub.id === 'hub:unit:partnership:current:parentA+parentB'
    ))!
    const historicalParentageHub = scene.hubs.find(hub => (
      hub.id === 'hub:parentage:parentA+parentC'
    ))!
    expect(routeHasEndpoint(currentRoute, currentHub.point)).toBe(true)
    expect(routeHasEndpoint(historicalParentageRoute, historicalParentageHub.point)).toBe(true)
    expect(currentRoute.segments.some(left => (
      historicalParentageRoute.segments.some(right => positiveCollinearOverlap(left, right))
    ))).toBe(false)

    const generations = new Set(['childAB1', 'childAB2', 'childAC'].map(id => (
      scene.cards.find(card => card.id === id)!.generation
    )))
    expect(generations.size).toBe(1)
    const childRow = scene.rows.find(row => row.generation === [...generations][0])!
    const relatedUnitIds = new Set(['childAB1', 'childAB2', 'childAC'].map(id => (
      scene.cards.find(card => card.id === id)!.unitId
    )))
    const boundaryPositions = ['childAB1', 'childAC'].map(id => childRow.unitIds.indexOf(
      scene.cards.find(card => card.id === id)!.unitId,
    ))
    const between = childRow.unitIds.slice(
      Math.min(...boundaryPositions),
      Math.max(...boundaryPositions) + 1,
    )
    expect(between.every(unitId => relatedUnitIds.has(unitId))).toBe(true)
  })

  it('separates repeated historical parentage source ports for one current spouse', async () => {
    const family = multiHistoricalUnionFamily()
    const members = Object.values(family)
    const scene = await layoutFamilyTree(members, {
      view: { showHistoricalPartnerships: true },
      auxiliaryFocusPersonId: 'parentA',
    })

    expect(scene.cards).toHaveLength(members.length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(members.length)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])

    const historicalOwnerIds = [
      'parentage:parentA+parentC',
      'parentage:parentA+parentD',
    ]
    const historicalHubs = historicalOwnerIds.map(ownerId => (
      scene.hubs.find(hub => hub.id === `hub:${ownerId}`)!
    ))
    expect(historicalHubs.map(hub => hub.id)).toEqual([
      'hub:parentage:parentA+parentC',
      'hub:parentage:parentA+parentD',
    ])
    expect(new Set(historicalHubs.map(hub => `${hub.point.x},${hub.point.y}`)).size).toBe(2)

    const historicalRoutes = historicalOwnerIds.map((ownerId, index) => {
      const route = scene.routes.find(value => value.routeOwnerId === ownerId)!
      expect(routeHasEndpoint(route, historicalHubs[index].point)).toBe(true)
      return route
    })
    expect(historicalRoutes[0].segments.some(left => (
      historicalRoutes[1].segments.some(right => positiveCollinearOverlap(left, right))
    ))).toBe(false)
    expect(scene.routes.filter(route => route.kind === 'historical-partnership')).toHaveLength(2)
  })

  it('places multiple sparse cross-root marriages in one bridge band', async () => {
    const scene = await layoutFamilyTree(Object.values(crossMarriedSiblingsFamily()))

    expect(scene.bridgeDomains).toEqual([
      expect.objectContaining({
        kind: 'pair-bridge',
        unitIds: expect.arrayContaining([
          'unit:partnership:current:a-child-1+b-child-1',
          'unit:partnership:current:a-child-2+b-child-2',
        ]),
      }),
    ])
  })

  it('uses a multi-root island for rings and overlapping signatures', async () => {
    const ring = await layoutFamilyTree(Object.values(threeRootRingFamily()))
    const overlapping = await layoutFamilyTree(
      Object.values(overlappingRootSignatureFamily()),
    )
    const mergedUnit = overlapping.units.find(unit => (
      unit.id === 'unit:partnership:current:ab-child+bc-child'
    ))!

    expect(ring.bridgeDomains).toEqual([
      expect.objectContaining({ kind: 'multi-root-island' }),
    ])
    expect(mergedUnit.rootSignature).toHaveLength(3)
    expect(overlapping.bridgeDomains.some(domain => (
      domain.id === mergedUnit.domainId && domain.rootIds.length === 3
    ))).toBe(true)
  })

  it('keeps same-root marriage local and suppresses an incoming spouse root', async () => {
    const sameRoot = await layoutFamilyTree(Object.values(pedigreeCollapseFamily()))
    const incoming = await layoutFamilyTree(Object.values(incomingSpouseFamily()))

    expect(sameRoot.bridgeDomains).toEqual([])
    expect(incoming.rootDomains).toHaveLength(1)
    expect(incoming.bridgeDomains).toEqual([])
  })

  it('adds auxiliary routes without changing primary geometry or routing', async () => {
    const members = Object.values(auxiliaryRelationsFamily())
    const baseline = await layoutFamilyTree(members)
    const focused = await layoutFamilyTree(members, {
      view: {
        showHistoricalPartnerships: true,
        showSecondaryParentage: true,
        showGodparentRelations: true,
      },
      auxiliaryFocusPersonId: 'blood-child',
    })

    expect(primaryGeometry(focused)).toEqual(primaryGeometry(baseline))
    expect(focused.routes.filter(route => route.kind === 'primary'))
      .toEqual(baseline.routes.filter(route => route.kind === 'primary'))
    expect(new Set(focused.routes.filter(route => route.kind !== 'primary')
      .map(route => route.kind))).toEqual(new Set([
      'secondary-parentage',
      'godparent',
    ]))
  })

  it('renders the synthetic 200-person stress project without unsafe fallback', async () => {
    const family = syntheticFamily200()
    const members = Object.values(family.members)
    const scene = await layoutFamilyTree(members, { data: family })

    expectValidRootLayout(scene, members.map(member => member.id))
    expect(scene.rootDomains).toHaveLength(6)
    expect(scene.bridgeDomains).toHaveLength(3)
    expect(scene.routes.filter(route => route.kind === 'primary')).toHaveLength(84)
  })

  it('keeps the synthetic 200-person layout deterministic under member permutations', async () => {
    const family = syntheticFamily200()
    const baseline = await layoutFamilyTree(Object.values(family.members), { data: family })
    const reversed = {
      ...family,
      members: Object.fromEntries(Object.values(family.members)
        .reverse()
        .map(member => [member.id, member])),
    }

    expect(await layoutFamilyTree(Object.values(reversed.members), { data: reversed }))
      .toEqual(baseline)
  })
})

describe('largeFamily fixture', () => {
  it('is deterministic, connected, deep, acyclic, stable and caps parentages', () => {
    const family = largeFamily(20260711, 500)
    const members = Object.values(family)

    expect(largeFamily(20260711, 500)).toEqual(family)
    expect(Object.keys(family)[0]).toBe('person-0001')
    expect(Object.keys(family).at(-1)).toBe('person-0500')
    expect(members).toHaveLength(500)

    const childrenByParentage = new Map<string, number>()
    const generationById = new Map<string, number>()
    for (const child of members) {
      for (const parent of child.parents) {
        expect(Number(parent.id.slice('person-'.length))).toBeLessThan(
          Number(child.id.slice('person-'.length)),
        )
        expect(family[parent.id].birthDate! < child.birthDate!).toBe(true)
      }
      const generation = child.parents.length === 0
        ? 0
        : 1 + Math.max(...child.parents.map(parent => generationById.get(parent.id)!))
      generationById.set(child.id, generation)
      for (const parent of child.parents) {
        expect(generationById.get(parent.id)).toBe(generation - 1)
      }
      if (child.parents.length === 0) continue
      const key = child.parents.map(parent => parent.id).sort().join('+')
      childrenByParentage.set(key, (childrenByParentage.get(key) ?? 0) + 1)
    }
    expect(Math.max(...childrenByParentage.values())).toBeLessThanOrEqual(4)
    const generationCounts = [...generationById.values()].reduce<number[]>((counts, generation) => {
      counts[generation] = (counts[generation] ?? 0) + 1
      return counts
    }, [])
    expect(generationCounts).toEqual([24, ...Array(9).fill(48), 44])
    expect(generationCounts.length - 1).toBeGreaterThanOrEqual(9)

    for (const member of members) {
      for (const spouse of member.spouses.filter(value => value.type === 'married')) {
        if (member.id >= spouse.id) continue
        const spouseMember = family[spouse.id]
        if (member.parents.length === 0 || spouseMember.parents.length === 0) continue
        expect(parentageKey(member)).not.toBe(parentageKey(spouseMember))
      }
    }

    const componentSizes = connectedComponentSizes(family)
    expect(componentSizes.length).toBeLessThanOrEqual(3)
    expect(componentSizes[0]).toBeGreaterThanOrEqual(450)
  })
})

function routeHasEndpoint(
  route: { segments: Array<{ points: Array<{ x: number; y: number }> }> },
  point: { x: number; y: number },
): boolean {
  return route.segments.some(segment => (
    [segment.points[0], segment.points.at(-1)!].some(endpoint => (
      endpoint.x === point.x && endpoint.y === point.y
    ))
  ))
}

function expectValidRootLayout(scene: LayoutScene, expectedPersonIds: string[]) {
  expect(scene.cards.map(card => card.id).sort()).toEqual([...expectedPersonIds].sort())
  expect(new Set(scene.cards.map(card => card.id)).size).toBe(expectedPersonIds.length)
  expect(hasOverlappingRects(scene.cards.map(card => card.rect))).toBe(false)
  expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
  const domains = [...scene.rootDomains, ...scene.bridgeDomains]
  for (const unit of scene.units) {
    const containing = domains.filter(domain => rectContains(domain.rect, unit.rect))
    expect(containing.map(domain => domain.id)).toEqual([unit.domainId])
  }
  const orderedRoots = [...scene.rootDomains].sort((left, right) => (
    left.rect.x - right.rect.x || left.id.localeCompare(right.id)
  ))
  for (let index = 1; index < orderedRoots.length; index += 1) {
    expect(orderedRoots[index - 1].rect.x + orderedRoots[index - 1].rect.width)
      .toBeLessThanOrEqual(orderedRoots[index].rect.x)
  }
  if (scene.routes.length < 100) {
    for (let left = 0; left < scene.routes.length; left += 1) {
      for (let right = left + 1; right < scene.routes.length; right += 1) {
        if (scene.routes[left].routeOwnerId === scene.routes[right].routeOwnerId) continue
        for (const leftSegment of scene.routes[left].segments) {
          for (const rightSegment of scene.routes[right].segments) {
            expect(positiveCollinearOverlap(leftSegment, rightSegment)).toBe(false)
          }
        }
      }
    }
  }
  expect(scene.diagnostics.filter(diagnostic => (
    UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
  ))).toEqual([])
  expect(validateScene(scene, DEFAULT_LAYOUT_METRICS)).toEqual([])
}

function permutedMembers(members: Member[], variant: number): Member[] {
  const cloned = structuredClone(members).map(member => ({
    ...member,
    parents: [...member.parents].reverse(),
    children: [...member.children].reverse(),
    siblings: [...member.siblings].reverse(),
    spouses: [...member.spouses].reverse(),
    godparents: [...member.godparents].reverse(),
    godchildren: [...member.godchildren].reverse(),
  }))
  if (variant === 1) return cloned.reverse()
  if (variant === 2 && cloned.length > 1) return [...cloned.slice(1), cloned[0]]
  return cloned
}

function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function hasOverlappingRects(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
    leftIndex < rightIndex
    && left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  )))
}

function primaryGeometry(scene: LayoutScene) {
  return {
    units: scene.units,
    cards: scene.cards,
    hubs: scene.hubs,
    rows: scene.rows,
    rootDomains: scene.rootDomains,
    bridgeDomains: scene.bridgeDomains,
    gateways: scene.gateways,
    bounds: scene.bounds,
  }
}

function parentageKey(member: Member): string {
  return member.parents.map(parent => parent.id).sort().join('+')
}

function connectedComponentSizes(family: Record<string, Member>): number[] {
  const adjacency = new Map(Object.keys(family).map(id => [id, new Set<string>()]))
  const connect = (leftId: string, rightId: string) => {
    adjacency.get(leftId)?.add(rightId)
    adjacency.get(rightId)?.add(leftId)
  }
  for (const member of Object.values(family)) {
    member.parents.forEach(parent => connect(member.id, parent.id))
    member.spouses.forEach(spouse => connect(member.id, spouse.id))
  }

  const visited = new Set<string>()
  const sizes: number[] = []
  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue
    let size = 0
    const pending = [startId]
    visited.add(startId)
    while (pending.length > 0) {
      const id = pending.pop()!
      size++
      for (const neighborId of adjacency.get(id) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        pending.push(neighborId)
      }
    }
    sizes.push(size)
  }
  return sizes.sort((left, right) => right - left)
}
