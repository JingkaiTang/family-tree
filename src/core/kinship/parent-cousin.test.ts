import { describe, it, expect } from 'vitest'
import { getKinship } from './index'
import type { Member } from '@/core/schema'

/**
 * 父母的表兄弟 fixture：
 *
 *   great_gpa(曾祖父) ─── great_gma(曾祖母)
 *        │
 *   ┌────┴────┐
 * grandpa(男)  great_aunt(女)     ← grandpa的姐妹（姑奶奶）
 *     │              │
 *   dad(男)    dad_cousin_older(男,1958)  ← 父亲的表兄
 *     │        dad_cousin_younger(男,1963) ← 父亲的表弟
 *   self(男)   dad_cousin_f(女)           ← 父亲的表姐妹
 *
 *
 *   mgp_father ─── mgp_mother
 *        │
 *   ┌────┴────┐
 * mgp(外公)  great_uncle_m(男)     ← 外公的兄弟（舅公）
 *     │              │
 *   mom(女)    mom_cousin_m(男)    ← 母亲的表兄弟
 *              mom_cousin_f(女)    ← 母亲的表姐妹
 */
function buildParentCousinFixture(): Record<string, Member> {
  const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
    id, firstName: id, lastName: '', gender, birthDate,
    parents: [], children: [], siblings: [], spouses: [],
    godparents: [], godchildren: [],
  })

  const m: Record<string, Member> = {
    self: mk('self', 'male', '1990-01-01'),
    dad: mk('dad', 'male', '1960-01-01'),
    mom: mk('mom', 'female', '1962-01-01'),
    // 父系祖辈
    grandpa: mk('grandpa', 'male'),
    grandma: mk('grandma', 'female'),
    great_gpa: mk('great_gpa', 'male'),
    great_gma: mk('great_gma', 'female'),
    // grandpa 的姐妹 = 姑奶奶
    great_aunt: mk('great_aunt', 'female'),
    // 姑奶奶的子女 = 父亲的表兄弟姐妹
    dad_cousin_older: mk('dad_cousin_older', 'male', '1958-01-01'),
    dad_cousin_younger: mk('dad_cousin_younger', 'male', '1963-01-01'),
    dad_cousin_f: mk('dad_cousin_f', 'female'),
    // 母系祖辈
    mgp_father: mk('mgp_father', 'male'),
    mgp_mother: mk('mgp_mother', 'female'),
    mgp: mk('mgp', 'male'),
    mgm: mk('mgm', 'female'),
    // 外公的兄弟 = 舅公
    great_uncle_m: mk('great_uncle_m', 'male'),
    // 舅公的子女 = 母亲的堂兄弟姐妹
    mom_cousin_m: mk('mom_cousin_m', 'male'),
    mom_cousin_f: mk('mom_cousin_f', 'female'),
  }

  const addParent = (child: Member, parent: Member) => {
    child.parents.push({ id: parent.id, type: 'blood' })
    parent.children.push({ id: child.id, type: 'blood' })
  }
  const addSpouse = (a: Member, b: Member) => {
    a.spouses.push({ id: b.id, type: 'married' })
    b.spouses.push({ id: a.id, type: 'married' })
  }
  const addSibling = (a: Member, b: Member) => {
    a.siblings.push({ id: b.id, type: 'blood' })
    b.siblings.push({ id: a.id, type: 'blood' })
  }

  // self 的父母
  addParent(m.self, m.dad)
  addParent(m.self, m.mom)

  // 父系：dad → grandpa → great_gpa
  addParent(m.dad, m.grandpa)
  addParent(m.dad, m.grandma)
  addParent(m.grandpa, m.great_gpa)
  addParent(m.grandpa, m.great_gma)
  addSpouse(m.grandpa, m.grandma)
  addSpouse(m.great_gpa, m.great_gma)

  // grandpa 的姐妹（姑奶奶）— 共享父母 great_gpa/great_gma
  addParent(m.great_aunt, m.great_gpa)
  addParent(m.great_aunt, m.great_gma)
  addSibling(m.grandpa, m.great_aunt)

  // 姑奶奶的子女 = 父亲的表兄弟姐妹
  addParent(m.dad_cousin_older, m.great_aunt)
  addParent(m.dad_cousin_younger, m.great_aunt)
  addParent(m.dad_cousin_f, m.great_aunt)

  // 母系：mom → mgp → mgp_father
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.mgp, m.mgm)
  addParent(m.mgp, m.mgp_father)
  addParent(m.mgp, m.mgp_mother)
  addSpouse(m.mgp_father, m.mgp_mother)

  // 外公的兄弟（舅公）— 共享父母 mgp_father/mgp_mother
  addParent(m.great_uncle_m, m.mgp_father)
  addParent(m.great_uncle_m, m.mgp_mother)
  addSibling(m.mgp, m.great_uncle_m)

  // 舅公的子女 = 母亲的表兄弟姐妹
  addParent(m.mom_cousin_m, m.great_uncle_m)
  addParent(m.mom_cousin_f, m.great_uncle_m)

  return m
}

