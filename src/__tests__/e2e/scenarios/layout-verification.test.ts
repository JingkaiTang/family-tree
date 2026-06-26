/**
 * L3-P2: Agent 驱动的布局验证场景
 *
 * 对多种家族结构做布局正确性自动验证：
 * - 父母在子女上方
 * - 配偶在同一 generation（同行）
 * - 兄弟姐妹在同一 generation
 * - 节点不重叠
 * - 画布尺寸合理
 */
import { describe, it, expect } from 'vitest'
import { layoutWithElk } from '@/core/elkLayout'
import { layoutFamilyTree } from '@/core/treeLayout'
import { mk, addParent, addSpouse, addSibling, multiUnionFamily } from '@/__tests__/fixtures/families'
import type { Member } from '@/core/schema'

const NODE_W = 2  // cell 单位宽度
const NODE_H = 4  // cell 单位高度

// ===== 工具函数 =====
function nonOverlapping(nodes: Array<{ cx: number; top: number }>): boolean {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const aLeft = a.cx - NODE_W / 2, aRight = a.cx + NODE_W / 2
      const bLeft = b.cx - NODE_W / 2, bRight = b.cx + NODE_W / 2
      const aBottom = a.top + NODE_H, bBottom = b.top + NODE_H
      if (!(aRight <= bLeft || bRight <= aLeft || aBottom <= b.top || bBottom <= a.top)) {
        return false
      }
    }
  }
  return true
}

// ===== 场景构造 =====

/** 单人 */
function oneMember(): Member[] {
  return [mk('A', { gender: 'male' })]
}

/** 夫妻 */
function couple(): Member[] {
  const a = mk('H', { gender: 'male' })
  const b = mk('W', { gender: 'female' })
  addSpouse(a, b)
  return [a, b]
}

/** 父子 */
function parentChild(): Member[] {
  const p = mk('P', { gender: 'male' })
  const c = mk('C', { gender: 'male' })
  addParent(c, p)
  return [p, c]
}

/** 三口之家 */
function nuclearFamily(): Member[] {
  const dad = mk('dad', { gender: 'male' })
  const mom = mk('mom', { gender: 'female' })
  const kid = mk('kid', { gender: 'male' })
  addSpouse(dad, mom)
  addParent(kid, dad)
  addParent(kid, mom)
  return [dad, mom, kid]
}

/** 三代同堂 */
function threeGen(): Member[] {
  const m: Record<string, Member> = {
    gpa: mk('gpa', { gender: 'male' }),
    gma: mk('gma', { gender: 'female' }),
    dad: mk('dad', { gender: 'male' }),
    mom: mk('mom', { gender: 'female' }),
    self: mk('self', { gender: 'male' }),
  }
  addSpouse(m.gpa, m.gma)
  addSpouse(m.dad, m.mom)
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addParent(m.self, m.dad)
  addParent(m.self, m.mom)
  return Object.values(m)
}

/** 有兄弟姐妹的家庭 */
function withSiblings(): Member[] {
  const m: Record<string, Member> = {
    dad: mk('dad', { gender: 'male' }),
    mom: mk('mom', { gender: 'female' }),
    c1: mk('c1', { gender: 'male' }),  // self
    c2: mk('c2', { gender: 'male' }),  // bro
    c3: mk('c3', { gender: 'female' }), // sis
  }
  addSpouse(m.dad, m.mom)
  addParent(m.c1, m.dad); addParent(m.c1, m.mom)
  addParent(m.c2, m.dad); addParent(m.c2, m.mom)
  addParent(m.c3, m.dad); addParent(m.c3, m.mom)
  addSibling(m.c1, m.c2)
  addSibling(m.c1, m.c3)
  return Object.values(m)
}

/** 多代祖辈 */
function fourGen(): Member[] {
  const m: Record<string, Member> = {
    ggp: mk('ggp', { gender: 'male' }),
    ggm: mk('ggm', { gender: 'female' }),
    gpa: mk('gpa', { gender: 'male' }),
    gma: mk('gma', { gender: 'female' }),
    dad: mk('dad', { gender: 'male' }),
    mom: mk('mom', { gender: 'female' }),
    self: mk('self', { gender: 'male' }),
  }
  addSpouse(m.ggp, m.ggm)
  addSpouse(m.gpa, m.gma)
  addSpouse(m.dad, m.mom)
  addParent(m.gpa, m.ggp); addParent(m.gpa, m.ggm)
  addParent(m.dad, m.gpa); addParent(m.dad, m.gma)
  addParent(m.self, m.dad); addParent(m.self, m.mom)
  return Object.values(m)
}

/** 孤立成员（无关系） */
function isolatedMembers(): Member[] {
  return [
    mk('A', { gender: 'male' }),
    mk('B', { gender: 'female' }),
    mk('C', { gender: 'other' }),
  ]
}

/** 单亲家庭 */
function singleParent(): Member[] {
  const p = mk('mom', { gender: 'female' })
  const c = mk('kid', { gender: 'male' })
  addParent(c, p)
  return [p, c]
}

