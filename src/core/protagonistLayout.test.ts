import { describe, it, expect } from 'vitest'
import { calcRelationshipDistances, groupByDistance, layoutProtagonist, layoutLayerWithElk, calculateRingCoordinates, buildProtagonistConnectors } from './protagonistLayout'
import type { Member } from './schema'
import type { LaidOutNode } from './treeLayout'

function makeMember(id: string, overrides: Partial<Member> = {}): Member {
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
    ...overrides,
  }
}

describe('calcRelationshipDistances', () => {
  it('主角距离自己为 0', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('1')?.distance).toBe(0)
  })

  it('主角不存在时返回空距离表', () => {
    const distances = calcRelationshipDistances('missing', [makeMember('1')])
    expect(distances.size).toBe(0)
  })

  it('配偶距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2', type: 'married' }], godparents: [], godchildren: [] },
      { id: '2', firstName: '配偶', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1', type: 'married' }], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('父母距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2', type: 'blood' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('子女距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [{ id: '2', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '子', lastName: '', gender: 'male', parents: [{ id: '1', type: 'blood' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('兄弟姐妹距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '3', type: 'blood' }], children: [], siblings: [{ id: '2', type: 'blood' }], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '兄弟', lastName: '', gender: 'male', parents: [{ id: '3', type: 'blood' }], children: [], siblings: [{ id: '1', type: 'blood' }], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1', type: 'blood' }, { id: '2', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(2)
  })

  it('直连兄弟姐妹缺少父母节点时仍按 2 步关系计算', () => {
    const members: Member[] = [
      makeMember('1', { siblings: [{ id: '2', type: 'blood' }] }),
      makeMember('2', { siblings: [{ id: '1', type: 'blood' }] }),
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(2)
  })

  it('祖父母距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2', type: 'blood' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [{ id: '3', type: 'blood' }], children: [{ id: '1', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '爷爷', lastName: '', gender: 'male', parents: [], children: [{ id: '2', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('3')?.distance).toBe(2)
  })
})

describe('groupByDistance', () => {
  it('按距离分层', () => {
    const distances = new Map([
      ['1', { distance: 0 }],
      ['2', { distance: 1 }],
      ['3', { distance: 1 }],
      ['4', { distance: 2 }],
    ])
    const groups = groupByDistance(distances)
    expect(groups.get(0)).toEqual(['1'])
    expect(groups.get(1)).toEqual(expect.arrayContaining(['2', '3']))
    expect(groups.get(2)).toEqual(['4'])
  })
})

describe('布局结果', () => {
  it('返回正确的 LayoutResult 结构', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('couples')
    expect(result).toHaveProperty('connectors')
    expect(result).toHaveProperty('canvas')
    expect(result).toHaveProperty('orphanIds')
    expect(result).toHaveProperty('offsetX')
  })

  it('完整布局流程', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '3', type: 'blood' }], children: [], siblings: [], spouses: [{ id: '2', type: 'married' }], godparents: [], godchildren: [] },
      { id: '2', firstName: '配偶', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1', type: 'married' }], godparents: [], godchildren: [] },
      { id: '3', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1', type: 'blood' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    expect(result.nodes.length).toBe(3)
    expect(result.connectors.length).toBeGreaterThan(0)
    const protagonist = result.nodes.find(n => n.id === '1')
    expect(protagonist?.cx).toBeCloseTo(result.canvas.width / 2, 0)
    expect(protagonist?.top).toBeCloseTo(result.canvas.height / 2, 0)
  })
})

describe('calculateRingCoordinates', () => {
  it('主角在中心', () => {
    const layerNodes = new Map([
      [0, [{ id: '1', cx: 0, top: 0, generation: 0 }]],
    ])
    const result = calculateRingCoordinates(layerNodes)
    expect(result.nodes[0].cx).toBe(0)
    expect(result.nodes[0].top).toBe(0)
  })

  it('第 1 层在半径为 BASE_RADIUS 的圆上', () => {
    const layerNodes = new Map([
      [0, [{ id: '1', cx: 0, top: 0, generation: 0 }]],
      [1, [
        { id: '2', cx: 0, top: 0, generation: 0 },
        { id: '3', cx: 2, top: 0, generation: 0 },
      ]],
    ])
    const result = calculateRingCoordinates(layerNodes)
    const BASE_RADIUS = 10
    for (const n of result.nodes) {
      if (n.id !== '1') {
        const dist = Math.sqrt(n.cx * n.cx + n.top * n.top)
        expect(dist).toBeCloseTo(BASE_RADIUS, 0)
      }
    }
  })

  it('同层只有两个节点时左右展开，避免退化成竖线', () => {
    const result = calculateRingCoordinates(new Map([
      [1, [
        { id: '2', cx: 0, top: 0, generation: 1 },
        { id: '3', cx: 2, top: 0, generation: 1 },
      ]],
    ]))
    const a = result.nodes.find(n => n.id === '2')!
    const b = result.nodes.find(n => n.id === '3')!
    expect(Math.abs(a.top - b.top)).toBeLessThan(1e-9)
    expect(Math.abs(a.cx - b.cx)).toBeGreaterThan(0)
  })

  it('双节点外层交替方向，避免多层退化成同一条横线', () => {
    const result = calculateRingCoordinates(new Map([
      [2, [
        { id: '4', cx: 0, top: 0, generation: 2 },
        { id: '5', cx: 2, top: 0, generation: 2 },
      ]],
    ]))
    const a = result.nodes.find(n => n.id === '4')!
    const b = result.nodes.find(n => n.id === '5')!
    expect(Math.abs(a.cx - b.cx)).toBeLessThan(1e-9)
    expect(Math.abs(a.top - b.top)).toBeGreaterThan(0)
  })

  it('跳过空层并保持坐标有限', () => {
    const result = calculateRingCoordinates(new Map([
      [0, []],
      [1, [{ id: '2', cx: 0, top: 0, generation: 1 }]],
    ]))
    expect(result.nodes).toHaveLength(1)
    expect(Number.isFinite(result.nodes[0].cx)).toBe(true)
    expect(Number.isFinite(result.nodes[0].top)).toBe(true)
  })
})

describe('layoutLayerWithElk', () => {
  it('返回节点坐标，无重叠', async () => {
    const members: Member[] = [
      { id: '1', firstName: 'A', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: 'B', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutLayerWithElk(members, new Map([['1', { distance: 1 }], ['2', { distance: 1 }]]))
    expect(result.nodes.length).toBe(2)
    const [n1, n2] = result.nodes
    expect(Math.abs(n1.cx - n2.cx)).toBeGreaterThan(2)
  })
})

describe('集成测试', () => {
  it('大家族布局无重叠', async () => {
    const members: Member[] = [
      // 祖辈
      { id: 'gpa', firstName: '爷爷', lastName: '', gender: 'male', parents: [], children: [{ id: 'dad', type: 'blood' }], siblings: [], spouses: [{ id: 'gma', type: 'married' }], godparents: [], godchildren: [] },
      { id: 'gma', firstName: '奶奶', lastName: '', gender: 'female', parents: [], children: [{ id: 'dad', type: 'blood' }], siblings: [], spouses: [{ id: 'gpa', type: 'married' }], godparents: [], godchildren: [] },
      // 父辈
      { id: 'dad', firstName: '父', lastName: '', gender: 'male', parents: [{ id: 'gpa', type: 'blood' }, { id: 'gma', type: 'blood' }], children: [{ id: 'me', type: 'blood' }], siblings: [], spouses: [{ id: 'mom', type: 'married' }], godparents: [], godchildren: [] },
      { id: 'mom', firstName: '母', lastName: '', gender: 'female', parents: [], children: [{ id: 'me', type: 'blood' }], siblings: [], spouses: [{ id: 'dad', type: 'married' }], godparents: [], godchildren: [] },
      // 主角
      { id: 'me', firstName: '我', lastName: '', gender: 'male', parents: [{ id: 'dad', type: 'blood' }, { id: 'mom', type: 'blood' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, 'me')
    expect(result.nodes.length).toBe(5)

    const NODE_W = 2
    const NODE_H = 4
    // 检查无重叠
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i]
        const b = result.nodes[j]
        const dx = Math.abs(a.cx - b.cx)
        const dy = Math.abs(a.top - b.top)
        expect(dx > NODE_W || dy > NODE_H).toBe(true)
      }
    }
  })

  it('主角在画布中心', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    const protagonist = result.nodes.find(n => n.id === '1')
    expect(protagonist?.cx).toBeCloseTo(result.canvas.width / 2, 0)
    expect(protagonist?.top).toBeCloseTo(result.canvas.height / 2, 0)
  })

  it('中心人物不存在时退回普通布局并保持画布有效', async () => {
    const members: Member[] = [
      makeMember('a'),
      makeMember('b'),
    ]
    const result = await layoutProtagonist(members, 'missing')
    expect(result.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(result.orphanIds).toEqual([])
    expect(Number.isFinite(result.canvas.width)).toBe(true)
    expect(Number.isFinite(result.canvas.height)).toBe(true)
  })

  it('不连通成员不会被中心布局丢弃，并标记为 orphanIds', async () => {
    const members: Member[] = [
      makeMember('me', { parents: [{ id: 'dad', type: 'blood' }] }),
      makeMember('dad', { children: [{ id: 'me', type: 'blood' }] }),
      makeMember('stranger'),
    ]
    const result = await layoutProtagonist(members, 'me')
    expect(result.nodes.map(n => n.id).sort()).toEqual(['dad', 'me', 'stranger'])
    expect(result.orphanIds).toEqual(['stranger'])
    const stranger = result.nodes.find(n => n.id === 'stranger')!
    const dad = result.nodes.find(n => n.id === 'dad')!
    expect(stranger.generation).toBeGreaterThan(dad.generation)
  })
})

describe('buildProtagonistConnectors', () => {
  it('生成配偶连线', () => {
    const nodes: LaidOutNode[] = [
      { id: '1', cx: 0, top: 0, generation: 0 },
      { id: '2', cx: 2, top: 0, generation: 0 },
    ]
    const couples = [{ id: '1|2', memberIds: ['1', '2'], generation: 0, cx: 1 }]
    const byId = new Map<string, Member>()
    byId.set('1', { id: '1', firstName: '', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2', type: 'married' }], godparents: [], godchildren: [] })
    byId.set('2', { id: '2', firstName: '', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1', type: 'married' }], godparents: [], godchildren: [] })

    const connectors = buildProtagonistConnectors(nodes, couples, byId)
    expect(connectors.length).toBe(1)
    expect(connectors[0].kind).toBe('spouse')
  })

  it('生成父母→子女连线', () => {
    const nodes: LaidOutNode[] = [
      { id: 'p1', cx: 0, top: 0, generation: 0 },
      { id: 'p2', cx: 4, top: 0, generation: 0 },
      { id: 'c1', cx: 2, top: 10, generation: 1 },
    ]
    const couples = [{ id: 'p1|p2', memberIds: ['p1', 'p2'], generation: 0, cx: 2 }]
    const byId = new Map<string, Member>()
    byId.set('p1', { id: 'p1', firstName: '', lastName: '', gender: 'male', parents: [], children: [{ id: 'c1', type: 'blood' }], siblings: [], spouses: [{ id: 'p2', type: 'married' }], godparents: [], godchildren: [] })
    byId.set('p2', { id: 'p2', firstName: '', lastName: '', gender: 'female', parents: [], children: [{ id: 'c1', type: 'blood' }], siblings: [], spouses: [{ id: 'p1', type: 'married' }], godparents: [], godchildren: [] })
    byId.set('c1', { id: 'c1', firstName: '', lastName: '', gender: 'male', parents: [{ id: 'p1', type: 'blood' }, { id: 'p2', type: 'blood' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] })

    const connectors = buildProtagonistConnectors(nodes, couples, byId)
    expect(connectors.length).toBe(2)
    expect(connectors[0].kind).toBe('spouse')
    expect(connectors[1].kind).toBe('parent-child')
    expect(connectors[1].points[0]).toEqual({ x: 2, y: 0 })
    expect(connectors[1].points[1]).toEqual({ x: 2, y: 10 })
  })
})
