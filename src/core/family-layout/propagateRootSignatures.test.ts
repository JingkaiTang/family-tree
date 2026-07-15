import { describe, expect, it } from 'vitest'
import { discoverRootFamilies } from './discoverRootFamilies'
import { propagateRootSignatures } from './propagateRootSignatures'
import {
  adoptedPrimaryFixture,
  incomingSpouseFixture,
  overlappingSignatureMarriageFixture,
  sameRootCousinMarriageFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('propagateRootSignatures', () => {
  it('creates a joint signature for a cross-root family and its children', () => {
    const fixture = twoRootMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByUnitId['unit:partnership:current:a2+b1']).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
    expect(result.signatureByPersonId['cross-child']).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
    expect(result.sourceRootIdByPersonId.a2).toBe('root:a0+a0-spouse')
    expect(result.sourceRootIdByPersonId.b1).toBe('root:b0+b0-spouse')
  })

  it('keeps a same-root cousin marriage inside one root signature', () => {
    const fixture = sameRootCousinMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(
      result.signatureByUnitId[
        'unit:partnership:current:left-cousin+right-cousin'
      ],
    ).toEqual(['root:a0+a0-spouse'])
  })

  it('follows the adoptive root for primary adopted parentage', () => {
    const fixture = adoptedPrimaryFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByPersonId.adopted)
      .toEqual(['root:adoptive-a+adoptive-b'])
  })

  it('lets a suppressed incoming spouse inherit the visible partner root', () => {
    const fixture = incomingSpouseFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByPersonId.incoming).toEqual(['root:root-a+root-b'])
    expect(result.signatureByUnitId['unit:partnership:current:descendant+incoming'])
      .toEqual(['root:root-a+root-b'])
  })

  it('unions overlapping cross-root signatures without duplicating the shared root', () => {
    const fixture = overlappingSignatureMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    const expected = [
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
      'root:c0+c0-spouse',
    ]
    expect(result.signatureByUnitId['unit:partnership:current:ab+bc'])
      .toEqual(expected)
    expect(result.signatureByPersonId.abc).toEqual(expected)
  })

  it('ignores auxiliary relation metadata and input array order', () => {
    const fixture = twoRootMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const baseline = propagateRootSignatures({ ...fixture, roots })
    const reordered = propagateRootSignatures({
      ...fixture,
      roots,
      projected: {
        ...fixture.projected,
        people: [...fixture.projected.people].reverse(),
        primaryPartnerships: [...fixture.projected.primaryPartnerships].reverse(),
        primaryParentages: [...fixture.projected.primaryParentages].reverse(),
        auxiliaryRelations: [{
          id: 'aux:historical:a0:b0',
          kind: 'historical-partnership',
          sourceId: 'a0',
          targetId: 'b0',
        }],
      },
      units: [...fixture.units].reverse(),
    })

    expect(reordered).toEqual(baseline)
  })
})
