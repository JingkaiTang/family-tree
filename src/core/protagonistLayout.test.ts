import { describe, it, expect } from 'vitest'
import { calcRelationshipDistances, layoutProtagonist } from './protagonistLayout'
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
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2' }], godparents: [], godchildren: [] },
      { id: '2', firstName: '配偶', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1' }], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('父母距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('子女距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [{ id: '2' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '子', lastName: '', gender: 'male', parents: [{ id: '1' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('兄弟姐妹距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [], siblings: [{ id: '2' }], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '兄弟', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [], siblings: [{ id: '1' }], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1' }, { id: '2' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(2)
  })

  it('祖父母距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [{ id: '1' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '爷爷', lastName: '', gender: 'male', parents: [], children: [{ id: '2' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('3')?.distance).toBe(2)
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
