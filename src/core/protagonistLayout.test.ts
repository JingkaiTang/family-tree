import { describe, it, expect } from 'vitest'
import { calcRelationshipDistances, groupByDistance, layoutProtagonist, layoutLayerWithElk, calculateRingCoordinates, buildProtagonistConnectors } from './protagonistLayout'
import type { Member } from './schema'
import type { LaidOutNode } from './elkLayout'

describe('calcRelationshipDistances', () => {
  it('主角距离自己为 0', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('1')?.distance).toBe(0)
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

describe('layoutProtagonist', () => {
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
    byId.set('p1', { id: 'p1', firstName: '', lastName: '', gender: 'male', parents: [], children: [{ id: 'c1', type: 'biological' }], siblings: [], spouses: [{ id: 'p2', type: 'married' }], godparents: [], godchildren: [] })
    byId.set('p2', { id: 'p2', firstName: '', lastName: '', gender: 'female', parents: [], children: [{ id: 'c1', type: 'biological' }], siblings: [], spouses: [{ id: 'p1', type: 'married' }], godparents: [], godchildren: [] })
    byId.set('c1', { id: 'c1', firstName: '', lastName: '', gender: 'male', parents: [{ id: 'p1', type: 'biological' }, { id: 'p2', type: 'biological' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] })

    const connectors = buildProtagonistConnectors(nodes, couples, byId)
    expect(connectors.length).toBe(2)
    expect(connectors[0].kind).toBe('spouse')
    expect(connectors[1].kind).toBe('parent-child')
    expect(connectors[1].points[0]).toEqual({ x: 2, y: 0 })
    expect(connectors[1].points[1]).toEqual({ x: 2, y: 10 })
  })
})
