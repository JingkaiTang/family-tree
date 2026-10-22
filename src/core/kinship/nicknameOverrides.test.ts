import { describe, expect, it } from 'vitest'
import { mk } from '@/__tests__/fixtures/families'
import { getKinship } from './index'

describe('kinship override lookup', () => {
  it.each([
    ['constructor', 'toString'],
    ['__proto__', 'constructor'],
    ['normal', 'constructor'],
    ['normal', 'toString'],
  ])('ignores inherited overrides from %s to %s', (fromId, toId) => {
    const members = Object.fromEntries([fromId, toId].map(id => [id, mk(id)]))
    expect(getKinship(fromId, toId, members, { normal: {} })).toBeNull()
  })

  it('rejects nonexistent inherited members before looking for a relationship', () => {
    const members = { normal: mk('normal') }
    expect(getKinship('constructor', 'normal', members)).toBeNull()
    expect(getKinship('normal', '__proto__', members)).toBeNull()
  })
})
