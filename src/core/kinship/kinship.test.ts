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
 *        父亲的兄弟：uncle_p (父系 → 叔伯)
 *        父亲的姐妹：aunt_p  (父系 → 姑姑)
 *        母亲的兄弟：uncle_m (母系 → 舅舅)
 *        母亲的姐妹：aunt_m  (母系 → 姨)
 *
 *        self 的兄弟：bro
 *        self 的姐妹：sis
 *        self 的子女：son, daughter
 *        兄弟的儿子：nephew
 *        兄弟的女儿：niece
 *        姐妹的儿子：nephew_s (→ 外甥)
 *        姐妹的女儿：niece_s  (→ 外甥女)
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
    sis: mk('sis', 'female'),
    son: mk('son', 'male'),
    daughter: mk('daughter', 'female'),
    nephew: mk('nephew', 'male'),
    niece: mk('niece', 'female'),
    nephew_s: mk('nephew_s', 'male'),
    niece_s: mk('niece_s', 'female'),
    cousin_p_m: mk('cousin_p_m', 'male'),
    cousin_m_f: mk('cousin_m_f', 'female'),
    // 姑姑的儿子（表兄弟，男性）
    cousin_p_f_m: mk('cousin_p_f_m', 'male'),
    gson: mk('gson', 'male'),
    // 堂兄弟的子女
    cousin_p_m_son: mk('cousin_p_m_son', 'male'),     // 堂兄弟的儿子
    cousin_p_m_daughter: mk('cousin_p_m_daughter', 'female'), // 堂兄弟的女儿
    // 表姐妹的子女
    cousin_m_f_son: mk('cousin_m_f_son', 'male'),      // 表姐妹的儿子
    cousin_m_f_daughter: mk('cousin_m_f_daughter', 'female'), // 表姐妹的女儿
    // 表兄弟（姑姑的儿子）的子女
    cousin_p_f_m_son: mk('cousin_p_f_m_son', 'male'),      // 表兄弟的儿子
    cousin_p_f_m_daughter: mk('cousin_p_f_m_daughter', 'female'), // 表兄弟的女儿
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

  // 叔伯姑舅姨
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

  // self 的兄弟姐妹
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addSibling(m.self, m.bro)
  addParent(m.sis, m.dad)
  addParent(m.sis, m.mom)
  addSibling(m.self, m.sis)

  // self 的子女
  addParent(m.son, m.self)
  addParent(m.son, m.wife)
  addParent(m.daughter, m.self)
  addParent(m.daughter, m.wife)
  addSibling(m.son, m.daughter)

  // 兄弟的子女 → 侄子/侄女
  addParent(m.nephew, m.bro)
  addParent(m.niece, m.bro)

  // 姐妹的子女 → 外甥/外甥女
  addParent(m.nephew_s, m.sis)
  addParent(m.niece_s, m.sis)

  // 堂兄弟（叔叔的儿子）和表姐妹（姨的女儿）
  addParent(m.cousin_p_m, m.uncle_p)
  addParent(m.cousin_m_f, m.aunt_m)
  // 姑姑的儿子 = 表兄弟
  addParent(m.cousin_p_f_m, m.aunt_p)

  // 堂兄弟的子女
  addParent(m.cousin_p_m_son, m.cousin_p_m)
  addParent(m.cousin_p_m_daughter, m.cousin_p_m)

  // 表姐妹的子女
  addParent(m.cousin_m_f_son, m.cousin_m_f)
  addParent(m.cousin_m_f_daughter, m.cousin_m_f)

  // 表兄弟（姑姑的儿子）的子女
  addParent(m.cousin_p_f_m_son, m.cousin_p_f_m)
  addParent(m.cousin_p_f_m_daughter, m.cousin_p_f_m)

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
    ['self', 'sis', '姐妹'],
    ['self', 'son', '儿子'],
    ['self', 'daughter', '女儿'],
    ['self', 'nephew', '侄子'],
    ['self', 'niece', '侄女'],
    ['self', 'nephew_s', '外甥'],
    ['self', 'niece_s', '外甥女'],
    ['self', 'cousin_p_m', '堂兄弟'],
    ['self', 'cousin_m_f', '表姐妹'],
    ['self', 'gson', '孙子'],
    // 堂兄弟的子女（叔叔的儿子=堂兄弟，男→侄）
    ['self', 'cousin_p_m_son', '堂侄'],
    ['self', 'cousin_p_m_daughter', '堂侄女'],
    // 表姐妹的子女（姨的女儿=表姐妹，女→外甥）
    ['self', 'cousin_m_f_son', '表外甥'],
    ['self', 'cousin_m_f_daughter', '表外甥女'],
    // 表兄弟的子女（姑姑的儿子=表兄弟，男→侄）
    ['self', 'cousin_p_f_m_son', '表侄'],
    ['self', 'cousin_p_f_m_daughter', '表侄女'],
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

