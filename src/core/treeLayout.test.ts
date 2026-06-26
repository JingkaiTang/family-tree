import { describe, it, expect } from 'vitest'
import { layoutFamilyTree } from './treeLayout'
import type { Member } from './schema'

function mk(
  id: string,
  gender: 'male' | 'female',
  parents: string[],
  children: string[],
  spouses: string[],
  siblings: string[] = [],
): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender,
    parents: parents.map((p) => ({ id: p, type: 'blood' })),
    children: children.map((c) => ({ id: c, type: 'blood' })),
    siblings: siblings.map((s) => ({ id: s, type: 'blood' })),
    spouses: spouses.map((s) => ({ id: s, type: 'married' })),
    godparents: [],
    godchildren: [],
  }
}

function buildUserFixture(): Member[] {
  return [
    mk('tang_jingkai', 'male', ['tang_lingen', 'yao_xuehua'], ['tang_yuelin'], ['ding_yun']),
    mk('tang_yuelin', 'male', ['tang_jingkai', 'ding_yun'], [], []),
    mk('ding_yun', 'female', ['ding_jinkun', 'dai_xiuzhen'], ['tang_yuelin'], ['tang_jingkai']),
    mk('tang_lingen', 'male', [], ['tang_jingkai'], ['yao_xuehua']),
    mk('yao_xuehua', 'female', [], ['tang_jingkai'], ['tang_lingen']),
    mk('ding_jinkun', 'male', [], ['ding_yun'], ['dai_xiuzhen']),
    mk('dai_xiuzhen', 'female', [], ['ding_yun'], ['ding_jinkun']),
  ]
}

function expectNoNodeOverlap(nodes: Array<{ cx: number; top: number }>) {
  const NODE_W = 2
  const NODE_H = 4
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const overlap = !(
        a.cx + NODE_W / 2 <= b.cx - NODE_W / 2 ||
        b.cx + NODE_W / 2 <= a.cx - NODE_W / 2 ||
        a.top + NODE_H <= b.top ||
        b.top + NODE_H <= a.top
      )
      expect(overlap).toBe(false)
    }
  }
}

describe('layoutFamilyTree — 基本正确性', () => {
  it('覆盖全部 7 位成员', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    const ids = r.nodes.map((n) => n.id).sort()
    expect(ids).toEqual([
      'dai_xiuzhen',
      'ding_jinkun',
      'ding_yun',
      'tang_jingkai',
      'tang_lingen',
      'tang_yuelin',
      'yao_xuehua',
    ])
    expect(r.orphanIds).toEqual([])
  })

  it('三代高度递增：顶代最小 top，末代最大 top', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    const tangLinGen = r.nodes.find((n) => n.id === 'tang_lingen')!
    const jingkai = r.nodes.find((n) => n.id === 'tang_jingkai')!
    const yuelin = r.nodes.find((n) => n.id === 'tang_yuelin')!
    expect(tangLinGen.top).toBeLessThan(jingkai.top)
    expect(jingkai.top).toBeLessThan(yuelin.top)
  })

  it('配偶同代：唐林根与姚雪华 top 相同；丁金坤与戴秀珍 top 相同', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    const tl = r.nodes.find((n) => n.id === 'tang_lingen')!
    const yx = r.nodes.find((n) => n.id === 'yao_xuehua')!
    const dj = r.nodes.find((n) => n.id === 'ding_jinkun')!
    const dx = r.nodes.find((n) => n.id === 'dai_xiuzhen')!
    expect(tl.top).toBe(yx.top)
    expect(dj.top).toBe(dx.top)
    expect(tl.top).toBe(dj.top)
  })

  it('夫妻并排：唐林根与姚雪华水平距离小', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    const tl = r.nodes.find((n) => n.id === 'tang_lingen')!
    const yx = r.nodes.find((n) => n.id === 'yao_xuehua')!
    expect(Math.abs(tl.cx - yx.cx)).toBeLessThan(3)
    expect(Math.abs(tl.cx - yx.cx)).toBeGreaterThanOrEqual(2)
  })

  it('所有节点 cx 都是非负数（已平移）', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    for (const n of r.nodes) expect(n.cx).toBeGreaterThanOrEqual(0)
  })

  it('生成了夫妻连线与父母-子女连线', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    const spouseLines = r.connectors.filter((c) => c.kind === 'spouse')
    const pcLines = r.connectors.filter((c) => c.kind === 'parent-child')
    expect(spouseLines.length).toBe(3)
    expect(pcLines.length).toBeGreaterThan(3)
  })

  it('复杂默认布局中任意卡片不重叠', async () => {
    const r = await layoutFamilyTree(buildUserFixture())
    expectNoNodeOverlap(r.nodes)
  })

  it('默认布局使用强约束家庭单元：同父母子女连续且父母居中', async () => {
    const list = [
      mk('dad', 'male', [], ['a', 'b', 'c'], ['mom']),
      mk('mom', 'female', [], ['a', 'b', 'c'], ['dad']),
      mk('a', 'male', ['dad', 'mom'], [], []),
      mk('b', 'female', ['dad', 'mom'], [], []),
      mk('c', 'male', ['dad', 'mom'], [], []),
    ]
    const r = await layoutFamilyTree(list)
    const dad = r.nodes.find((n) => n.id === 'dad')!
    const mom = r.nodes.find((n) => n.id === 'mom')!
    const children = r.nodes
      .filter((n) => ['a', 'b', 'c'].includes(n.id))
      .sort((x, y) => x.cx - y.cx)

    expect(dad.top).toBe(mom.top)
    expect(children.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(children.every((child) => child.top > dad.top)).toBe(true)
    expect((children[0].cx + children[2].cx) / 2).toBeCloseTo((dad.cx + mom.cx) / 2, 6)
  })
})

