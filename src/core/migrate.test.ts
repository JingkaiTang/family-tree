import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import { createEmptyFamily, FamilyData, SCHEMA_VERSION, type Member } from './schema'

function member(id: string, patch: Partial<Member> = {}): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member, type: 'married' | 'divorced' = 'married') {
  a.spouses.push({ id: b.id, type })
  b.spouses.push({ id: a.id, type })
}

function rawFamily(members: Member[], patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    nicknameOverrides: {},
    manualPositions: {},
    ...patch,
  }
}

describe('migrate', () => {
  it('creates V3 families with empty semantic layout preferences', () => {
    const family = createEmptyFamily()

    expect(SCHEMA_VERSION).toBe(3)
    expect(family.schemaVersion).toBe(3)
    expect(family.layoutPreferences).toEqual({
      rowOrders: [],
      familyAccentAssignments: {},
    })
  })

  it('adds V2 grid fields while preserving legacy manualPositions', () => {
    const a = member('a')
    const raw = rawFamily([a], { manualPositions: { a: { cx: 10, top: 20 } } })

    const migrated = migrate(raw)

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.manualPositions.a).toEqual({ cx: 10, top: 20 })
    expect(migrated.childLayoutAssignments).toEqual({})
    expect(migrated.gridLayoutOverrides).toEqual({})
    expect(migrated.layoutPreferences).toEqual({
      rowOrders: [],
      familyAccentAssignments: {},
    })
  })

  it('converts V2 grid order into stable V3 row preferences without removing legacy data', () => {
    const a = member('a')
    const b = member('b')
    const raw = rawFamily([b, a], {
      schemaVersion: 2,
      manualPositions: { a: { cx: 10, top: 20 } },
      childLayoutAssignments: {},
      gridLayoutOverrides: {
        'person:a': { order: 0 },
        'person:b': { order: -1 },
      },
    })

    const migrated = migrate(raw)

    expect(migrated.layoutPreferences).toEqual({
      rowOrders: [{
        id: 'row:v2:0',
        unitIds: ['unit:person:b', 'unit:person:a'],
      }],
      familyAccentAssignments: {},
    })
    expect(migrated.manualPositions).toEqual(raw.manualPositions)
    expect(migrated.gridLayoutOverrides).toEqual(raw.gridLayoutOverrides)
    expect(migrated.childLayoutAssignments).toEqual(raw.childLayoutAssignments)
  })

  it('ignores malformed legacy overrides before schema validation without throwing', () => {
    const raw = rawFamily([member('a'), member('b')], {
      schemaVersion: 2,
      childLayoutAssignments: {},
      gridLayoutOverrides: {
        'person:b': { order: -1 },
        'invalid:null': null,
        'invalid:string': 'bad',
        'invalid:missing': {},
        'invalid:nan': { order: Number.NaN },
        'invalid:infinity': { order: Number.POSITIVE_INFINITY },
      },
    })

    const migrated = migrate(raw)

    expect(migrated.layoutPreferences.rowOrders).toEqual([{
      id: 'row:v2:0',
      unitIds: ['unit:person:b', 'unit:person:a'],
    }])
  })

  it('preserves V3 preferences when migration is run repeatedly', () => {
    const family = createEmptyFamily()
    family.members.a = member('a')
    family.layoutPreferences = {
      rowOrders: [{ id: 'row:custom', unitIds: ['unit:person:a'] }],
      familyAccentAssignments: { 'unit:person:a': '#123456' },
    }

    const once = migrate(family)
    const twice = migrate(once)

    expect(twice).toEqual(once)
    expect(twice.layoutPreferences).toEqual(family.layoutPreferences)
  })

  it('reconciles stale V3 row and accent preferences against current units', () => {
    const family = createEmptyFamily()
    family.members = {
      a: member('a'),
      b: member('b'),
    }
    family.layoutPreferences = {
      rowOrders: [{
        id: 'row:dirty',
        unitIds: [
          'unit:person:b',
          'unit:person:a',
          'unit:person:b',
          'unit:person:unknown',
        ],
      }],
      familyAccentAssignments: {
        'unit:person:a': '#123456',
        'unit:person:unknown': '#999999',
      },
    }

    expect(migrate(family).layoutPreferences).toEqual({
      rowOrders: [{
        id: 'row:dirty',
        unitIds: ['unit:person:b', 'unit:person:a'],
      }],
      familyAccentAssignments: {
        'unit:person:a': '#123456',
      },
    })
  })

  it('rejects future schema versions instead of rewriting them', () => {
    const raw = {
      ...createEmptyFamily(),
      schemaVersion: SCHEMA_VERSION + 1,
    }

    expect(() => migrate(raw)).toThrow('文件版本过新，当前版本不支持')
  })

  it('requires the current schema version during final validation', () => {
    expect(FamilyData.safeParse({
      ...createEmptyFamily(),
      schemaVersion: SCHEMA_VERSION - 1,
    }).success).toBe(false)
  })

  it.each([2, 3])('preserves root and member extension fields from V%s data', (version) => {
    const extendedMember = {
      ...member('a'),
      futureMemberField: { enabled: true },
    }
    const raw = rawFamily([extendedMember], {
      schemaVersion: version,
      childLayoutAssignments: {},
      gridLayoutOverrides: {},
      layoutPreferences: version === 3
        ? { rowOrders: [], familyAccentAssignments: {} }
        : undefined,
      futureRootField: { mode: 'extension' },
    })

    const parsed = FamilyData.parse(migrate(raw))

    expect((parsed as unknown as Record<string, unknown>).futureRootField).toEqual({
      mode: 'extension',
    })
    expect((parsed.members.a as unknown as Record<string, unknown>).futureMemberField).toEqual({
      enabled: true,
    })
  })

  it('does not mutate V1 input while normalizing conflicting current spouses', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    linkSpouse(a, c)
    linkSpouse(a, b)
    const raw = rawFamily([a, b, c])
    const before = structuredClone(raw)

    const migrated = migrate(raw)

    expect(raw).toEqual(before)
    expect(migrated.members.a.spouses).toEqual([
      { id: 'b', type: 'married' },
      { id: 'c', type: 'divorced' },
    ])
  })

  it('normalizes multiple current spouses deterministically', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    linkSpouse(a, c)
    linkSpouse(a, b)

    const migrated = migrate(rawFamily([a, b, c]))

    expect(migrated.members.a.spouses).toEqual([
      { id: 'b', type: 'married' },
      { id: 'c', type: 'divorced' },
    ])
    expect(migrated.members.b.spouses).toEqual([{ id: 'a', type: 'married' }])
    expect(migrated.members.c.spouses).toEqual([{ id: 'a', type: 'divorced' }])
  })

  it('infers child layout assignment from current-spouse parents', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const migrated = migrate(rawFamily([dad, mom, kid]))

    expect(migrated.childLayoutAssignments.kid).toEqual({
      primaryParentId: 'dad',
      primarySpouseId: 'mom',
    })
  })

  it('infers child layout assignment from stable first parent when parents are not current spouses', () => {
    const zParent = member('zParent')
    const aParent = member('aParent')
    const kid = member('kid')
    linkParent(kid, zParent)
    linkParent(kid, aParent)

    const migrated = migrate(rawFamily([zParent, aParent, kid]))

    expect(migrated.childLayoutAssignments.kid).toEqual({
      primaryParentId: 'aParent',
    })
  })
})
