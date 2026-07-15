import { describe, expect, it } from 'vitest'
import { buildRootDomains } from './buildRootDomains'
import {
  denseThreeRootFixture,
  rootDomainInputForFixture,
  sameRootCousinMarriageFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('buildRootDomains', () => {
  it('keeps single-root units in one root domain', () => {
    const result = buildRootDomains(
      rootDomainInputForFixture(sameRootCousinMarriageFixture()),
    )

    expect(result.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'domain:root:a0+a0-spouse',
        kind: 'root',
        rootIds: ['root:a0+a0-spouse'],
      }),
    ]))
    expect(result.domains.some(domain => domain.kind !== 'root')).toBe(false)
  })

  it('uses a pair bridge band for a sparse two-root marriage', () => {
    const result = buildRootDomains(
      rootDomainInputForFixture(twoRootMarriageFixture()),
    )

    expect(result.domains).toContainEqual(expect.objectContaining({
      id: 'domain:bridge:root:a0+a0-spouse|root:b0+b0-spouse',
      kind: 'pair-bridge',
    }))
  })

  it('uses one multi-root island for a dense cyclic network', () => {
    const result = buildRootDomains(
      rootDomainInputForFixture(denseThreeRootFixture()),
    )

    expect(result.domains.filter(domain => domain.kind === 'multi-root-island'))
      .toHaveLength(1)
  })

  it('assigns every family unit to exactly one domain deterministically', () => {
    const input = rootDomainInputForFixture(twoRootMarriageFixture())
    const first = buildRootDomains(input)
    const reversed = buildRootDomains({
      ...input,
      units: [...input.units].reverse(),
      roots: [...input.roots].reverse(),
      signatures: {
        ...input.signatures,
        signatureByPersonId: Object.fromEntries(
          Object.entries(input.signatures.signatureByPersonId).reverse(),
        ),
        signatureByUnitId: Object.fromEntries(
          Object.entries(input.signatures.signatureByUnitId).reverse(),
        ),
      },
    })

    expect(reversed).toEqual(first)
    expect(Object.keys(first.domainIdByUnitId).sort()).toEqual(
      input.units.map(unit => unit.id).sort(),
    )
    expect(first.diagnostics).toEqual([])
  })
})
