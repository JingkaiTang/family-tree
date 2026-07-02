import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import { SCHEMA_VERSION, type Member } from './schema'

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

function rawFamily(members: Member[], patch: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    nicknameOverrides: {},
    manualPositions: {},
    ...patch,
  }
}

describe('migrate', () => {
  it('adds V2 grid fields while preserving legacy manualPositions', () => {
    const a = member('a')
    const raw = rawFamily([a], { manualPositions: { a: { cx: 10, top: 20 } } })

    const migrated = migrate(raw)

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.manualPositions.a).toEqual({ cx: 10, top: 20 })
    expect(migrated.childLayoutAssignments).toEqual({})
    expect(migrated.gridLayoutOverrides).toEqual({})
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
