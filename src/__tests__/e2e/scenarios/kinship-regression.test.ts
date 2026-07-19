/**
 * L3: Agent 驱动的称谓全量回归场景
 *
 * 构建完整四代家族 fixture，对每个关键成员做全视角称谓遍历验证。
 * Agent 的价值：自动发现遗漏的称谓映射、边缘 case、非对称关系。
 */
import { describe, it, expect } from 'vitest'
import { getKinship } from '@/core/kinship'
import type { Member } from '@/core/schema'

// ============ 完整四代家族 fixture ============
function buildComprehensiveFixture(): Record<string, Member> {
  const mk = (id: string, gender: 'male' | 'female', birthDate?: string): Member => ({
    id, firstName: id, lastName: '',
    gender, birthDate,
    parents: [], children: [], siblings: [], spouses: [],
    godparents: [], godchildren: [],
  })

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

  const m: Record<string, Member> = {
    // === self & 核心家庭 ===
    self:   mk('self',   'male',   '1990-01-01'),
    wife:   mk('wife',   'female', '1992-03-15'),
    son:    mk('son',    'male',   '2018-07-20'),
    daughter: mk('daughter', 'female', '2020-11-05'),

    // === self 的兄弟姐妹 ===
    bro:    mk('bro',    'male',   '1988-05-10'),
    sis:    mk('sis',    'female', '1993-08-22'),

    // === 兄弟的子女 ===
    nephew:  mk('nephew',  'male',   '2015-03-01'),
    niece:   mk('niece',   'female', '2017-09-12'),

    // === 姐妹的子女 ===
    nephew_s: mk('nephew_s', 'male',   '2019-02-14'),
    niece_s:  mk('niece_s',  'female', '2021-06-30'),

    // === 父系 ===
    dad:    mk('dad',    'male',   '1960-03-01'),
    mom:    mk('mom',    'female', '1962-07-15'),

    // 父亲的兄弟姐妹
    uncle_p: mk('uncle_p', 'male',   '1965-11-20'),  // 叔叔
    aunt_p:  mk('aunt_p',  'female', '1968-04-08'),  // 姑姑

    // 叔叔的子女 = 堂兄弟姐妹
    cousin_p_m: mk('cousin_p_m', 'male',   '1995-06-01'),   // 堂弟
    cousin_p_f: mk('cousin_p_f', 'female', '1992-12-20'),   // 堂姐

    // 姑姑的子女 = 表兄弟姐妹
    cousin_ap_m: mk('cousin_ap_m', 'male',   '1994-03-10'),  // 表兄(姑)
    cousin_ap_f: mk('cousin_ap_f', 'female', '1997-08-25'),  // 表妹(姑)

    // === 父系祖辈 ===
    gpa:    mk('gpa',    'male',   '1935-02-10'),
    gma:    mk('gma',    'female', '1938-09-15'),

    // === 母系 ===
    mgp:    mk('mgp',    'male',   '1937-04-20'),
    mgm:    mk('mgm',    'female', '1940-11-05'),

    // 母亲的兄弟姐妹
    uncle_m: mk('uncle_m', 'male',   '1964-01-30'),  // 舅舅
    aunt_m:  mk('aunt_m',  'female', '1970-06-18'),  // 姨

    // 舅舅的子女 = 表兄弟姐妹
    cousin_m_m: mk('cousin_m_m', 'male',   '1993-09-05'),   // 表兄(舅)
    cousin_m_f: mk('cousin_m_f', 'female', '1996-04-15'),   // 表姐(舅)

    // 姨的子女 = 表兄弟姐妹
    cousin_am_m: mk('cousin_am_m', 'male',   '1995-01-08'),  // 表弟(姨)
    cousin_am_f: mk('cousin_am_f', 'female', '1998-07-22'),  // 表妹(姨)

    // === 妻子的父母 ===
    wife_dad: mk('wife_dad', 'male',   '1965-01-01'),
    wife_mom: mk('wife_mom', 'female', '1967-06-06'),

    // === 第四代 (儿子的子女 - self 的孙辈) ===
    grandson:  mk('grandson',  'male',   '2045-01-01'),
    granddaughter: mk('granddaughter', 'female', '2048-01-01'),
  }

  // ---- 关系连线 ----

  // self 的核心
  addSpouse(m.self, m.wife)
  addParent(m.self, m.dad)
  addParent(m.self, m.mom)
  addParent(m.son, m.self)
  addParent(m.son, m.wife)
  addParent(m.daughter, m.self)
  addParent(m.daughter, m.wife)
  addSpouse(m.dad, m.mom)

  // self 的兄弟姐妹
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addParent(m.sis, m.dad)
  addParent(m.sis, m.mom)
  addSibling(m.self, m.bro)
  addSibling(m.self, m.sis)

  // 兄弟的子女
  addParent(m.nephew, m.bro)
  addParent(m.niece, m.bro)
  // 姐妹的子女
  addParent(m.nephew_s, m.sis)
  addParent(m.niece_s, m.sis)

  // 父系祖辈
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addSpouse(m.gpa, m.gma)

  // 父亲的兄弟姐妹
  addParent(m.uncle_p, m.gpa)
  addParent(m.uncle_p, m.gma)
  addParent(m.aunt_p, m.gpa)
  addParent(m.aunt_p, m.gma)
  addSibling(m.dad, m.uncle_p)
  addSibling(m.dad, m.aunt_p)

  // 叔叔的子女
  addParent(m.cousin_p_m, m.uncle_p)
  addParent(m.cousin_p_f, m.uncle_p)
  // 姑姑的子女
  addParent(m.cousin_ap_m, m.aunt_p)
  addParent(m.cousin_ap_f, m.aunt_p)

  // 母系祖辈
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.mgp, m.mgm)

  // 母亲的兄弟姐妹
  addParent(m.uncle_m, m.mgp)
  addParent(m.uncle_m, m.mgm)
  addParent(m.aunt_m, m.mgp)
  addParent(m.aunt_m, m.mgm)
  addSibling(m.mom, m.uncle_m)
  addSibling(m.mom, m.aunt_m)

  // 舅舅的子女
  addParent(m.cousin_m_m, m.uncle_m)
  addParent(m.cousin_m_f, m.uncle_m)
  // 姨的子女
  addParent(m.cousin_am_m, m.aunt_m)
  addParent(m.cousin_am_f, m.aunt_m)

  // 妻子的父母
  addParent(m.wife, m.wife_dad)
  addParent(m.wife, m.wife_mom)
  addSpouse(m.wife_dad, m.wife_mom)

  // 第四代 (孙辈)
  addParent(m.grandson, m.son)
  addParent(m.granddaughter, m.son)

  return m
}

