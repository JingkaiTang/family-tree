import { describe, expect, it } from 'vitest'
import { mk } from '@/__tests__/fixtures/families'
import { createEmptyFamily, FamilyData } from './schema'

describe('family string-keyed records', () => {
  it.each(['__proto__', 'constructor', 'toString'])('preserves the own key %s in every project dictionary', id => {
    const family = {
      ...createEmptyFamily(),
      members: Object.fromEntries([[id, mk(id)]]),
      nicknameOverrides: Object.fromEntries([[id, Object.fromEntries([[id, '本人']])]]),
      siblingOrders: Object.fromEntries([[id, [id]]]),
      manualPositions: Object.fromEntries([[id, { cx: 1, top: 2 }]]),
      childLayoutAssignments: Object.fromEntries([[id, { primaryParentId: id }]]),
      gridLayoutOverrides: Object.fromEntries([[id, { order: 1 }]]),
      layoutPreferences: {
        rootOrders: [],
        bridgeOrders: [],
        rowOrders: [{ id: 'row', domainId: 'domain', generation: 0, unitIds: [id], columns: Object.fromEntries([[id, 1]]) }],
        rootAccentAssignments: Object.fromEntries([[id, '#123456']]),
        familyAccentAssignments: Object.fromEntries([[id, '#654321']]),
      },
    }
    const before = JSON.stringify(family)

    const parsed = FamilyData.parse(JSON.parse(before))

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(family)
    expect(Object.hasOwn(parsed.members, id)).toBe(true)
    expect(Object.getPrototypeOf(parsed.members)).toBe(Object.prototype)
    expect(JSON.stringify(family)).toBe(before)
  })

  it('validates values under __proto__ and reports their original field paths', () => {
    const invalid = FamilyData.safeParse({
      ...createEmptyFamily(),
      members: Object.fromEntries([['__proto__', { ...mk('__proto__'), firstName: 42 }]]),
      nicknameOverrides: Object.fromEntries([['__proto__', Object.fromEntries([['__proto__', 42]])]]),
    })

    expect(invalid.success).toBe(false)
    if (invalid.success) throw new Error('Expected invalid record values to be rejected')
    expect(invalid.error.issues.map(issue => issue.path)).toEqual([
      ['members', '__proto__', 'firstName'],
      ['nicknameOverrides', '__proto__', '__proto__'],
    ])
  })

  it('ignores inherited and non-enumerable keys without polluting object prototypes', () => {
    const members = Object.create({ inherited: mk('inherited') })
    Object.defineProperty(members, '__proto__', { value: mk('__proto__'), enumerable: false })
    const before = Object.getOwnPropertyDescriptors(Object.prototype)

    const parsed = FamilyData.parse({ ...createEmptyFamily(), members })

    expect(Object.keys(parsed.members)).toEqual([])
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before)
  })
})
