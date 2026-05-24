import { describe, it, expect } from 'vitest'
import { calcRelationshipDistances, groupByDistance, layoutProtagonist, layoutLayerWithElk } from './protagonistLayout'
import type { Member } from './schema'

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