// ============ 测试 ============
const m = buildComprehensiveFixture()

describe('L3 称谓全量回归 — self 视角', () => {
  // ---- 直系 ----
  it('self → 父亲', () => expect(getKinship('self', 'dad', m)).toBe('父亲'))
  it('self → 母亲', () => expect(getKinship('self', 'mom', m)).toBe('母亲'))
  it('self → 儿子', () => expect(getKinship('self', 'son', m)).toBe('儿子'))
  it('self → 女儿', () => expect(getKinship('self', 'daughter', m)).toBe('女儿'))
  it('self → 妻子', () => expect(getKinship('self', 'wife', m)).toBe('妻子'))

  // ---- 祖辈 ----
  it('self → 爷爷', () => expect(getKinship('self', 'gpa', m)).toBe('爷爷'))
  it('self → 奶奶', () => expect(getKinship('self', 'gma', m)).toBe('奶奶'))
  it('self → 外公', () => expect(getKinship('self', 'mgp', m)).toBe('外公'))
  it('self → 外婆', () => expect(getKinship('self', 'mgm', m)).toBe('外婆'))

  // ---- 兄弟姐妹 ----
  it('self → 哥哥', () => expect(getKinship('self', 'bro', m)).toBe('哥哥'))
  it('self → 妹妹', () => expect(getKinship('self', 'sis', m)).toBe('妹妹'))

  // ---- 父系叔伯姑 ----
  it('self → 叔叔', () => expect(getKinship('self', 'uncle_p', m)).toBe('叔叔'))
  it('self → 姑姑', () => expect(getKinship('self', 'aunt_p', m)).toBe('姑姑'))

  // ---- 母系舅姨 ----
  it('self → 舅舅', () => expect(getKinship('self', 'uncle_m', m)).toBe('舅舅'))
  it('self → 姨', () => expect(getKinship('self', 'aunt_m', m)).toBe('姨'))

  // ---- 堂兄弟姐妹 (父系兄弟的子女) ----
  it('self → 堂弟', () => expect(getKinship('self', 'cousin_p_m', m)).toBe('堂弟'))
  // birthDate=1992, self=1990 → 年幼女性为堂妹
  it('self → 堂妹', () =>
    expect(getKinship('self', 'cousin_p_f', m)).toBe('堂妹'))

  // ---- 表兄弟姐妹 (姑的子女) ----
  // birthDate=1994, self=1990 → 年幼男性为表弟
  it('self → 表弟(姑)', () =>
    expect(getKinship('self', 'cousin_ap_m', m)).toBe('表弟'))
  it('self → 表妹(姑)', () => expect(getKinship('self', 'cousin_ap_f', m)).toBe('表妹'))

  // ---- 表兄弟姐妹 (舅的子女) ----
  it('self → 表弟(舅)', () =>
    expect(getKinship('self', 'cousin_m_m', m)).toBe('表弟'))
  it('self → 表妹(舅)', () =>
    expect(getKinship('self', 'cousin_m_f', m)).toBe('表妹'))

  // ---- 表兄弟姐妹 (姨的子女) ----
  it('self → 表弟(姨)', () => expect(getKinship('self', 'cousin_am_m', m)).toBe('表弟'))
  it('self → 表妹(姨)', () => expect(getKinship('self', 'cousin_am_f', m)).toBe('表妹'))

  // ---- 侄子侄女 (兄弟的子女) ----
  it('self → 侄子', () => expect(getKinship('self', 'nephew', m)).toBe('侄子'))
  it('self → 侄女', () => expect(getKinship('self', 'niece', m)).toBe('侄女'))

  // ---- 外甥/外甥女 (姐妹的子女) ----
  it('self → 外甥', () => expect(getKinship('self', 'nephew_s', m)).toBe('外甥'))
  it('self → 外甥女', () => expect(getKinship('self', 'niece_s', m)).toBe('外甥女'))

  // ---- 孙辈 ----
  it('self → 孙子', () => expect(getKinship('self', 'grandson', m)).toBe('孙子'))
  it('self → 孙女', () => expect(getKinship('self', 'granddaughter', m)).toBe('孙女'))

  // ---- 姻亲 ----
  it('self → 岳父', () => expect(getKinship('self', 'wife_dad', m)).toBe('岳父'))
  it('self → 岳母', () => expect(getKinship('self', 'wife_mom', m)).toBe('岳母'))
})