describe('layoutFamilyTree — 边界情况', () => {
  it('空输入', async () => {
    const r = await layoutFamilyTree([])
    expect(r.nodes).toEqual([])
    expect(r.canvas).toEqual({ width: 0, height: 0 })
  })

  it('单人无关系', async () => {
    const r = await layoutFamilyTree([mk('solo', 'male', [], [], [])])
    expect(r.nodes.length).toBe(1)
    expect(r.nodes[0].id).toBe('solo')
  })

  it('两个孤立成员（各自独立）也都渲染', async () => {
    const r = await layoutFamilyTree([
      mk('a', 'male', [], [], []),
      mk('b', 'female', [], [], []),
    ])
    expect(r.nodes.length).toBe(2)
    expect(r.orphanIds).toEqual([])
  })

  it('单身父母带一个孩子', async () => {
    const r = await layoutFamilyTree([
      mk('p', 'female', [], ['c'], []),
      mk('c', 'male', ['p'], [], []),
    ])
    const p = r.nodes.find((n) => n.id === 'p')!
    const c = r.nodes.find((n) => n.id === 'c')!
    expect(p.top).toBeLessThan(c.top)
  })
})

describe('layoutFamilyTree — 单子女横线不拉长', () => {
  it('一对父母只生一个孩子、孩子也只这一对父母 → 没有父→子女横线', async () => {
    const r = await layoutFamilyTree([
      mk('p1', 'male', [], ['c'], ['p2']),
      mk('p2', 'female', [], ['c'], ['p1']),
      mk('c', 'male', ['p1', 'p2'], [], []),
    ])
    const horizontal = r.connectors.filter(
      (c) =>
        c.kind === 'parent-child' &&
        c.points.length === 2 &&
        Math.abs(c.points[0].y - c.points[1].y) < 1e-9 &&
        Math.abs(c.points[0].x - c.points[1].x) > 1e-9,
    )
    expect(horizontal.length).toBe(0)
  })

  it('已婚独生子女以夫妻单元对齐父母时，仍保持夫妻卡片不重叠', async () => {
    const r = await layoutFamilyTree([
      mk('gpa', 'male', [], ['dad'], ['gma']),
      mk('gma', 'female', [], ['dad'], ['gpa']),
      mk('dad', 'male', ['gpa', 'gma'], ['kid'], ['mom']),
      mk('mom', 'female', [], ['kid'], ['dad']),
      mk('kid', 'male', ['dad', 'mom'], [], []),
    ])
    const gpa = r.nodes.find((n) => n.id === 'gpa')!
    const gma = r.nodes.find((n) => n.id === 'gma')!
    const dad = r.nodes.find((n) => n.id === 'dad')!
    const mom = r.nodes.find((n) => n.id === 'mom')!
    const kid = r.nodes.find((n) => n.id === 'kid')!

    expect((dad.cx + mom.cx) / 2).toBeCloseTo((gpa.cx + gma.cx) / 2, 6)
    expect(kid.cx).toBeCloseTo((dad.cx + mom.cx) / 2, 6)
    expect(Math.abs(dad.cx - mom.cx)).toBeGreaterThanOrEqual(2)
    expectNoNodeOverlap(r.nodes)
  })

  it('三代默认行距不叠加 ELK y 坐标，保持紧凑一致', async () => {
    const r = await layoutFamilyTree([
      mk('gpa', 'male', [], ['dad'], ['gma']),
      mk('gma', 'female', [], ['dad'], ['gpa']),
      mk('dad', 'male', ['gpa', 'gma'], ['kid'], ['mom']),
      mk('mom', 'female', [], ['kid'], ['dad']),
      mk('kid', 'male', ['dad', 'mom'], [], []),
    ])
    const gpa = r.nodes.find((n) => n.id === 'gpa')!
    const dad = r.nodes.find((n) => n.id === 'dad')!
    const kid = r.nodes.find((n) => n.id === 'kid')!
    expect(dad.top - gpa.top).toBeCloseTo(7, 6)
    expect(kid.top - dad.top).toBeCloseTo(7, 6)
  })

  it('独生子女有姻亲另一对父母时：横线长度 = 父母-孩子距离，不超出', async () => {
    const r = await layoutFamilyTree([
      mk('ap', 'male', [], ['a'], ['am']),
      mk('am', 'female', [], ['a'], ['ap']),
      mk('bp', 'male', [], ['b'], ['bm']),
      mk('bm', 'female', [], ['b'], ['bp']),
      mk('a', 'male', ['ap', 'am'], ['c'], ['b']),
      mk('b', 'female', ['bp', 'bm'], ['c'], ['a']),
      mk('c', 'male', ['a', 'b'], [], []),
    ])
    const horizontal = r.connectors.filter(
      (c) =>
        c.kind === 'parent-child' &&
        c.points.length === 2 &&
        Math.abs(c.points[0].y - c.points[1].y) < 1e-9 &&
        Math.abs(c.points[0].x - c.points[1].x) > 1e-9,
    )
    const abToC = horizontal.filter(
      (h) =>
        h.points[0].y > 8 && h.points[0].y < 14,
    )
    expect(abToC.length).toBe(0)
  })
})

