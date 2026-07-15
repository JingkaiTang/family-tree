import { describe, expect, it } from 'vitest'
import { assignRootAccents } from './assignRootAccents'
import {
  rootAccentInputAfterAddingAncestor,
  rootAccentInputForFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('assignRootAccents', () => {
  it('keeps adjacent roots distinguishable and deterministic', () => {
    const input = rootAccentInputForFixture(twoRootMarriageFixture())
    const first = assignRootAccents(input)
    const second = assignRootAccents(input)

    expect(second).toEqual(first)
    expect(first['root:a0+a0-spouse'])
      .not.toBe(first['root:b0+b0-spouse'])
  })

  it('is independent of root and signature input order', () => {
    const input = rootAccentInputForFixture(twoRootMarriageFixture())
    const reversed = {
      ...input,
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
    }

    expect(assignRootAccents(reversed)).toEqual(assignRootAccents(input))
  })

  it('inherits the previous accent when a newly added ancestor moves the root upward', () => {
    const result = assignRootAccents(rootAccentInputAfterAddingAncestor())

    expect(result['root:new-a0+new-a0-spouse']).toBe('#4F7CAC')
  })

  it('does not inherit an unrelated previous root accent below the overlap threshold', () => {
    const input = rootAccentInputAfterAddingAncestor()
    const result = assignRootAccents({
      ...input,
      previousScene: {
        rootDomains: [{
          id: 'domain:old-unrelated-root',
          rootIds: ['root:old-unrelated-root'],
          personIds: ['unrelated'],
          accent: '#123456',
        }],
      },
    })

    expect(result['root:new-a0+new-a0-spouse']).not.toBe('#123456')
  })

  it('uses an explicit discovered root migration before overlap fallback', () => {
    const input = rootAccentInputAfterAddingAncestor()
    const result = assignRootAccents({
      ...input,
      previousRootIdByRootId: {
        'root:new-a0+new-a0-spouse': 'root:old-a0+old-a0-spouse',
      },
      previousScene: {
        rootDomains: [{
          id: 'domain:root:old-a0+old-a0-spouse',
          rootIds: ['root:old-a0+old-a0-spouse'],
          personIds: ['no-overlap'],
          accent: '#123456',
        }],
      },
    })

    expect(result['root:new-a0+new-a0-spouse']).toBe('#123456')
  })
})