/**
 * 姻亲测试 fixture：
 *
 *   self(男) ─── wife(女)
 *                 │
 *     wife_dad(男) ─── wife_mom(女)      ← 妻子的父母
 *          │
 *     wife_bro(男)  wife_sis(女)          ← 妻子的兄弟姐妹
 *
 *   uncle_p(男) ─── uncle_p_wife(女)      ← 叔伯的配偶
 *   aunt_p(女)  ─── aunt_p_husb(男)       ← 姑姑的配偶
 *   uncle_m(男) ─── uncle_m_wife(女)      ← 舅舅的配偶
 *   aunt_m(女)  ─── aunt_m_husb(男)       ← 姨的配偶
 *
 *   gson(男) ─── gson_wife(女)            ← 孙子的配偶
 *   nephew(男) ─── nephew_wife(女)         ← 侄子的配偶
 *   nephew_s(男) ─── nephew_s_wife(女)     ← 外甥的配偶
 *
 *   bro(男) ─── bro_wife(女)              ← 兄弟的配偶
 *   sis(女) ─── sis_husb(男)             ← 姐妹的配偶
 *
 *   daughter(女) ─── son_in_law(男)       ← 女儿的配偶
 *   son(男) ─── daughter_in_law(女)       ← 儿子的配偶
 */
function buildInLawFixture(): Record<string, Member> {
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
    // 妻子的父母
    wife_dad: mk('wife_dad', 'male'),
    wife_mom: mk('wife_mom', 'female'),
    // 妻子的兄弟姐妹
    wife_bro: mk('wife_bro', 'male'),
    wife_sis: mk('wife_sis', 'female'),
    // 自己的父母（用于旁系计算）
    dad: mk('dad', 'male'),
    mom: mk('mom', 'female'),
    gpa: mk('gpa', 'male'),
    gma: mk('gma', 'female'),
    mgp: mk('mgp', 'male'),
    mgm: mk('mgm', 'female'),
    // 叔伯姑舅姨
    uncle_p: mk('uncle_p', 'male'),
    aunt_p: mk('aunt_p', 'female'),
    uncle_m: mk('uncle_m', 'male'),
    aunt_m: mk('aunt_m', 'female'),
    // 叔伯姑舅姨的配偶
    uncle_p_wife: mk('uncle_p_wife', 'female'),
    aunt_p_husb: mk('aunt_p_husb', 'male'),
    uncle_m_wife: mk('uncle_m_wife', 'female'),
    aunt_m_husb: mk('aunt_m_husb', 'male'),
    // 兄弟姐妹
    bro: mk('bro', 'male'),
    sis: mk('sis', 'female'),
    // 兄弟姐妹的配偶
    bro_wife: mk('bro_wife', 'female'),
    sis_husb: mk('sis_husb', 'male'),
    // 子女
    son: mk('son', 'male'),
    daughter: mk('daughter', 'female'),
    // 子女的配偶
    daughter_in_law: mk('daughter_in_law', 'female'),
    son_in_law: mk('son_in_law', 'male'),
    // 孙子及其配偶
    gson: mk('gson', 'male'),
    gson_wife: mk('gson_wife', 'female'),
    // 侄子及其配偶
    nephew: mk('nephew', 'male'),
    nephew_wife: mk('nephew_wife', 'female'),
    // 外甥及其配偶
    nephew_s: mk('nephew_s', 'male'),
    nephew_s_wife: mk('nephew_s_wife', 'female'),
    // 堂兄弟及其配偶
    cousin_p_m: mk('cousin_p_m', 'male'),
    cousin_p_wife: mk('cousin_p_wife', 'female'),
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
  addSpouse(m.dad, m.mom)
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addSpouse(m.gpa, m.gma)
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.mgp, m.mgm)

  // self 的配偶
  addSpouse(m.self, m.wife)

  // 妻子的父母和兄弟姐妹
  addParent(m.wife, m.wife_dad)
  addParent(m.wife, m.wife_mom)
  addSpouse(m.wife_dad, m.wife_mom)
  addParent(m.wife_bro, m.wife_dad)
  addParent(m.wife_bro, m.wife_mom)
  addSibling(m.wife, m.wife_bro)
  addParent(m.wife_sis, m.wife_dad)
  addParent(m.wife_sis, m.wife_mom)
  addSibling(m.wife, m.wife_sis)

  // 叔伯姑舅姨
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

  // 叔伯姑舅姨的配偶
  addSpouse(m.uncle_p, m.uncle_p_wife)
  addSpouse(m.aunt_p, m.aunt_p_husb)
  addSpouse(m.uncle_m, m.uncle_m_wife)
  addSpouse(m.aunt_m, m.aunt_m_husb)

  // 兄弟姐妹
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addSibling(m.self, m.bro)
  addParent(m.sis, m.dad)
  addParent(m.sis, m.mom)
  addSibling(m.self, m.sis)

  // 兄弟姐妹的配偶
  addSpouse(m.bro, m.bro_wife)
  addSpouse(m.sis, m.sis_husb)

  // 子女
  addParent(m.son, m.self)
  addParent(m.son, m.wife)
  addParent(m.daughter, m.self)
  addParent(m.daughter, m.wife)

  // 子女的配偶
  addSpouse(m.son, m.daughter_in_law)
  addSpouse(m.daughter, m.son_in_law)

  // 孙子及其配偶
  addParent(m.gson, m.son)
  addSpouse(m.gson, m.gson_wife)

  // 侄子及其配偶（兄弟的儿子）
  addParent(m.nephew, m.bro)
  addSpouse(m.nephew, m.nephew_wife)

  // 外甥及其配偶（姐妹的儿子）
  addParent(m.nephew_s, m.sis)
  addSpouse(m.nephew_s, m.nephew_s_wife)

  // 堂兄弟（叔叔的儿子）及其配偶
  addParent(m.cousin_p_m, m.uncle_p)
  addSpouse(m.cousin_p_m, m.cousin_p_wife)

  return m
}