describe('layoutFamilyTree — 同代多对夫妻横线不重叠', () => {
  function buildManyCouplesFixture(): Member[] {
    const list: Member[] = []
    for (let i = 0; i < 5; i++) {
      const h = `h${i}`
      const w = `w${i}`
      const c1 = `c${i}a`
      const c2 = `c${i}b`
      list.push(mk(h, 'male', [], [c1, c2], [w]))
      list.push(mk(w, 'female', [], [c1, c2], [h]))
      list.push(mk(c1, 'male', [h, w], [], []))
      list.push(mk(c2, 'female', [h, w], [], []))
    }
    return list
  }

  it('任意两条父→子女横线若 x 范围重叠，y 必须不同', async () => {
    const r = await layoutFamilyTree(buildManyCouplesFixture())
    const horizontal = r.connectors.filter(
      (c) =>
        c.kind === 'parent-child' &&
        c.points.length === 2 &&
        Math.abs(c.points[0].y - c.points[1].y) < 1e-9 &&
        Math.abs(c.points[0].x - c.points[1].x) > 1e-9,
    )
    for (let i = 0; i < horizontal.length; i++) {
      for (let j = i + 1; j < horizontal.length; j++) {
        const a = horizontal[i]
        const b = horizontal[j]
        const aMinX = Math.min(a.points[0].x, a.points[1].x)
        const aMaxX = Math.max(a.points[0].x, a.points[1].x)
        const bMinX = Math.min(b.points[0].x, b.points[1].x)
        const bMaxX = Math.max(b.points[0].x, b.points[1].x)
        const xOverlap = aMinX < bMaxX - 1e-9 && bMinX < aMaxX - 1e-9
        if (xOverlap) {
          expect(Math.abs(a.points[0].y - b.points[0].y)).toBeGreaterThan(0.1)
        }
      }
    }
  })
})

