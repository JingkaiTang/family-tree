import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { assertFamilyIntegrity, validateFamilyIntegrity, wouldCreateAncestryCycle } from './familyIntegrity'

function member(id: string): Member {
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
  }
}

function familyOf(...members: Member[]): FamilyData {
  const family = createEmptyFamily()
  family.members = Object.fromEntries(members.map(value => [value.id, value]))
  return family
}

describe('wouldCreateAncestryCycle', () => {
  it('checks the complete mixed parent chain without changing it', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    const d = member('d')
    b.parents.push({ id: 'a', type: 'blood' })
    c.parents.push({ id: 'b', type: 'adopted' })
    d.parents.push({ id: 'c', type: 'step' })
    const family = familyOf(a, b, c, d)
    const before = JSON.stringify(family)

    expect(wouldCreateAncestryCycle(family.members, 'a', 'a')).toBe(true)
    expect(wouldCreateAncestryCycle(family.members, 'a', 'd')).toBe(true)
    expect(wouldCreateAncestryCycle(family.members, 'd', 'a')).toBe(false)
    expect(wouldCreateAncestryCycle(family.members, 'b', 'a')).toBe(false)
    expect(JSON.stringify(family)).toBe(before)
  })

  it('does not treat spouses, siblings or godparents as ancestors', () => {
    const a = member('a')
    const b = member('b')
    b.spouses.push({ id: 'a', type: 'married' })
    b.siblings.push({ id: 'a', type: 'blood' })
    b.godparents.push({ id: 'a', type: 'godparent' })

    expect(wouldCreateAncestryCycle(familyOf(a, b).members, 'a', 'b')).toBe(false)
  })

  it('terminates when the inspected data already has a cycle or missing reference', () => {
    const a = member('a')
    const b = member('b')
    const unrelated = member('unrelated')
    a.parents.push({ id: 'b', type: 'blood' }, { id: 'missing', type: 'step' })
    b.parents.push({ id: 'a', type: 'adopted' })

    expect(wouldCreateAncestryCycle(familyOf(a, b, unrelated).members, 'unrelated', 'a')).toBe(false)
  })
})

describe('validateFamilyIntegrity', () => {
  it('接受引用完整的双向家族图', () => {
    const parent = member('parent')
    const child = member('child')
    parent.children.push({ id: child.id, type: 'blood' })
    child.parents.push({ id: parent.id, type: 'blood' })

    expect(validateFamilyIntegrity(familyOf(parent, child))).toEqual([])
  })

  it('报告成员键、悬空引用、重复引用和缺失反向引用', () => {
    const a = member('a')
    const b = member('b')
    a.parents.push({ id: 'missing', type: 'blood' })
    a.siblings.push({ id: 'b', type: 'blood' }, { id: 'b', type: 'blood' })
    const family = familyOf(a, b)
    family.members.wrong = family.members.a
    delete family.members.a

    const issues = validateFamilyIntegrity(family)
    expect(issues.some(issue => issue.includes('members.wrong.id 应为 wrong'))).toBe(true)
    expect(issues.some(issue => issue.includes('不存在的成员 missing'))).toBe(true)
    expect(issues.some(issue => issue.includes('重复引用 b'))).toBe(true)
    expect(issues.some(issue => issue.includes('缺少同类型反向引用 siblings'))).toBe(true)
  })

  it('拒绝多个当前配偶和祖先环', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    a.spouses.push({ id: 'b', type: 'married' }, { id: 'c', type: 'married' })
    b.spouses.push({ id: 'a', type: 'married' })
    c.spouses.push({ id: 'a', type: 'married' })
    a.parents.push({ id: 'b', type: 'blood' })
    b.children.push({ id: 'a', type: 'blood' })
    b.parents.push({ id: 'a', type: 'blood' })
    a.children.push({ id: 'b', type: 'blood' })

    const issues = validateFamilyIntegrity(familyOf(a, b, c))
    expect(issues.some(issue => issue.includes('多个当前配偶'))).toBe(true)
    expect(issues.some(issue => issue.includes('祖先环'))).toBe(true)
  })

  it('校验顶层成员引用', () => {
    const family = familyOf(member('a'))
    family.rootMemberId = 'missing-root'
    family.nicknameOverrides = { a: { missing: '称呼' } }

    expect(() => assertFamilyIntegrity(family)).toThrow('rootMemberId')
    expect(() => assertFamilyIntegrity(family)).toThrow('nicknameOverrides.a.missing')
  })

  it.each(['__proto__', 'constructor', 'toString'])('不把继承属性 %s 误当成成员', id => {
    const family = familyOf(member('a'))
    family.rootMemberId = id
    family.defaultViewpointId = id
    family.members.a.parents.push({ id, type: 'blood' })

    const issues = validateFamilyIntegrity(family)

    expect(issues).toContain(`rootMemberId 引用了不存在的成员 ${id}`)
    expect(issues).toContain(`defaultViewpointId 引用了不存在的成员 ${id}`)
    expect(issues).toContain(`members.a.parents 引用了不存在的成员 ${id}`)
  })
})