describe('getKinship — 姻亲：叔伯姑舅姨的配偶', () => {
  const m = buildInLawFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'uncle_p_wife', '婶婶/伯母'],
    ['self', 'aunt_p_husb', '姑父'],
    ['self', 'uncle_m_wife', '舅妈'],
    ['self', 'aunt_m_husb', '姨父'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 姻亲：配偶的亲属', () => {
  const m = buildInLawFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'wife_dad', '岳父'],
    ['self', 'wife_mom', '岳母'],
    ['self', 'wife_bro', '大舅子/小舅子'],
    ['self', 'wife_sis', '大姨子/小姨子'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 姻亲：配偶侧（女性视角）', () => {
  function buildFemaleSelfFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self_f: mk('self_f', 'female'),
      husb: mk('husb', 'male'),
      husb_dad: mk('husb_dad', 'male'),
      husb_mom: mk('husb_mom', 'female'),
      husb_bro: mk('husb_bro', 'male'),
      husb_sis: mk('husb_sis', 'female'),
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

    addSpouse(m.self_f, m.husb)
    addParent(m.husb, m.husb_dad)
    addParent(m.husb, m.husb_mom)
    addSpouse(m.husb_dad, m.husb_mom)
    addParent(m.husb_bro, m.husb_dad)
    addParent(m.husb_bro, m.husb_mom)
    addSibling(m.husb, m.husb_bro)
    addParent(m.husb_sis, m.husb_dad)
    addParent(m.husb_sis, m.husb_mom)
    addSibling(m.husb, m.husb_sis)

    return m
  }
  const m = buildFemaleSelfFixture()
  const cases: Array<[string, string, string]> = [
    ['self_f', 'husb_dad', '公公'],
    ['self_f', 'husb_mom', '婆婆'],
    ['self_f', 'husb_bro', '大伯子/小叔子'],
    ['self_f', 'husb_sis', '大姑子/小姑子'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 姻亲：子女/孙辈/侄辈的配偶', () => {
  const m = buildInLawFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'daughter_in_law', '儿媳'],
    ['self', 'son_in_law', '女婿'],
    ['self', 'gson_wife', '孙媳'],
    ['self', 'nephew_wife', '侄媳'],
    ['self', 'nephew_s_wife', '甥媳'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 姻亲：兄弟姐妹的配偶', () => {
  const m = buildInLawFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'bro_wife', '嫂子/弟媳'],
    ['self', 'sis_husb', '姐夫/妹夫'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 姻亲：堂表兄弟的配偶', () => {
  const m = buildInLawFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'cousin_p_wife', '堂嫂'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — 继子女', () => {
  function buildStepFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      wife: mk('wife', 'female'),
      stepson: mk('stepson', 'male'),
      stepdaughter: mk('stepdaughter', 'female'),
    }
    const addSpouse = (a: Member, b: Member) => {
      a.spouses.push({ id: b.id, type: 'married' })
      b.spouses.push({ id: a.id, type: 'married' })
    }
    const addParent = (child: Member, parent: Member) => {
      child.parents.push({ id: parent.id, type: 'blood' })
      parent.children.push({ id: child.id, type: 'blood' })
    }

    addSpouse(m.self, m.wife)
    addParent(m.stepson, m.wife)
    addParent(m.stepdaughter, m.wife)

    return m
  }
  const m = buildStepFixture()
  it('self → stepson (配偶的儿子) = 继子', () => {
    expect(getKinship('self', 'stepson', m)).toBe('继子')
  })
  it('self → stepdaughter (配偶的女儿) = 继女', () => {
    expect(getKinship('self', 'stepdaughter', m)).toBe('继女')
  })
})

// ========================= P2 测试 =========================

/**
 * 带 birthDate 的 fixture，用于长幼区分测试。
 *
 * self(1990-男), older_bro(1985-男), younger_bro(1995-男)
 * older_sis(1987-女), younger_sis(1993-女)
 * dad(1960-男), older_uncle(1957-男), younger_uncle(1963-男)
 */