describe('getKinship — 父母的表兄弟', () => {
  const m = buildParentCousinFixture()

  it('父亲的表兄(比父亲年长) → 表伯', () => {
    expect(getKinship('self', 'dad_cousin_older', m)).toBe('表伯')
  })

  it('父亲的表弟(比父亲年幼) → 表叔', () => {
    expect(getKinship('self', 'dad_cousin_younger', m)).toBe('表叔')
  })

  it('父亲的表姐妹 → 表姑', () => {
    expect(getKinship('self', 'dad_cousin_f', m)).toBe('表姑')
  })

  it('母亲的堂兄弟 → 堂舅', () => {
    expect(getKinship('self', 'mom_cousin_m', m)).toBe('堂舅')
  })

  it('母亲的堂姐妹 → 堂姨', () => {
    expect(getKinship('self', 'mom_cousin_f', m)).toBe('堂姨')
  })
})

/**
 * 母亲的表兄弟（分叉点走女儿=表系）
 *
 *   mgp_father ─── mgp_mother
 *        │
 *   ┌────┴────┐
 * mgp_daughter(女)  ← 外公的姐妹（姨姥）
 *     │
 *   mom_cousin_biao_m(男)  ← 母亲的表兄弟 → 表舅
 *   mom_cousin_biao_f(女)  ← 母亲的表姐妹 → 表姨
 *
 * self → mom(女) → mgp(男) → mgp_father(男) → child(mgp_daughter,女) → child(mom_cousin_biao_m)
 * 分叉点 mgp_daughter 是女性 → 表系
 */
describe('getKinship — 母亲的表兄弟（表系）', () => {
  function buildMaternalBiaoFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
      id, firstName: id, lastName: '', gender, birthDate,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })

    const m: Record<string, Member> = {
      self: mk('self', 'male', '1990-01-01'),
      dad: mk('dad', 'male'),
      mom: mk('mom', 'female', '1962-01-01'),
      mgp: mk('mgp', 'male'),
      mgm: mk('mgm', 'female'),
      mgp_father: mk('mgp_father', 'male'),
      mgp_mother: mk('mgp_mother', 'female'),
      // 外公的姐妹（走女儿=表系）
      mgp_daughter: mk('mgp_daughter', 'female'),
      // 姨姥的子女 = 母亲的表兄弟姐妹
      mom_cousin_biao_m: mk('mom_cousin_biao_m', 'male'),
      mom_cousin_biao_f: mk('mom_cousin_biao_f', 'female'),
    }

    const addParent = (child: Member, parent: Member) => {
      child.parents.push({ id: parent.id, type: 'blood' })
      parent.children.push({ id: child.id, type: 'blood' })
    }
    const addSpouse = (a: Member, b: Member) => {
      a.spouses.push({ id: b.id, type: 'married' })
      b.spouses.push({ id: a.id, type: 'married' })
    }
    const addSibling = (a: Member, b: Member) => {
      a.siblings.push({ id: b.id, type: 'blood' })
      b.siblings.push({ id: a.id, type: 'blood' })
    }

    addParent(m.self, m.dad)
    addParent(m.self, m.mom)
    addParent(m.mom, m.mgp)
    addParent(m.mom, m.mgm)
    addSpouse(m.mgp, m.mgm)
    addParent(m.mgp, m.mgp_father)
    addParent(m.mgp, m.mgp_mother)
    addSpouse(m.mgp_father, m.mgp_mother)

    // 外公的姐妹
    addParent(m.mgp_daughter, m.mgp_father)
    addParent(m.mgp_daughter, m.mgp_mother)
    addSibling(m.mgp, m.mgp_daughter)

    // 姨姥的子女
    addParent(m.mom_cousin_biao_m, m.mgp_daughter)
    addParent(m.mom_cousin_biao_f, m.mgp_daughter)

    return m
  }
  const m = buildMaternalBiaoFixture()

  it('母亲的表兄弟(走女儿分叉) → 表舅', () => {
    expect(getKinship('self', 'mom_cousin_biao_m', m)).toBe('表舅')
  })

  it('母亲的表姐妹(走女儿分叉) → 表姨', () => {
    expect(getKinship('self', 'mom_cousin_biao_f', m)).toBe('表姨')
  })
})
