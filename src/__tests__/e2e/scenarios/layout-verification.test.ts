import { describe, expect, it } from 'vitest'
import {
  crossMarriedSiblingsFamily,
  denseBridgeFamily,
  largeFamily,
  manySameGenerationFamilies,
  multiUnionFamily,
  parentageCycleFamily,
  pedigreeCollapseFamily,
} from '@/__tests__/fixtures/families'
import { layoutFamilyTree } from '@/core/treeLayout'
import { createEmptyFamily, type Member } from '@/core/schema'
import { normalizeFacts } from '@/core/family-layout/normalizeFacts'
import { projectView } from '@/core/family-layout/projectView'
import { buildFamilyUnits } from '@/core/family-layout/buildFamilyUnits'
import { assignGenerations } from '@/core/family-layout/assignGenerations'
import { clusterLineages } from '@/core/family-layout/clusterLineages'
import { positiveCollinearOverlap } from '@/core/family-layout/testHelpers'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from '@/core/family-layout/types'

const UNSAFE_DIAGNOSTIC_CODES = new Set([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
])

const fixtures: Array<[string, () => Record<string, Member>]> = [
  ['cross-married siblings', crossMarriedSiblingsFamily],
  ['dense bridge family', denseBridgeFamily],
  ['pedigree collapse', pedigreeCollapseFamily],
  ['many same-generation families', () => manySameGenerationFamilies(5)],
  ['large deterministic family', () => largeFamily(20260711, 500)],
]

describe('public family layout invariants', () => {
  it.each(fixtures)('renders %s once without hard diagnostics', async (_name, fixture) => {
    const members = Object.values(fixture())
    const scene = await layoutFamilyTree(members)

    expect(scene.cards).toHaveLength(members.length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
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

  it('wires cross-married siblings into a bridge cluster through the real pipeline', () => {
    const clusters = clustersFor(crossMarriedSiblingsFamily())

    expect(clusters.filter(cluster => cluster.kind === 'bridge')).toEqual([
      expect.objectContaining({
        unitIds: expect.arrayContaining([
          'unit:partnership:current:a-child-1+b-child-1',
          'unit:partnership:current:a-child-2+b-child-2',
        ]),
      }),
    ])
  })

  it('wires three dense bridges into a supercomponent through the real pipeline', () => {
    const clusters = clustersFor(denseBridgeFamily())

    expect(clusters.some(cluster => (
      cluster.kind === 'supercomponent'
      && cluster.unitIds.includes('unit:partnership:current:a-child-1+b-child-1')
      && cluster.unitIds.includes('unit:partnership:current:a-child-2+b-child-2')
      && cluster.unitIds.includes('unit:partnership:current:a-child-3+b-child-3')
    ))).toBe(true)
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

function clustersFor(family: Record<string, Member>) {
  const data = createEmptyFamily()
  data.members = family
  const normalized = normalizeFacts(data)
  const projected = projectView(normalized.facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(
    projected,
    EMPTY_LAYOUT_PREFERENCES,
    DEFAULT_LAYOUT_METRICS,
  )
  const assigned = assignGenerations(projected, built)
  const units = built.units.map(unit => ({
    ...unit,
    generation: assigned.generationByUnitId[unit.id] ?? 0,
  }))
  return clusterLineages(projected, units, built.parentageGroups)
}

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