// ===== 测试 =====

describe('L3 布局验证 — 基本层级', () => {
  it('单人布局生成一个节点', async () => {
    const r = await layoutWithElk(oneMember())
    expect(r.nodes).toHaveLength(1)
    expect(r.nodes[0].id).toBe('A')
    expect(r.canvas.width).toBeGreaterThan(0)
  })

  it('父子：父亲在儿子上方', async () => {
    const r = await layoutWithElk(parentChild())
    const p = r.nodes.find((n) => n.id === 'P')!
    const c = r.nodes.find((n) => n.id === 'C')!
    expect(p.generation).toBeLessThan(c.generation)
    expect(p.top).toBeLessThan(c.top)
  })

  it('夫妻：同一 generation 且水平排列', async () => {
    const r = await layoutWithElk(couple())
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes[0].generation).toBe(r.nodes[1].generation)
    expect(r.nodes[0].top).toBe(r.nodes[1].top)
    expect(Math.abs(r.nodes[0].cx - r.nodes[1].cx)).toBeGreaterThanOrEqual(2)
  })

  it('三口之家：父母同行，子女在下方', async () => {
    const r = await layoutWithElk(nuclearFamily())
    const dad = r.nodes.find((n) => n.id === 'dad')!
    const mom = r.nodes.find((n) => n.id === 'mom')!
    const kid = r.nodes.find((n) => n.id === 'kid')!
    expect(dad.generation).toBe(mom.generation)
    expect(kid.generation).toBeGreaterThan(dad.generation)
  })

  it('兄弟姐妹：同一 generation', async () => {
    const r = await layoutWithElk(withSiblings())
    const c1 = r.nodes.find((n) => n.id === 'c1')!
    const c2 = r.nodes.find((n) => n.id === 'c2')!
    const c3 = r.nodes.find((n) => n.id === 'c3')!
    expect(c1.generation).toBe(c2.generation)
    expect(c1.generation).toBe(c3.generation)
  })
})

describe('L3 布局验证 — 无重叠', () => {
  it('单人', async () => {
    const r = await layoutWithElk(oneMember())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('夫妻', async () => {
    const r = await layoutWithElk(couple())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('父子', async () => {
    const r = await layoutWithElk(parentChild())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('三口之家', async () => {
    const r = await layoutWithElk(nuclearFamily())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('三代同堂', async () => {
    const r = await layoutWithElk(threeGen())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('四代', async () => {
    const r = await layoutWithElk(fourGen())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('有兄弟姐妹', async () => {
    const r = await layoutWithElk(withSiblings())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('孤立成员', async () => {
    const r = await layoutWithElk(isolatedMembers())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })

  it('单亲家庭', async () => {
    const r = await layoutWithElk(singleParent())
    expect(nonOverlapping(r.nodes)).toBe(true)
  })
})

describe('L3 布局验证 — generation 连续性', () => {
  it('三代：generation 严格递增', async () => {
    const r = await layoutWithElk(threeGen())
    const gens = [...new Set(r.nodes.map((n) => n.generation))].sort((a, b) => a - b)
    // 三层代际
    expect(gens.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < gens.length; i++) {
      expect(gens[i]).toBeGreaterThan(gens[i - 1])
    }
  })

  it('四代：generation 严格递增', async () => {
    const r = await layoutWithElk(fourGen())
    const gens = [...new Set(r.nodes.map((n) => n.generation))].sort((a, b) => a - b)
    expect(gens.length).toBeGreaterThanOrEqual(4)
  })
})

describe('L3 布局验证 — 多 union 回归', () => {
  it('多组亲子 union 下，各组子女保持连续', async () => {
    const r = await layoutFamilyTree(Object.values(multiUnionFamily()))
    const abChildren = r.nodes
      .filter((n) => ['childAB1', 'childAB2'].includes(n.id))
      .sort((a, b) => a.cx - b.cx)
    expect(abChildren.map((n) => n.id)).toEqual(['childAB1', 'childAB2'])
  })

  it('多组件成员不会和主家庭重叠', async () => {
    const r = await layoutFamilyTree(Object.values(multiUnionFamily()))
    expect(r.nodes.some((n) => n.id === 'stranger')).toBe(true)
    expect(nonOverlapping(r.nodes)).toBe(true)
  })
})

describe('L3 布局验证 — 画布尺寸', () => {
  it('单人画布非零', async () => {
    const r = await layoutWithElk(oneMember())
    expect(r.canvas.width).toBeGreaterThan(0)
    expect(r.canvas.height).toBeGreaterThan(0)
  })

  it('空成员画布为零', async () => {
    const r = await layoutWithElk([])
    expect(r.canvas).toEqual({ width: 0, height: 0 })
  })

  it('三代画布宽高合理', async () => {
    const r = await layoutWithElk(threeGen())
    expect(r.canvas.width).toBeGreaterThanOrEqual(4)  // 至少 2 node
    expect(r.canvas.height).toBeGreaterThanOrEqual(10) // 至少 3 代
  })
})
