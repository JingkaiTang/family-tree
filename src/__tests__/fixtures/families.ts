/**
 * 共享测试 fixture — 多套预定义家族结构，供 L2/L3 测试复用
 */
import type { Member } from '@/core/schema'

/** 快速构造最小 Member 对象 */
export function mk(
  id: string,
  opts: {
    gender?: Member['gender']
    firstName?: string
    lastName?: string
    birthDate?: string
  } = {},
): Member {
  return {
    id,
    firstName: opts.firstName ?? id,
    lastName: opts.lastName ?? '',
    gender: opts.gender ?? 'other',
    birthDate: opts.birthDate,
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  }
}

/** 建立双向亲子关系 */
export function addParent(child: Member, parent: Member, type: 'blood' | 'adopted' | 'step' = 'blood') {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}

/** 建立双向配偶关系 */
export function addSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

/** 建立双向兄弟姐妹关系 */
export function addSibling(a: Member, b: Member) {
  a.siblings.push({ id: b.id, type: 'blood' })
  b.siblings.push({ id: a.id, type: 'blood' })
}

// ============ 预定义家族结构 ============

/**
 * 经典三代同堂 (7人)
 *
 *   爷爷(gpa)──奶奶(gma)     外公(mgp)──外婆(mgm)
 *         │                        │
 *         └────父亲(dad)──母亲(mom)─┘
 *                   │
 *                自己(self)
 */
export function threeGenFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    self: mk('self', { gender: 'male' }),
    dad: mk('dad', { gender: 'male' }),
    mom: mk('mom', { gender: 'female' }),
    gpa: mk('gpa', { gender: 'male' }),
    gma: mk('gma', { gender: 'female' }),
    mgp: mk('mgp', { gender: 'male' }),
    mgm: mk('mgm', { gender: 'female' }),
  }
  addParent(m.self, m.dad)
  addParent(m.self, m.mom)
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.dad, m.mom)
  addSpouse(m.gpa, m.gma)
  addSpouse(m.mgp, m.mgm)
  return m
}

/**
 * 核心成员数组版（供 relativesAdapter 测试使用）
 */
export function threeGenMemberArray(): Member[] {
  return Object.values(threeGenFamily())
}

/**
 * 带兄弟姐妹的四代结构 (15+人)
 * 覆盖：兄弟、姐妹、堂亲、表亲、叔伯、姑姑、舅舅、姨
 */
export function extendedFamily(): Record<string, Member> {
  const m = threeGenFamily()

  // self 的兄弟和姐妹
  m.bro = mk('bro', { gender: 'male' })
  m.sis = mk('sis', { gender: 'female' })
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addParent(m.sis, m.dad)
  addParent(m.sis, m.mom)
  addSibling(m.self, m.bro)
  addSibling(m.self, m.sis)

  // dad 的兄弟 (叔叔) 和姐妹 (姑姑)
  m.uncle_p = mk('uncle_p', { gender: 'male' })
  m.aunt_p = mk('aunt_p', { gender: 'female' })
  addParent(m.uncle_p, m.gpa)
  addParent(m.uncle_p, m.gma)
  addParent(m.aunt_p, m.gpa)
  addParent(m.aunt_p, m.gma)
  addSibling(m.dad, m.uncle_p)
  addSibling(m.dad, m.aunt_p)

  // mom 的兄弟 (舅舅) 和姐妹 (姨)
  m.uncle_m = mk('uncle_m', { gender: 'male' })
  m.aunt_m = mk('aunt_m', { gender: 'female' })
  addParent(m.uncle_m, m.mgp)
  addParent(m.uncle_m, m.mgm)
  addParent(m.aunt_m, m.mgp)
  addParent(m.aunt_m, m.mgm)
  addSibling(m.mom, m.uncle_m)
  addSibling(m.mom, m.aunt_m)

  return m
}
