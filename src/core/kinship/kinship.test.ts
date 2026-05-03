import { describe, it, expect } from 'vitest'
import { getKinship } from './index'
import type { Member } from '@/core/schema'

/**
 * 构造辅助：定义一个固定的家族 fixture，覆盖常见关系。
 *
 * 结构（约定：左=父系，右=母系）：
 *                             self(男)
 *                              │
 *          ┌───────────────────┼───────────────────┐
 *        父亲 dad ─┬─ 母亲 mom                        配偶 wife
 *                 │
 *          ┌──────┴──────┐
 *        爷爷 gpa     奶奶 gma    （父亲这边的父母）
 *
 *        母亲这边：
 *        外公 mgp     外婆 mgm
 *
 *        父亲的兄弟：uncle_p (父系 → 叔叔)
 *        父亲的姐妹：aunt_p  (父系 → 姑姑)
 *        母亲的兄弟：uncle_m (母系 → 舅舅)
 *        母亲的姐妹：aunt_m  (母系 → 姨)
 *
 *        self 的兄弟：bro
 *        self 的子女：son, daughter
 *        兄弟的儿子：nephew
 *
 *        叔叔的儿子：cousin_p_m  → 堂兄弟
 *        姨的女儿：  cousin_m_f  → 表姐妹
 */
function buildFixture(): Record<string, Member> {
  const mk = (id: string, gender: 'male' | 'female'): Member => ({
    id,
    firstName: id,
    lastName: '',
    gender,
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  })

  const m: Record<string, Member> = {
    self: mk('self', 'male'),
    wife: mk('wife', 'female'),
    dad: mk('dad', 'male'),
    mom: mk('mom', 'female'),
    gpa: mk('gpa', 'male'),
    gma: mk('gma', 'female'),
    mgp: mk('mgp', 'male'),
    mgm: mk('mgm', 'female'),
    uncle_p: mk('uncle_p', 'male'),
    aunt_p: mk('aunt_p', 'female'),
    uncle_m: mk('uncle_m', 'male'),
    aunt_m: mk('aunt_m', 'female'),
    bro: mk('bro', 'male'),
    son: mk('son', 'male'),
    daughter: mk('daughter', 'female'),
    nephew: mk('nephew', 'male'),
    cousin_p_m: mk('cousin_p_m', 'male'),
    cousin_m_f: mk('cousin_m_f', 'female'),
    gson: mk('gson', 'male'),
  }

  // 双向连接辅助
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
  addSpouse(m.dad, m.mom)

  // self 的配偶
  addSpouse(m.self, m.wife)

  // 父系祖父母
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addSpouse(m.gpa, m.gma)
  // 母系外祖父母
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.mgp, m.mgm)

  // 叔伯姑舅姨（都是 dad/mom 的兄弟姐妹 → 共享父母）
  addParent(m.uncle_p, m.gpa)
  addParent(m.uncle_p, m.gma)
  addSibling(m.uncle_p, m.dad)
  addParent(m.aunt_p, m.gpa)
  addParent(m.aunt_p, m.gma)
  addSibling(m.aunt_p, m.dad)

  addParent(m.uncle_m, m.mgp)
  addParent(m.uncle_m, m.mgm)
  addSibling(m.uncle_m, m.mom)
  addParent(m.aunt_m, m.mgp)
  addParent(m.aunt_m, m.mgm)
  addSibling(m.aunt_m, m.mom)

  // self 的兄弟
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addSibling(m.self, m.bro)

  // self 的子女
  addParent(m.son, m.self)
  addParent(m.son, m.wife)
  addParent(m.daughter, m.self)
  addParent(m.daughter, m.wife)
  addSibling(m.son, m.daughter)

  // 兄弟的儿子
  addParent(m.nephew, m.bro)

  // 堂兄弟（叔叔的儿子）和表姐妹（姨的女儿）
  addParent(m.cousin_p_m, m.uncle_p)
  addParent(m.cousin_m_f, m.aunt_m)

  // 孙子（son 的儿子）
  addParent(m.gson, m.son)

  return m
}

describe('getKinship — high-frequency terms', () => {
  const members = buildFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'self', '本人'],
    ['self', 'dad', '父亲'],
    ['self', 'mom', '母亲'],
    ['self', 'wife', '妻子'],
    ['self', 'gpa', '爷爷'],
    ['self', 'gma', '奶奶'],
    ['self', 'mgp', '外公'],
    ['self', 'mgm', '外婆'],
    ['self', 'uncle_p', '叔伯'],
    ['self', 'aunt_p', '姑姑'],
    ['self', 'uncle_m', '舅舅'],
    ['self', 'aunt_m', '姨'],
    ['self', 'bro', '兄弟'],
    ['self', 'son', '儿子'],
    ['self', 'daughter', '女儿'],
    ['self', 'nephew', '侄子'],
    ['self', 'cousin_p_m', '堂兄弟'],
    ['self', 'cousin_m_f', '表姐妹'],
    ['self', 'gson', '孙子'],
  ]

  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, members)).toBe(expected)
    })
  }
})

describe('getKinship — overrides', () => {
  const members = buildFixture()
  it('override takes precedence over auto', () => {
    const overrides = { self: { uncle_p: '二叔' } }
    expect(getKinship('self', 'uncle_p', members, overrides)).toBe('二叔')
  })
  it('empty override falls back to auto', () => {
    const overrides = { self: {} }
    expect(getKinship('self', 'uncle_p', members, overrides)).toBe('叔伯')
  })
})

describe('getKinship — unknown / disconnected', () => {
  const members = buildFixture()
  it('returns null when either side is missing', () => {
    expect(getKinship('self', 'noone', members)).toBeNull()
    expect(getKinship('noone', 'self', members)).toBeNull()
  })
})

describe('getKinship — godparent/godchild', () => {
  function buildGod(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id,
      firstName: id,
      lastName: '',
      gender,
      parents: [],
      children: [],
      siblings: [],
      spouses: [],
      godparents: [],
      godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      gdad: mk('gdad', 'male'),
      gmom: mk('gmom', 'female'),
      gson: mk('gson', 'male'),
      gdau: mk('gdau', 'female'),
    }
    // self 有两个干亲长辈 + 两个干晚辈
    m.self.godparents = [
      { id: 'gdad', type: 'godparent' },
      { id: 'gmom', type: 'godparent' },
    ]
    m.gdad.godchildren = [{ id: 'self', type: 'godchild' }]
    m.gmom.godchildren = [{ id: 'self', type: 'godchild' }]
    m.self.godchildren = [
      { id: 'gson', type: 'godchild' },
      { id: 'gdau', type: 'godchild' },
    ]
    m.gson.godparents = [{ id: 'self', type: 'godparent' }]
    m.gdau.godparents = [{ id: 'self', type: 'godparent' }]
    return m
  }

  it('干爹/干妈 根据性别区分', () => {
    const m = buildGod()
    expect(getKinship('self', 'gdad', m)).toBe('干爹')
    expect(getKinship('self', 'gmom', m)).toBe('干妈')
  })

  it('干儿子/干女儿 根据性别区分', () => {
    const m = buildGod()
    expect(getKinship('self', 'gson', m)).toBe('干儿子')
    expect(getKinship('self', 'gdau', m)).toBe('干女儿')
  })

  it('override 优先于干亲自动判定', () => {
    const m = buildGod()
    const overrides = { self: { gdad: '老张叔' } }
    expect(getKinship('self', 'gdad', m, overrides)).toBe('老张叔')
  })
})
