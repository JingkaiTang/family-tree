import { describe, expect, it } from 'vitest'
import { compareIds, decodeIdTuple, encodeIdTuple } from './idEncoding'

describe('derived identifier tuples', () => {
  it('orders distinct IDs even when locale collation considers them equal', () => {
    const ids = ['é', 'e\u0301']
    expect(ids[0].localeCompare(ids[1])).toBe(0)
    expect([...ids].sort(compareIds)).toEqual([...ids].reverse().sort(compareIds))
    expect(compareIds(ids[0], ids[1])).not.toBe(0)
  })
  it('preserves ordinary member and root identifiers without sorting them', () => {
    expect(encodeIdTuple(['b-id', 'a_id'])).toBe('b-id+a_id')
    expect(encodeIdTuple(['root:b', 'root:a'], '|')).toBe('root:b|root:a')
  })

  it('distinguishes the colliding partnerships and literal escape sequences', () => {
    expect(encodeIdTuple(['a', 'b+c'])).toBe('a+b%2Bc')
    expect(encodeIdTuple(['a+b', 'c'])).toBe('a%2Bb+c')
    expect(encodeIdTuple(['a%2Bb', 'c'])).toBe('a%252Bb+c')
    expect(decodeIdTuple('a%252Bb+c')).toEqual(['a%2Bb', 'c'])
  })

  it('distinguishes an empty tuple, empty parts and the literal empty marker', () => {
    expect(encodeIdTuple([])).toBe('')
    expect(encodeIdTuple([''])).toBe('%e')
    expect(encodeIdTuple(['', '%e', ''])).toBe('%e+%25e+%e')
    expect(decodeIdTuple('')).toEqual([])
    expect(decodeIdTuple('%e')).toEqual([''])
    expect(decodeIdTuple('%e+%25e+%e')).toEqual(['', '%e', ''])
  })

  it.each(['+', '|'] as const)('round-trips arbitrary JSON string IDs with %s delimiters', separator => {
    const parts = ['中文', 'a+b|c', '%', '\u0000', '\ud800', '\udfff', '', '😀']
    expect(decodeIdTuple(encodeIdTuple(parts, separator), separator)).toEqual(parts)
  })

  it('escapes each derived root separately when nesting tuples', () => {
    const roots = ['root:a+b%2Bc', 'root:d|e']
    const key = encodeIdTuple(roots, '|')
    expect(key).toBe('root:a+b%252Bc|root:d%7Ce')
    expect(decodeIdTuple(key, '|')).toEqual(roots)
  })

  it.each(['+', 'a+', '+a', '%', '%2b', '%7C', '%unknown', 'a%eb'])('rejects noncanonical plus tuple %s', value => {
    expect(decodeIdTuple(value)).toBeNull()
  })
})