describe('L3 称谓全量回归 — 非对称关系', () => {
  it('父亲 → self (反向)', () => expect(getKinship('dad', 'self', m)).toBe('儿子'))
  it('爷爷 → self', () => expect(getKinship('gpa', 'self', m)).toBe('孙子'))
  it('叔叔 → self', () => expect(getKinship('uncle_p', 'self', m)).toBe('侄子'))

  it('妻子 → self', () => expect(getKinship('wife', 'self', m)).toBe('丈夫'))
  it('妻子 → 岳父 (她父亲)', () => expect(getKinship('wife', 'wife_dad', m)).toBe('父亲'))

  it('兄弟 → 姐妹', () => expect(getKinship('bro', 'sis', m)).toBe('妹妹'))
  it('姐妹 → 兄弟', () => expect(getKinship('sis', 'bro', m)).toBe('哥哥'))
})

describe('L3 称谓全量回归 — 跨代/旁系', () => {
  it('self → 堂兄弟的子女 (堂侄)', () => {
    expect(getKinship('dad', 'cousin_p_m', m)).toBe('侄子')
  })

  it('self 的子女 → 爷爷', () => {
    expect(getKinship('son', 'gpa', m)).toBe('曾祖父')
  })

  it('self 的子女 → 外公', () => {
    expect(getKinship('son', 'mgp', m)).toBe('曾祖父')
  })

  it('self 的子女 → 叔叔', () => {
    expect(getKinship('son', 'uncle_p', m)).toBe('叔公')
  })

  it('self 的子女 → 舅舅', () => {
    expect(getKinship('son', 'uncle_m', m)).toBe('舅爷爷')
  })
})

describe('L3 边界场景', () => {
  it('自己查自己 → 本人', () => {
    expect(getKinship('self', 'self', m)).toBe('本人')
  })

  it('不在关系网中的人返回 null', () => {
    const stranger: Member = {
      id: 'stranger', firstName: 'S', lastName: '',
      gender: 'male',
      parents: [], children: [], siblings: [], spouses: [],
      godparents: [], godchildren: [],
    }
    const result = getKinship('self', 'stranger', { ...m, stranger })
    expect(result).toBeNull()
  })

  it('通过妻子的关系链可达', () => {
    // self 的岳母，从 self 通过 wife → wife_mom
    expect(getKinship('self', 'wife_mom', m)).toBe('岳母')
  })
})