function buildAgeAwareFixture(): Record<string, Member> {
  const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
    id, firstName: id, lastName: '', gender,
    birthDate,
    parents: [], children: [], siblings: [], spouses: [],
    godparents: [], godchildren: [],
  })

  const m: Record<string, Member> = {
    self: mk('self', 'male', '1990-01-01'),
    older_bro: mk('older_bro', 'male', '1985-01-01'),
    younger_bro: mk('younger_bro', 'male', '1995-01-01'),
    older_sis: mk('older_sis', 'female', '1987-01-01'),
    younger_sis: mk('younger_sis', 'female', '1993-01-01'),
    dad: mk('dad', 'male', '1960-01-01'),
    mom: mk('mom', 'female', '1962-01-01'),
    gpa: mk('gpa', 'male', '1935-01-01'),
    gma: mk('gma', 'female', '1937-01-01'),
    older_uncle: mk('older_uncle', 'male', '1957-01-01'),
    younger_uncle: mk('younger_uncle', 'male', '1963-01-01'),
    aunt_p: mk('aunt_p', 'female', '1959-01-01'),
    // 兄弟的配偶
    older_bro_wife: mk('older_bro_wife', 'female', '1986-01-01'),
    younger_bro_wife: mk('younger_bro_wife', 'female', '1996-01-01'),
    older_sis_husb: mk('older_sis_husb', 'male', '1986-01-01'),
    younger_sis_husb: mk('younger_sis_husb', 'male', '1994-01-01'),
    // 叔伯的配偶
    older_uncle_wife: mk('older_uncle_wife', 'female', '1958-01-01'),
    younger_uncle_wife: mk('younger_uncle_wife', 'female', '1964-01-01'),
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
  addSpouse(m.dad, m.mom)
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)

  // 兄弟姐妹
  addParent(m.older_bro, m.dad)
  addParent(m.older_bro, m.mom)
  addSibling(m.self, m.older_bro)
  addParent(m.younger_bro, m.dad)
  addParent(m.younger_bro, m.mom)
  addSibling(m.self, m.younger_bro)
  addParent(m.older_sis, m.dad)
  addParent(m.older_sis, m.mom)
  addSibling(m.self, m.older_sis)
  addParent(m.younger_sis, m.dad)
  addParent(m.younger_sis, m.mom)
  addSibling(m.self, m.younger_sis)

  // 叔伯
  addParent(m.older_uncle, m.gpa)
  addParent(m.older_uncle, m.gma)
  addSibling(m.older_uncle, m.dad)
  addParent(m.younger_uncle, m.gpa)
  addParent(m.younger_uncle, m.gma)
  addSibling(m.younger_uncle, m.dad)
  addParent(m.aunt_p, m.gpa)
  addParent(m.aunt_p, m.gma)
  addSibling(m.aunt_p, m.dad)

  // 兄弟姐妹的配偶
  addSpouse(m.older_bro, m.older_bro_wife)
  addSpouse(m.younger_bro, m.younger_bro_wife)
  addSpouse(m.older_sis, m.older_sis_husb)
  addSpouse(m.younger_sis, m.younger_sis_husb)

  // 叔伯的配偶
  addSpouse(m.older_uncle, m.older_uncle_wife)
  addSpouse(m.younger_uncle, m.younger_uncle_wife)

  return m
}

