import { describe, expect, it } from 'vitest'
import { placeRootDomains } from './placeRootDomains'
import {
  centerX,
  preparedAsymmetricRootLayout,
  preparedAdoptedRootLayout,
  preparedDenseRootLayout,
  preparedDisconnectedRootLayout,
  preparedIncomingSpouseLayout,
  preparedOverlappingSignatureLayout,
  preparedSameRootCousinLayout,
  preparedSinglePersonLayout,
  preparedTwoRootLayout,
  preparedTwoRootMultipleMarriagesLayout,
  preparedUnequalDepthLayout,
  preparedWideThreeFamiliesLayout,
  rectContains,
} from './rootLayoutTestHelpers'
import type { Rect, SceneGeometry } from './types'

describe('placeRootDomains', () => {
  it('allocates non-interleaving root intervals with visible whitespace', () => {
    const result = placeRootDomains(preparedTwoRootLayout())
    const [left, right] = result.rootDomains

    expect(left.columnEnd).toBeLessThan(right.columnStart)
    expect(right.rect.x - (left.rect.x + left.rect.width))
      .toBeGreaterThanOrEqual(144)
    expect(result.units.every(unit => {
      const domain = [...result.rootDomains, ...result.bridgeDomains]
        .find(value => value.id === unit.domainId)!
      return rectContains(domain.rect, unit.rect)
    })).toBe(true)
  })

  it('centers the root family over its widest descendant branch span', () => {
    const result = placeRootDomains(preparedAsymmetricRootLayout())
    const domain = result.rootDomains[0]
    const rootUnit = result.units.find(unit => unit.isRootFamily)!

    expect(centerX(rootUnit.rect)).toBe(centerX(domain.rect))
  })

  it('keeps a bridge family outside both source root intervals', () => {
    const result = placeRootDomains(preparedTwoRootLayout())
    const bridge = result.units.find(unit => unit.rootSignature.length === 2)!

    expect(result.bridgeDomains.some(domain => domain.id === bridge.domainId))
      .toBe(true)
    expect(result.rootDomains.some(domain => rectContains(domain.rect, bridge.rect)))
      .toBe(false)
  })

  it('places a dense two-root bridge between its source roots instead of at the edge', () => {
    const result = placeRootDomains(preparedTwoRootMultipleMarriagesLayout())
    const roots = [...result.rootDomains].sort((left, right) => (
      left.rect.x - right.rect.x
    ))
    const bridge = result.bridgeDomains[0]

    expect(centerX(bridge.rect)).toBeGreaterThan(centerX(roots[0].rect))
    expect(centerX(bridge.rect)).toBeLessThan(centerX(roots[1].rect))
  })

  it('keeps a multi-root island inside the span of its source roots', () => {
    const result = placeRootDomains(preparedDenseRootLayout())
    const sourceCenters = result.rootDomains.map(domain => centerX(domain.rect))
    const island = result.bridgeDomains[0]

    expect(centerX(island.rect)).toBeGreaterThan(Math.min(...sourceCenters))
    expect(centerX(island.rect)).toBeLessThan(Math.max(...sourceCenters))
  })

  it('applies saved row order only inside the matching root domain row', () => {
    const input = preparedAsymmetricRootLayout()
    const domain = input.domains.find(value => value.kind === 'root')!
    const generation = 2
    const unitIds = [
      'unit:person:left-grandchild-c',
      'unit:person:left-grandchild-b',
      'unit:person:left-grandchild-a',
    ]
    const scene = placeRootDomains({
      ...input,
      preferences: {
        ...input.preferences,
        rowOrders: [{
          id: `row:${domain.id}:${generation}`,
          domainId: domain.id,
          generation,
          unitIds,
        }],
      },
    })

    expect(scene.rows.find(row => row.id === `row:${domain.id}:${generation}`))
      .toEqual({ id: `row:${domain.id}:${generation}`, generation, unitIds })
  })

  it('places a single family unit at its persisted grid column', () => {
    const input = preparedAsymmetricRootLayout()
    const domain = input.domains.find(value => value.kind === 'root')!
    const rootUnit = input.units.find(unit => unit.isRootFamily)!
    const scene = placeRootDomains({
      ...input,
      preferences: {
        ...input.preferences,
        rowOrders: [{
          id: `row:${domain.id}:${rootUnit.generation}`,
          domainId: domain.id,
          generation: rootUnit.generation,
          unitIds: [rootUnit.id],
          columns: { [rootUnit.id]: 0 },
        }],
      },
    })
    const placedDomain = scene.rootDomains.find(value => value.id === domain.id)!
    const placedRoot = scene.units.find(unit => unit.id === rootUnit.id)!

    expect(placedRoot.rect.x).toBe(placedDomain.rect.x + 24)
    expect(centerX(placedRoot.rect)).not.toBe(centerX(placedDomain.rect))
  })

  it('anchors a migrated root to the previous root center', () => {
    const input = preparedSinglePersonLayout()
    const current = placeRootDomains(input)
    const currentDomain = current.rootDomains[0]
    const previousDomain = {
      ...currentDomain,
      id: 'domain:root:previous-single',
      rootIds: ['root:previous-single'],
      signature: ['root:previous-single'],
      rect: { ...currentDomain.rect, x: 240 },
    }
    const previousScene = {
      ...current,
      rootDomains: [previousDomain],
      gateways: [],
      routes: [],
      diagnostics: [],
    }

    const anchored = placeRootDomains({
      ...input,
      previousScene,
      previousRootIdByRootId: {
        [currentDomain.rootIds[0]]: 'root:previous-single',
      },
    })
    const explicitlyOrdered = placeRootDomains({
      ...input,
      previousScene,
      previousRootIdByRootId: {
        [currentDomain.rootIds[0]]: 'root:previous-single',
      },
      preferences: {
        ...input.preferences,
        rootOrders: [{
          componentId: currentDomain.componentId,
          rootIds: [...currentDomain.rootIds],
        }],
      },
    })

    expect(centerX(anchored.rootDomains[0].rect)).toBe(centerX(previousDomain.rect))
    expect(explicitlyOrdered.rootDomains[0].rect.x).toBe(0)
  })

  it('merges overlapping sibling groups without duplicating a family unit', () => {
    const input = preparedWideThreeFamiliesLayout()
    const scene = placeRootDomains({
      ...input,
      parentageGroups: [{
        id: 'parentage:overlap-left',
        sourceUnitId: 'unit:partnership:current:branch-a+branch-a-spouse',
        childPersonIds: ['branch-a-child-1', 'branch-b-child-1'],
      }, {
        id: 'parentage:overlap-right',
        sourceUnitId: 'unit:partnership:current:branch-b+branch-b-spouse',
        childPersonIds: ['branch-b-child-1', 'branch-c-child-1'],
      }],
    })

    expect(scene.units).toHaveLength(input.units.length)
    expect(new Set(scene.units.map(unit => unit.id)).size).toBe(scene.units.length)
    expect(scene.cards).toHaveLength(input.units.flatMap(unit => unit.memberIds).length)
    expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
  })

  it.each([
    ['asymmetric single root', preparedAsymmetricRootLayout],
    ['two-root bridge', preparedTwoRootLayout],
    ['dense three-root island', preparedDenseRootLayout],
    ['disconnected roots', preparedDisconnectedRootLayout],
    ['same-root cousin marriage', preparedSameRootCousinLayout],
    ['unequal source depth', preparedUnequalDepthLayout],
    ['single person', preparedSinglePersonLayout],
    ['adopted primary lineage', preparedAdoptedRootLayout],
    ['suppressed incoming spouse', preparedIncomingSpouseLayout],
    ['overlapping multi-root signatures', preparedOverlappingSignatureLayout],
    ['two roots with multiple marriages', preparedTwoRootMultipleMarriagesLayout],
    ['three same-generation families with children', preparedWideThreeFamiliesLayout],
  ])('keeps cards, units, and domains disjoint for %s', (_, prepare) => {
    const scene = placeRootDomains(prepare())

    expectNoPositiveAreaOverlap(scene.cards.map(card => card.rect))
    expectNoPositiveAreaOverlap(scene.units.map(unit => unit.rect))
    expect(scene.units.every(unit => (
      unit.rect.x % 24 === 0 && unit.rect.y % 24 === 0
    ))).toBe(true)
    expect(scene.units.every(unit => {
      const containingDomains = [...scene.rootDomains, ...scene.bridgeDomains]
        .filter(domain => rectContains(domain.rect, unit.rect))
      return containingDomains.length === 1
        && containingDomains[0].id === unit.domainId
    })).toBe(true)
  })

  it('returns a complete empty rooted geometry for an empty input', () => {
    const input = preparedDisconnectedRootLayout()
    const scene = placeRootDomains({
      ...input,
      units: [],
      domains: [],
      parentageGroups: [],
    })

    expect(scene).toEqual<SceneGeometry>({
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      rootDomains: [],
      bridgeDomains: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  })
})

function expectNoPositiveAreaOverlap(rects: Rect[]): void {
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      const overlaps = Math.min(
        rects[left].x + rects[left].width,
        rects[right].x + rects[right].width,
      ) > Math.max(rects[left].x, rects[right].x)
        && Math.min(
          rects[left].y + rects[left].height,
          rects[right].y + rects[right].height,
        ) > Math.max(rects[left].y, rects[right].y)
      expect(overlaps).toBe(false)
    }
  }
}
