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

/**
 * 用户真实数据：唐家 + 丁家跨婚姻连接。
 *           唐林根──姚雪华           丁金坤──戴秀珍
 *                 │                         │
 *              唐靖凯 ──── 丁赟
 *                       │
 *                    唐跃鳞
 */
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

describe('layoutFamilyTree — 基本正确性', () => {
  it('覆盖全部 7 位成员', () => {
    const r = layoutFamilyTree(buildUserFixture())
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

  it('三代高度递增：顶代最小 top，末代最大 top', () => {
    const r = layoutFamilyTree(buildUserFixture())
    const tangLinGen = r.nodes.find((n) => n.id === 'tang_lingen')!
    const jingkai = r.nodes.find((n) => n.id === 'tang_jingkai')!
    const yuelin = r.nodes.find((n) => n.id === 'tang_yuelin')!
    expect(tangLinGen.top).toBeLessThan(jingkai.top)
    expect(jingkai.top).toBeLessThan(yuelin.top)
  })

  it('配偶同代：唐林根与姚雪华 top 相同；丁金坤与戴秀珍 top 相同', () => {
    const r = layoutFamilyTree(buildUserFixture())
    const tl = r.nodes.find((n) => n.id === 'tang_lingen')!
    const yx = r.nodes.find((n) => n.id === 'yao_xuehua')!
    const dj = r.nodes.find((n) => n.id === 'ding_jinkun')!
    const dx = r.nodes.find((n) => n.id === 'dai_xiuzhen')!
    expect(tl.top).toBe(yx.top)
    expect(dj.top).toBe(dx.top)
    expect(tl.top).toBe(dj.top) // 都是顶代
  })

  it('夫妻并排：唐林根与姚雪华水平距离小', () => {
    const r = layoutFamilyTree(buildUserFixture())
    const tl = r.nodes.find((n) => n.id === 'tang_lingen')!
    const yx = r.nodes.find((n) => n.id === 'yao_xuehua')!
    expect(Math.abs(tl.cx - yx.cx)).toBeLessThan(3) // COUPLE_GAP + NODE_W
  })

  it('所有节点 cx 都是非负数（已平移）', () => {
    const r = layoutFamilyTree(buildUserFixture())
    for (const n of r.nodes) expect(n.cx).toBeGreaterThanOrEqual(0)
  })

  it('生成了夫妻连线与父母-子女连线', () => {
    const r = layoutFamilyTree(buildUserFixture())
    const spouseLines = r.connectors.filter((c) => c.kind === 'spouse')
    const pcLines = r.connectors.filter((c) => c.kind === 'parent-child')
    // 3 对夫妻 → 3 条 spouse 线
    expect(spouseLines.length).toBe(3)
    // 父母→子女连线至少若干条
    expect(pcLines.length).toBeGreaterThan(3)
  })
})

describe('layoutFamilyTree — 边界情况', () => {
  it('空输入', () => {
    const r = layoutFamilyTree([])
    expect(r.nodes).toEqual([])
    expect(r.canvas).toEqual({ width: 0, height: 0 })
  })

  it('单人无关系', () => {
    const r = layoutFamilyTree([mk('solo', 'male', [], [], [])])
    expect(r.nodes.length).toBe(1)
    expect(r.nodes[0].id).toBe('solo')
  })

  it('两个孤立成员（各自独立）也都渲染', () => {
    const r = layoutFamilyTree([
      mk('a', 'male', [], [], []),
      mk('b', 'female', [], [], []),
    ])
    expect(r.nodes.length).toBe(2)
    expect(r.orphanIds).toEqual([])
  })

  it('单身父母带一个孩子', () => {
    const r = layoutFamilyTree([
      mk('p', 'female', [], ['c'], []),
      mk('c', 'male', ['p'], [], []),
    ])
    const p = r.nodes.find((n) => n.id === 'p')!
    const c = r.nodes.find((n) => n.id === 'c')!
    expect(p.top).toBeLessThan(c.top)
  })
})

describe('layoutFamilyTree — 单子女横线不拉长', () => {
  it('一对父母只生一个孩子、孩子也只这一对父母 → 没有父→子女横线', () => {
    const r = layoutFamilyTree([
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

  it('独生子女有姻亲另一对父母时：横线长度 = 父母-孩子距离，不超出', () => {
    // A 家、B 家各出一位配对生一个孩子 C。A/B 各是独生子女家族。
    const r = layoutFamilyTree([
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
    // c 是 a,b 的独生子，c.cx 应在 a,b 中点，该代无父→子女横线（spouse 线已分开统计）
    // a,b 这对 → c 没有横线：父母→子女直上直下
    const abToC = horizontal.filter(
      (h) =>
        // y 在 "g=1 底" 和 "g=2 顶" 之间
        h.points[0].y > 8 && h.points[0].y < 14,
    )
    expect(abToC.length).toBe(0)
  })
})

describe('layoutFamilyTree — 同代多对夫妻横线不重叠', () => {
  /**
   * 构造：两对夫妻在同一代，各有孩子。
   * 目标：如果布局让两家的子女 x 范围交错，两条横线必须分配到不同 y。
   * 手段：强制让兄弟姐妹不连续（通过在 couple 序中间插一对）。
   * 注：本用例只是统计：当任两对父母的横线 x 重叠时，它们的 y 必须不同。
   */
  function buildManyCouplesFixture(): Member[] {
    // 5 对夫妻，每对 2 个孩子，共 20 人
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

  it('任意两条父→子女横线若 x 范围重叠，y 必须不同', () => {
    const r = layoutFamilyTree(buildManyCouplesFixture())
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
  /**
   * 场景：祖父母有 3 个孩子 A、B、C，分别各自结婚。
   * 另外有一对无关的"外家长辈"X|Y（无子女），顶代排序时夹在中间。
   * 期望：A/B/C 三个 couple 在子代数组里连续，不会被姻亲家族插队。
   */
  it('同一主父母下的多兄弟姐妹在同代 cx 中连续（无其他 couple 夹入）', () => {
    const list: Member[] = [
      // 顶代
      mk('gpa', 'male', [], ['a', 'b', 'c'], ['gma']),
      mk('gma', 'female', [], ['a', 'b', 'c'], ['gpa']),
      // 另一对无关顶代（id 字典序在中间，容易干扰）
      mk('mx', 'male', [], [], ['my']),
      mk('my', 'female', [], [], ['mx']),
      // A、B、C 的配偶家长辈（也顶代）
      mk('a_in_dad', 'male', [], ['a_spouse'], ['a_in_mom']),
      mk('a_in_mom', 'female', [], ['a_spouse'], ['a_in_dad']),
      mk('b_in_dad', 'male', [], ['b_spouse'], ['b_in_mom']),
      mk('b_in_mom', 'female', [], ['b_spouse'], ['b_in_dad']),
      mk('c_in_dad', 'male', [], ['c_spouse'], ['c_in_mom']),
      mk('c_in_mom', 'female', [], ['c_spouse'], ['c_in_dad']),
      // 子代：A、B、C 都是 gpa|gma 的孩子，各自结婚
      mk('a', 'male', ['gpa', 'gma'], [], ['a_spouse']),
      mk('a_spouse', 'female', ['a_in_dad', 'a_in_mom'], [], ['a']),
      mk('b', 'female', ['gpa', 'gma'], [], ['b_spouse']),
      mk('b_spouse', 'male', ['b_in_dad', 'b_in_mom'], [], ['b']),
      mk('c', 'male', ['gpa', 'gma'], [], ['c_spouse']),
      mk('c_spouse', 'female', ['c_in_dad', 'c_in_mom'], [], ['c']),
    ]
    const r = layoutFamilyTree(list)
    // 取子代（generation 最大那代）
    const maxGen = Math.max(...r.nodes.map((n) => n.generation))
    const childGenCx = r.nodes
      .filter((n) => n.generation === maxGen)
      .sort((a, b) => a.cx - b.cx)
    // 按 cx 从左到右，A/B/C 的 couple 应当连续出现，
    // 即在 A 和 C 之间不会出现属于其他主父母的 couple。
    const abcIds = new Set(['a', 'a_spouse', 'b', 'b_spouse', 'c', 'c_spouse'])
    const flags = childGenCx.map((n) => abcIds.has(n.id))
    // flags 里的 true 必须是一段连续区间
    const firstTrue = flags.indexOf(true)
    const lastTrue = flags.lastIndexOf(true)
    for (let i = firstTrue; i <= lastTrue; i++) {
      expect(flags[i]).toBe(true)
    }
  })
})

describe('layoutFamilyTree — 干爹/干妈', () => {
  it('干爹与干儿子分处两代，并生成 godparent 连线', () => {
    const members: Member[] = [
      mk('gdad', 'male', [], [], []),
      mk('gson', 'male', [], [], []),
    ]
    // 手动建立干亲（mk 不支持干亲参数）
    members[0].godchildren = [{ id: 'gson', type: 'godchild' }]
    members[1].godparents = [{ id: 'gdad', type: 'godparent' }]

    const r = layoutFamilyTree(members)
    const gdad = r.nodes.find((n) => n.id === 'gdad')!
    const gson = r.nodes.find((n) => n.id === 'gson')!
    // 干爹高一代
    expect(gdad.top).toBeLessThan(gson.top)
    // 生成了一条 godparent 连线
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

  it('未传 manualPositions → 沿用算法布局；offsetX 已计入', () => {
    const r = layoutFamilyTree(simpleFamily())
    expect(typeof r.offsetX).toBe('number')
    // 所有节点 cx 已被平移到 ≥ 0（offsetX 已应用）
    for (const n of r.nodes) expect(n.cx).toBeGreaterThanOrEqual(0)
  })

  it('manualPositions 命中时覆盖节点坐标，连线端点跟随', () => {
    const members = simpleFamily()
    // 把 kid 移动到远处
    const manual = { kid: { cx: 100, top: 100 } }
    const r = layoutFamilyTree(members, { manualPositions: manual })
    const kid = r.nodes.find((n) => n.id === 'kid')!
    // cx 最终 = 存储值 + offsetX（可能为 0 或正数）
    expect(kid.cx).toBeCloseTo(100 + r.offsetX, 6)
    expect(kid.top).toBeCloseTo(100, 6)

    // 父母→子女连线里，"到达 kid 的垂直段"的终点应该指向 kid.cx/kid.top
    const toKid = r.connectors.filter(
      (c) =>
        c.kind === 'parent-child' &&
        c.points.length === 2 &&
        Math.abs(c.points[1].x - kid.cx) < 1e-6 &&
        Math.abs(c.points[1].y - kid.top) < 1e-6,
    )
    expect(toKid.length).toBeGreaterThan(0)
  })

  it('manualPositions 中未命中的节点保持算法布局', () => {
    const members = simpleFamily()
    const baseline = layoutFamilyTree(members)
    const r = layoutFamilyTree(members, {
      manualPositions: { kid: { cx: 50, top: 50 } },
    })
    const dadBase = baseline.nodes.find((n) => n.id === 'dad')!
    const dadOver = r.nodes.find((n) => n.id === 'dad')!
    // 只是 offsetX 可能变了（因为 kid 跳到 50 以外）；用坐标差相等判等
    expect(dadOver.cx - r.offsetX).toBeCloseTo(dadBase.cx - baseline.offsetX, 6)
    expect(dadOver.top).toBeCloseTo(dadBase.top, 6)
  })
})
