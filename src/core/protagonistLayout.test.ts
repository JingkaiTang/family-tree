import { describe, it, expect } from 'vitest'
import { layoutProtagonist } from './protagonistLayout'
import type { Member } from './schema'

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

describe('layoutProtagonist', () => {
  it('空成员列表返回空结果', async () => {
    const result = await layoutProtagonist([], 'A')
    expect(result.nodes).toEqual([])
  })

  it('单个成员在中心', async () => {
    const members = [makeMember('A')]
    const result = await layoutProtagonist(members, 'A')
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('A')
  })

  it('主角在画布中心区域', async () => {
    const parent = makeMember('P', { children: [{ id: 'M', type: 'blood' }] })
    const me = makeMember('M', { parents: [{ id: 'P', type: 'blood' }] })
    const child = makeMember('C', { parents: [{ id: 'M', type: 'blood' }] })
    const members = [parent, me, child]

    const result = await layoutProtagonist(members, 'M')

    const meNode = result.nodes.find(n => n.id === 'M')!
    // 主角应该在画布的中心区域（靠近中点）
    const canvasMidX = result.canvas.width / 2
    const canvasMidY = result.canvas.height / 2
    expect(Math.abs(meNode.cx - canvasMidX)).toBeLessThan(5)
    expect(Math.abs(meNode.top - canvasMidY)).toBeLessThan(5)
  })

  it('直系亲属比旁系更靠近主角', async () => {
    const grandpa = makeMember('GP', { children: [{ id: 'F', type: 'blood' }, { id: 'U', type: 'blood' }] })
    const father = makeMember('F', {
      parents: [{ id: 'GP', type: 'blood' }],
      children: [{ id: 'M', type: 'blood' }],
      siblings: [{ id: 'U', type: 'blood' }],
    })
    const uncle = makeMember('U', {
      parents: [{ id: 'GP', type: 'blood' }],
      siblings: [{ id: 'F', type: 'blood' }],
    })
    const me = makeMember('M', { parents: [{ id: 'F', type: 'blood' }] })

    const members = [grandpa, father, uncle, me]
    const result = await layoutProtagonist(members, 'M')

    const meNode = result.nodes.find(n => n.id === 'M')!
    const fNode = result.nodes.find(n => n.id === 'F')!
    const uNode = result.nodes.find(n => n.id === 'U')!

    // 父亲应该比叔叔更靠近主角
    const distFather = Math.hypot(fNode.cx - meNode.cx, fNode.top - meNode.top)
    const distUncle = Math.hypot(uNode.cx - meNode.cx, uNode.top - meNode.top)
    expect(distFather).toBeLessThan(distUncle)
  })

  it('配偶在主角旁边', async () => {
    const me = makeMember('M', { spouses: [{ id: 'S', type: 'married' }] })
    const spouse = makeMember('S', { spouses: [{ id: 'M', type: 'married' }] })

    const result = await layoutProtagonist([me, spouse], 'M')

    const meNode = result.nodes.find(n => n.id === 'M')!
    const sNode = result.nodes.find(n => n.id === 'S')!

    // 配偶应该紧挨主角（距离很近）
    const dist = Math.hypot(meNode.cx - sNode.cx, meNode.top - sNode.top)
    expect(dist).toBeLessThan(5)
  })

  it('环形布局：节点分布在不同角度', async () => {
    const me = makeMember('M', {
      parents: [{ id: 'P', type: 'blood' }],
      children: [{ id: 'C1', type: 'blood' }, { id: 'C2', type: 'blood' }],
    })
    const parent = makeMember('P', { children: [{ id: 'M', type: 'blood' }] })
    const child1 = makeMember('C1', { parents: [{ id: 'M', type: 'blood' }] })
    const child2 = makeMember('C2', { parents: [{ id: 'M', type: 'blood' }] })

    const result = await layoutProtagonist([me, parent, child1, child2], 'M')

    // 除了主角外，其他节点应该分布在不同位置
    const others = result.nodes.filter(n => n.id !== 'M')
    const positions = others.map(n => `${Math.round(n.cx)},${Math.round(n.top)}`)
    const uniquePositions = new Set(positions)
    // 至少应该有 2 个不同位置
    expect(uniquePositions.size).toBeGreaterThanOrEqual(2)
  })
})
