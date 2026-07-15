import { describe, expect, it } from 'vitest'
import {
  mergeRootSignatures,
  normalizeRootSignature,
  rootSignatureKey,
} from './rootSignatures'

describe('rootSignatures', () => {
  it('deduplicates and sorts roots deterministically', () => {
    expect(normalizeRootSignature(['root:b', 'root:a', 'root:b']))
      .toEqual(['root:a', 'root:b'])
  })

  it('merges overlapping signatures as a set union', () => {
    expect(mergeRootSignatures(['root:a', 'root:b'], ['root:b', 'root:c']))
      .toEqual(['root:a', 'root:b', 'root:c'])
  })

  it('uses an unambiguous stable key', () => {
    expect(rootSignatureKey(['root:b', 'root:a']))
      .toBe('root:a|root:b')
  })
})
