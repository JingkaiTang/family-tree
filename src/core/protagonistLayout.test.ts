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

  it('主角在画布中心', async () => {
    const parent = makeMember('P', { children: [{ id: 'M', type: 'blood' }] })
    const me = makeMember('M', { parents: [{ id: 'P', type: 'blood' }] })
    const child = makeMember('C', { parents: [{ id: 'M', type: 'blood' }] })
    const members = [parent, me, child]

    const result = await layoutProtagonist(members, 'M')

    const meNode = result.nodes.find(n => n.id === 'M')!
    const pX = result.nodes.find(n => n.id === 'P')!.cx
    const cX = result.nodes.find(n => n.id === 'C')!.cx

    // 主角应该在父母和子女之间
    expect(meNode.cx).toBeGreaterThan(Math.min(pX, cX))
    expect(meNode.cx).toBeLessThan(Math.max(pX, cX))
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
    const distFather = Math.abs(fNode.cx - meNode.cx)
    const distUncle = Math.abs(uNode.cx - meNode.cx)
    expect(distFather).toBeLessThan(distUncle)
  })

  it('配偶在主角旁边', async () => {
    const me = makeMember('M', { spouses: [{ id: 'S', type: 'married' }] })
    const spouse = makeMember('S', { spouses: [{ id: 'M', type: 'married' }] })

    const result = await layoutProtagonist([me, spouse], 'M')

    const meNode = result.nodes.find(n => n.id === 'M')!
    const sNode = result.nodes.find(n => n.id === 'S')!

    // 配偶应该和主角在同一行
    expect(meNode.generation).toBe(sNode.generation)
    // 配偶应该紧挨主角
    expect(Math.abs(meNode.cx - sNode.cx)).toBeLessThan(3)
  })
})