describe('layoutFamilyTree — 兄弟姐妹聚合', () => {
  it('同一主父母下的多兄弟姐妹在同代 cx 中连续（无其他 couple 夹入）', async () => {
    const list: Member[] = [
      mk('gpa', 'male', [], ['a', 'b', 'c'], ['gma']),
      mk('gma', 'female', [], ['a', 'b', 'c'], ['gpa']),
      mk('mx', 'male', [], [], ['my']),
      mk('my', 'female', [], [], ['mx']),
      mk('a_in_dad', 'male', [], ['a_spouse'], ['a_in_mom']),
      mk('a_in_mom', 'female', [], ['a_spouse'], ['a_in_dad']),
      mk('b_in_dad', 'male', [], ['b_spouse'], ['b_in_mom']),
      mk('b_in_mom', 'female', [], ['b_spouse'], ['b_in_dad']),
      mk('c_in_dad', 'male', [], ['c_spouse'], ['c_in_mom']),
      mk('c_in_mom', 'female', [], ['c_spouse'], ['c_in_dad']),
      mk('a', 'male', ['gpa', 'gma'], [], ['a_spouse']),
      mk('a_spouse', 'female', ['a_in_dad', 'a_in_mom'], [], ['a']),
      mk('b', 'female', ['gpa', 'gma'], [], ['b_spouse']),
      mk('b_spouse', 'male', ['b_in_dad', 'b_in_mom'], [], ['b']),
      mk('c', 'male', ['gpa', 'gma'], [], ['c_spouse']),
      mk('c_spouse', 'female', ['c_in_dad', 'c_in_mom'], [], ['c']),
    ]
    const r = await layoutFamilyTree(list)
    const maxGen = Math.max(...r.nodes.map((n) => n.generation))
    const childGenCx = r.nodes
      .filter((n) => n.generation === maxGen)
      .sort((a, b) => a.cx - b.cx)
    const abcIds = new Set(['a', 'a_spouse', 'b', 'b_spouse', 'c', 'c_spouse'])
    const flags = childGenCx.map((n) => abcIds.has(n.id))
    const firstTrue = flags.indexOf(true)
    const lastTrue = flags.lastIndexOf(true)
    for (let i = firstTrue; i <= lastTrue; i++) {
      expect(flags[i]).toBe(true)
    }
  })
})

describe('layoutFamilyTree — 干爹/干妈', () => {
  it('干爹与干儿子分处两代，并生成 godparent 连线', async () => {
    const members: Member[] = [
      mk('gdad', 'male', [], [], []),
      mk('gson', 'male', [], [], []),
    ]
    members[0].godchildren = [{ id: 'gson', type: 'godchild' }]
    members[1].godparents = [{ id: 'gdad', type: 'godparent' }]

    const r = await layoutFamilyTree(members)
    const gdad = r.nodes.find((n) => n.id === 'gdad')!
    const gson = r.nodes.find((n) => n.id === 'gson')!
    expect(gdad.top).toBeLessThan(gson.top)
    const godLines = r.connectors.filter((c) => c.kind === 'godparent')
    expect(godLines.length).toBe(1)
  })
})

describe('layoutFamilyTree — 手工位置覆盖 (manualPositions)', () => {
  function simpleFamily() {
    return [
      mk('dad', 'male', [], ['kid'], ['mom']),
      mk('mom', 'female', [], ['kid'], ['dad']),
      mk('kid', 'male', ['dad', 'mom'], [], []),
    ]
  }

  it('未传 manualPositions → 沿用算法布局；offsetX 已计入', async () => {
    const r = await layoutFamilyTree(simpleFamily())
    expect(typeof r.offsetX).toBe('number')
    for (const n of r.nodes) expect(n.cx).toBeGreaterThanOrEqual(0)
  })

  it('manualPositions 命中时覆盖节点坐标，连线端点跟随', async () => {
    const members = simpleFamily()
    const manual = { kid: { cx: 100, top: 100 } }
    const r = await layoutFamilyTree(members, { manualPositions: manual })
    const kid = r.nodes.find((n) => n.id === 'kid')!
    expect(kid.cx).toBeCloseTo(100 + r.offsetX, 6)
    expect(kid.top).toBeCloseTo(100, 6)

    const toKid = r.connectors.filter(
      (c) =>
        c.kind === 'parent-child' &&
        c.points.length === 2 &&
        Math.abs(c.points[1].x - kid.cx) < 1e-6 &&
        Math.abs(c.points[1].y - kid.top) < 1e-6,
    )
    expect(toKid.length).toBeGreaterThan(0)
  })

  it('manualPositions 中未命中的节点保持算法布局', async () => {
    const members = simpleFamily()
    const baseline = await layoutFamilyTree(members)
    const r = await layoutFamilyTree(members, {
      manualPositions: { kid: { cx: 50, top: 50 } },
    })
    const dadBase = baseline.nodes.find((n) => n.id === 'dad')!
    const dadOver = r.nodes.find((n) => n.id === 'dad')!
    expect(dadOver.cx - r.offsetX).toBeCloseTo(dadBase.cx - baseline.offsetX, 6)
    expect(dadOver.top).toBeCloseTo(dadBase.top, 6)
  })
})