describe('getKinship — P2: 长幼区分（有 birthDate）', () => {
  const m = buildAgeAwareFixture()
  const cases: Array<[string, string, string]> = [
    // 兄弟姐妹
    ['self', 'older_bro', '哥哥'],
    ['self', 'younger_bro', '弟弟'],
    ['self', 'older_sis', '姐姐'],
    ['self', 'younger_sis', '妹妹'],
    // 叔伯（比父亲年长→伯父，年幼→叔叔）
    ['self', 'older_uncle', '伯父'],
    ['self', 'younger_uncle', '叔叔'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — P2: 长幼区分 - 兄弟姐妹的配偶', () => {
  const m = buildAgeAwareFixture()
  const cases: Array<[string, string, string]> = [
    // 哥哥的妻子 → 嫂子
    ['self', 'older_bro_wife', '嫂子'],
    // 弟弟的妻子 → 弟媳
    ['self', 'younger_bro_wife', '弟媳'],
    // 姐姐的丈夫 → 姐夫
    ['self', 'older_sis_husb', '姐夫'],
    // 妹妹的丈夫 → 妹夫
    ['self', 'younger_sis_husb', '妹夫'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — P2: 长幼区分 - 伯母/婶婶', () => {
  const m = buildAgeAwareFixture()
  const cases: Array<[string, string, string]> = [
    // 伯父的妻子 → 伯母
    ['self', 'older_uncle_wife', '伯母'],
    // 叔叔的妻子 → 婶婶
    ['self', 'younger_uncle_wife', '婶婶'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — P2: 无 birthDate 时回退', () => {
  const m = buildFixture() // 无 birthDate
  const cases: Array<[string, string, string]> = [
    ['self', 'bro', '兄弟'],
    ['self', 'sis', '姐妹'],
    ['self', 'uncle_p', '叔伯'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}（无 birthDate 回退）`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

describe('getKinship — P2: 继父/继母（adopted parent）', () => {
  function buildAdoptedParentFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      step_dad: mk('step_dad', 'male'),
      step_mom: mk('step_mom', 'female'),
      bio_dad: mk('bio_dad', 'male'),
      bio_mom: mk('bio_mom', 'female'),
    }

    // 亲生父母
    m.self.parents.push({ id: 'bio_dad', type: 'blood' })
    m.bio_dad.children.push({ id: 'self', type: 'blood' })
    m.self.parents.push({ id: 'bio_mom', type: 'blood' })
    m.bio_mom.children.push({ id: 'self', type: 'blood' })

    // 继父继母（step 类型）
    m.self.parents.push({ id: 'step_dad', type: 'step' })
    m.step_dad.children.push({ id: 'self', type: 'step' })
    m.self.parents.push({ id: 'step_mom', type: 'step' })
    m.step_mom.children.push({ id: 'self', type: 'step' })

    return m
  }
  const m = buildAdoptedParentFixture()
  it('adopted parent 男 → 继父', () => {
    expect(getKinship('self', 'step_dad', m)).toBe('继父')
  })
  it('adopted parent 女 → 继母', () => {
    expect(getKinship('self', 'step_mom', m)).toBe('继母')
  })
  it('blood parent 男 → 父亲', () => {
    expect(getKinship('self', 'bio_dad', m)).toBe('父亲')
  })
  it('blood parent 女 → 母亲', () => {
    expect(getKinship('self', 'bio_mom', m)).toBe('母亲')
  })
})

describe('getKinship — P2: 养子/养女（adopted child）', () => {
  function buildAdoptedChildFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      bio_son: mk('bio_son', 'male'),
      adopted_son: mk('adopted_son', 'male'),
      adopted_daughter: mk('adopted_daughter', 'female'),
    }

    // 亲生子女
    m.self.children.push({ id: 'bio_son', type: 'blood' })
    m.bio_son.parents.push({ id: 'self', type: 'blood' })

    // 养子女
    m.self.children.push({ id: 'adopted_son', type: 'adopted' })
    m.adopted_son.parents.push({ id: 'self', type: 'adopted' })
    m.self.children.push({ id: 'adopted_daughter', type: 'adopted' })
    m.adopted_daughter.parents.push({ id: 'self', type: 'adopted' })

    return m
  }
  const m = buildAdoptedChildFixture()
  it('adopted child 男 → 养子', () => {
    expect(getKinship('self', 'adopted_son', m)).toBe('养子')
  })
  it('adopted child 女 → 养女', () => {
    expect(getKinship('self', 'adopted_daughter', m)).toBe('养女')
  })
  it('blood child 男 → 儿子', () => {
    expect(getKinship('self', 'bio_son', m)).toBe('儿子')
  })
})

describe('getKinship — P2: 半亲兄弟姐妹（half sibling）', () => {
  function buildHalfSiblingFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
      id, firstName: id, lastName: '', gender, birthDate,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male', '1990-01-01'),
      dad: mk('dad', 'male'),
      mom: mk('mom', 'female'),
      // 同父异母的兄弟（年长）
      half_older_bro: mk('half_older_bro', 'male', '1985-01-01'),
      // 同父异母的妹妹（年幼）
      half_younger_sis: mk('half_younger_sis', 'female', '1995-01-01'),
      // 无 birthDate 的半亲兄弟
      half_bro_no_date: mk('half_bro_no_date', 'male'),
    }

    const addParent = (child: Member, parent: Member, type: 'blood' | 'adopted' = 'blood') => {
      child.parents.push({ id: parent.id, type })
      parent.children.push({ id: child.id, type })
    }
    const addSibling = (a: Member, b: Member, type: 'blood' | 'half' = 'blood') => {
      a.siblings.push({ id: b.id, type })
      b.siblings.push({ id: a.id, type })
    }

    // self 的父母
    addParent(m.self, m.dad)
    addParent(m.self, m.mom)

    // 半亲兄弟（只有共同父亲）
    addParent(m.half_older_bro, m.dad)
    addSibling(m.self, m.half_older_bro, 'half')

    addParent(m.half_younger_sis, m.dad)
    addSibling(m.self, m.half_younger_sis, 'half')

    addParent(m.half_bro_no_date, m.dad)
    addSibling(m.self, m.half_bro_no_date, 'half')

    return m
  }
  const m = buildHalfSiblingFixture()
  it('half sibling 年长男 → 半亲哥哥', () => {
    expect(getKinship('self', 'half_older_bro', m)).toBe('半亲哥哥')
  })
  it('half sibling 年幼女 → 半亲妹妹', () => {
    expect(getKinship('self', 'half_younger_sis', m)).toBe('半亲妹妹')
  })
  it('half sibling 无 birthDate → 半亲兄弟', () => {
    expect(getKinship('self', 'half_bro_no_date', m)).toBe('半亲兄弟')
  })
})

describe('getKinship — P2: 妯娌/连襟', () => {
  function buildSistersInLawFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      wife: mk('wife', 'female'),
      dad: mk('dad', 'male'),
      mom: mk('mom', 'female'),
      bro: mk('bro', 'male'),
      sis: mk('sis', 'female'),
      bro_wife: mk('bro_wife', 'female'),    // 兄弟的配偶
      sis_husb: mk('sis_husb', 'male'),       // 姐妹的配偶
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
    addSpouse(m.self, m.wife)
    addParent(m.bro, m.dad)
    addParent(m.bro, m.mom)
    addSibling(m.self, m.bro)
    addParent(m.sis, m.dad)
    addParent(m.sis, m.mom)
    addSibling(m.self, m.sis)
    addSpouse(m.bro, m.bro_wife)
    addSpouse(m.sis, m.sis_husb)

    return m
  }

  it('self(男) → bro_wife (兄弟的配偶) = 嫂子/弟媳', () => {
    const m = buildSistersInLawFixture()
    expect(getKinship('self', 'bro_wife', m)).toBe('嫂子/弟媳')
  })

  it('wife → bro_wife (妯娌)', () => {
    const m = buildSistersInLawFixture()
    expect(getKinship('wife', 'bro_wife', m)).toBe('妯娌')
  })

  it('wife → sis_husb (连襟)', () => {
    const m = buildSistersInLawFixture()
    expect(getKinship('wife', 'sis_husb', m)).toBe('连襟')
  })
})

// ========================= 新增测试：外孙/外孙女 =========================

describe('getKinship — 外孙/外孙女（通过女儿的后代）', () => {
  function buildGrandchildFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      son: mk('son', 'male'),
      daughter: mk('daughter', 'female'),
      gson: mk('gson', 'male'),           // 儿子的儿子
      gdau: mk('gdau', 'female'),         // 儿子的女儿
      gson_d: mk('gson_d', 'male'),       // 女儿的儿子
      gdau_d: mk('gdau_d', 'female'),     // 女儿的女儿
      gson_gson: mk('gson_gson', 'male'), // 儿子的儿子的儿子
      gson_d_gson: mk('gson_d_gson', 'male'), // 女儿的儿子的儿子
    }
    const addParent = (child: Member, parent: Member) => {
      child.parents.push({ id: parent.id, type: 'blood' })
      parent.children.push({ id: child.id, type: 'blood' })
    }
    addParent(m.son, m.self)
    addParent(m.daughter, m.self)
    addParent(m.gson, m.son)
    addParent(m.gdau, m.son)
    addParent(m.gson_d, m.daughter)
    addParent(m.gdau_d, m.daughter)
    addParent(m.gson_gson, m.gson)
    addParent(m.gson_d_gson, m.gson_d)
    return m
  }

  const m = buildGrandchildFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'gson', '孙子'],
    ['self', 'gdau', '孙女'],
    ['self', 'gson_d', '外孙'],
    ['self', 'gdau_d', '外孙女'],
    ['self', 'gson_gson', '曾孙'],
    ['self', 'gson_d_gson', '外曾孙'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

// ========================= 新增测试：堂/表兄弟姐妹年龄区分 =========================

describe('getKinship — 堂/表兄弟姐妹年龄区分', () => {
  function buildCousinAgeFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
      id, firstName: id, lastName: '', gender, birthDate,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male', '1990-01-01'),
      dad: mk('dad', 'male', '1960-01-01'),
      mom: mk('mom', 'female', '1962-01-01'),
      gpa: mk('gpa', 'male'),
      gma: mk('gma', 'female'),
      uncle_p: mk('uncle_p', 'male'),
      aunt_p: mk('aunt_p', 'female'),
      mgp: mk('mgp', 'male'),
      mgm: mk('mgm', 'female'),
      aunt_m: mk('aunt_m', 'female'),
      // 堂兄弟（比自己年长）
      cousin_p_m_older: mk('cousin_p_m_older', 'male', '1985-01-01'),
      // 堂兄弟（比自己年幼）
      cousin_p_m_younger: mk('cousin_p_m_younger', 'male', '1995-01-01'),
      // 表姐妹（比自己年长）
      cousin_m_f_older: mk('cousin_m_f_older', 'female', '1987-01-01'),
      // 表姐妹（比自己年幼）
      cousin_m_f_younger: mk('cousin_m_f_younger', 'female', '1993-01-01'),
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
    addSpouse(m.dad, m.mom)
    addParent(m.dad, m.gpa)
    addParent(m.dad, m.gma)
    addSpouse(m.gpa, m.gma)
    addParent(m.mom, m.mgp)
    addParent(m.mom, m.mgm)
    addSpouse(m.mgp, m.mgm)
    addParent(m.uncle_p, m.gpa)
    addParent(m.uncle_p, m.gma)
    addSibling(m.uncle_p, m.dad)
    addParent(m.aunt_p, m.gpa)
    addParent(m.aunt_p, m.gma)
    addSibling(m.aunt_p, m.dad)
    addParent(m.aunt_m, m.mgp)
    addParent(m.aunt_m, m.mgm)
    addSibling(m.aunt_m, m.mom)
    addParent(m.cousin_p_m_older, m.uncle_p)
    addParent(m.cousin_p_m_younger, m.uncle_p)
    addParent(m.cousin_m_f_older, m.aunt_m)
    addParent(m.cousin_m_f_younger, m.aunt_m)
    return m
  }

  const m = buildCousinAgeFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'cousin_p_m_older', '堂兄'],
    ['self', 'cousin_p_m_younger', '堂弟'],
    ['self', 'cousin_m_f_older', '表姐'],
    ['self', 'cousin_m_f_younger', '表妹'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

// ========================= 新增测试：堂/表侄辈配偶 =========================

describe('getKinship — 堂/表侄辈配偶', () => {
  function buildCousinNephewSpouseFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      dad: mk('dad', 'male'),
      mom: mk('mom', 'female'),
      gpa: mk('gpa', 'male'),
      gma: mk('gma', 'female'),
      uncle_p: mk('uncle_p', 'male'),
      aunt_m: mk('aunt_m', 'female'),
      mgp: mk('mgp', 'male'),
      mgm: mk('mgm', 'female'),
      cousin_p_m: mk('cousin_p_m', 'male'),       // 堂兄弟
      cousin_p_m_son: mk('cousin_p_m_son', 'male'),     // 堂侄
      cousin_p_m_son_wife: mk('cousin_p_m_son_wife', 'female'), // 堂侄媳
      cousin_p_m_dau: mk('cousin_p_m_dau', 'female'),   // 堂侄女
      cousin_p_m_dau_husb: mk('cousin_p_m_dau_husb', 'male'), // 堂侄女婿
      cousin_m_f: mk('cousin_m_f', 'female'),       // 表姐妹
      cousin_m_f_son: mk('cousin_m_f_son', 'male'),     // 表外甥
      cousin_m_f_son_wife: mk('cousin_m_f_son_wife', 'female'), // 表甥媳
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
    addParent(m.dad, m.gpa)
    addParent(m.dad, m.gma)
    addParent(m.mom, m.mgp)
    addParent(m.mom, m.mgm)
    addParent(m.uncle_p, m.gpa)
    addParent(m.uncle_p, m.gma)
    addSibling(m.uncle_p, m.dad)
    addParent(m.aunt_m, m.mgp)
    addParent(m.aunt_m, m.mgm)
    addSibling(m.aunt_m, m.mom)
    addParent(m.cousin_p_m, m.uncle_p)
    addParent(m.cousin_p_m_son, m.cousin_p_m)
    addSpouse(m.cousin_p_m_son, m.cousin_p_m_son_wife)
    addParent(m.cousin_p_m_dau, m.cousin_p_m)
    addSpouse(m.cousin_p_m_dau, m.cousin_p_m_dau_husb)
    addParent(m.cousin_m_f, m.aunt_m)
    addParent(m.cousin_m_f_son, m.cousin_m_f)
    addSpouse(m.cousin_m_f_son, m.cousin_m_f_son_wife)
    return m
  }

  const m = buildCousinNephewSpouseFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'cousin_p_m_son', '堂侄'],
    ['self', 'cousin_p_m_son_wife', '堂侄媳'],
    ['self', 'cousin_p_m_dau', '堂侄女'],
    ['self', 'cousin_p_m_dau_husb', '堂侄女婿'],
    ['self', 'cousin_m_f_son', '表外甥'],
    ['self', 'cousin_m_f_son_wife', '表甥媳'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

// ========================= 新增测试：养父/养母 =========================

describe('getKinship — 养父/养母（adopted parent）', () => {
  function buildAdoptedParentFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      adopt_dad: mk('adopt_dad', 'male'),
      adopt_mom: mk('adopt_mom', 'female'),
      bio_dad: mk('bio_dad', 'male'),
      bio_mom: mk('bio_mom', 'female'),
    }
    m.self.parents.push({ id: 'bio_dad', type: 'blood' })
    m.bio_dad.children.push({ id: 'self', type: 'blood' })
    m.self.parents.push({ id: 'bio_mom', type: 'blood' })
    m.bio_mom.children.push({ id: 'self', type: 'blood' })
    m.self.parents.push({ id: 'adopt_dad', type: 'adopted' })
    m.adopt_dad.children.push({ id: 'self', type: 'adopted' })
    m.self.parents.push({ id: 'adopt_mom', type: 'adopted' })
    m.adopt_mom.children.push({ id: 'self', type: 'adopted' })
    return m
  }
  const m = buildAdoptedParentFixture()
  it('adopted parent 男 → 养父', () => {
    expect(getKinship('self', 'adopt_dad', m)).toBe('养父')
  })
  it('adopted parent 女 → 养母', () => {
    expect(getKinship('self', 'adopt_mom', m)).toBe('养母')
  })
  it('blood parent 男 → 父亲', () => {
    expect(getKinship('self', 'bio_dad', m)).toBe('父亲')
  })
  it('blood parent 女 → 母亲', () => {
    expect(getKinship('self', 'bio_mom', m)).toBe('母亲')
  })
})

// ========================= 新增测试：堂兄弟配偶年龄区分 =========================

describe('getKinship — 堂兄弟配偶年龄区分', () => {
  function buildCousinSpouseAgeFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
      id, firstName: id, lastName: '', gender, birthDate,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male', '1990-01-01'),
      dad: mk('dad', 'male'),
      gpa: mk('gpa', 'male'),
      gma: mk('gma', 'female'),
      uncle_p: mk('uncle_p', 'male'),
      cousin_p_m_older: mk('cousin_p_m_older', 'male', '1985-01-01'),
      cousin_p_m_older_wife: mk('cousin_p_m_older_wife', 'female'),
      cousin_p_m_younger: mk('cousin_p_m_younger', 'male', '1995-01-01'),
      cousin_p_m_younger_wife: mk('cousin_p_m_younger_wife', 'female'),
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
    addParent(m.dad, m.gpa)
    addParent(m.dad, m.gma)
    addSpouse(m.gpa, m.gma)
    addParent(m.uncle_p, m.gpa)
    addParent(m.uncle_p, m.gma)
    addSibling(m.uncle_p, m.dad)
    addParent(m.cousin_p_m_older, m.uncle_p)
    addSpouse(m.cousin_p_m_older, m.cousin_p_m_older_wife)
    addParent(m.cousin_p_m_younger, m.uncle_p)
    addSpouse(m.cousin_p_m_younger, m.cousin_p_m_younger_wife)
    return m
  }

  const m = buildCousinSpouseAgeFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'cousin_p_m_older', '堂兄'],
    ['self', 'cousin_p_m_older_wife', '堂嫂'],
    ['self', 'cousin_p_m_younger', '堂弟'],
    ['self', 'cousin_p_m_younger_wife', '堂弟媳'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})

// ========================= 新增测试：祖辈旁系亲属的配偶 =========================

describe('getKinship — 祖辈旁系亲属的配偶', () => {
  function buildGrandUncleSpouseFixture(): Record<string, Member> {
    const mk = (id: string, gender: 'male' | 'female'): Member => ({
      id, firstName: id, lastName: '', gender,
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    })
    const m: Record<string, Member> = {
      self: mk('self', 'male'),
      dad: mk('dad', 'male'),
      mom: mk('mom', 'female'),
      gpa: mk('gpa', 'male'),
      gma: mk('gma', 'female'),
      great_gpa: mk('great_gpa', 'male'),
      great_gma: mk('great_gma', 'female'),
      // 爷爷的兄弟 = 叔公
      granduncle: mk('granduncle', 'male'),
      granduncle_wife: mk('granduncle_wife', 'female'),
      // 爷爷的姐妹 = 姑奶奶
      grandaunt: mk('grandaunt', 'female'),
      grandaunt_husb: mk('grandaunt_husb', 'male'),
      // 外公的兄弟 = 舅姥爷
      granduncle_m: mk('granduncle_m', 'male'),
      granduncle_m_wife: mk('granduncle_m_wife', 'female'),
      // 外公的姐妹 = 姨姥
      grandaunt_m: mk('grandaunt_m', 'female'),
      grandaunt_m_husb: mk('grandaunt_m_husb', 'male'),
      mgp: mk('mgp', 'male'),
      mgm: mk('mgm', 'female'),
      mgp_father: mk('mgp_father', 'male'),
      mgp_mother: mk('mgp_mother', 'female'),
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
    // 父系
    addParent(m.self, m.dad)
    addParent(m.self, m.mom)
    addSpouse(m.dad, m.mom)
    addParent(m.dad, m.gpa)
    addParent(m.dad, m.gma)
    addSpouse(m.gpa, m.gma)
    addParent(m.gpa, m.great_gpa)
    addParent(m.gpa, m.great_gma)
    addSpouse(m.great_gpa, m.great_gma)
    // 叔公（爷爷的兄弟）
    addParent(m.granduncle, m.great_gpa)
    addParent(m.granduncle, m.great_gma)
    addSibling(m.granduncle, m.gpa)
    addSpouse(m.granduncle, m.granduncle_wife)
    // 姑奶奶（爷爷的姐妹）
    addParent(m.grandaunt, m.great_gpa)
    addParent(m.grandaunt, m.great_gma)
    addSibling(m.grandaunt, m.gpa)
    addSpouse(m.grandaunt, m.grandaunt_husb)
    // 母系
    addParent(m.mom, m.mgp)
    addParent(m.mom, m.mgm)
    addSpouse(m.mgp, m.mgm)
    addParent(m.mgp, m.mgp_father)
    addParent(m.mgp, m.mgp_mother)
    addSpouse(m.mgp_father, m.mgp_mother)
    // 舅姥爷（外公的兄弟）
    addParent(m.granduncle_m, m.mgp_father)
    addParent(m.granduncle_m, m.mgp_mother)
    addSibling(m.granduncle_m, m.mgp)
    addSpouse(m.granduncle_m, m.granduncle_m_wife)
    // 姨姥（外公的姐妹）
    addParent(m.grandaunt_m, m.mgp_father)
    addParent(m.grandaunt_m, m.mgp_mother)
    addSibling(m.grandaunt_m, m.mgp)
    addSpouse(m.grandaunt_m, m.grandaunt_m_husb)
    return m
  }

  const m = buildGrandUncleSpouseFixture()
  const cases: Array<[string, string, string]> = [
    ['self', 'granduncle', '叔公'],
    ['self', 'granduncle_wife', '叔婆'],
    ['self', 'grandaunt', '姑奶奶'],
    ['self', 'grandaunt_husb', '姑爷爷'],
    ['self', 'granduncle_m', '舅姥爷'],
    ['self', 'granduncle_m_wife', '舅姥姥'],
    ['self', 'grandaunt_m', '姨姥'],
    ['self', 'grandaunt_m_husb', '姨姥爷'],
  ]
  for (const [from, to, expected] of cases) {
    it(`${from} → ${to} = ${expected}`, () => {
      expect(getKinship(from, to, m)).toBe(expected)
    })
  }
})
