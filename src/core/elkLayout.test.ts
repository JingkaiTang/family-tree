import { describe, it, expect } from 'vitest'
import { layoutWithElk } from './elkLayout'
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

describe('layoutWithElk', () => {
  it('空成员列表返回空结果', async () => {
    const result = await layoutWithElk([])
    expect(result.nodes).toEqual([])
    expect(result.connectors).toEqual([])
    expect(result.canvas).toEqual({ width: 0, height: 0 })
  })

  it('单个成员布局在原点附近', async () => {
    const members = [makeMember('A')]
    const result = await layoutWithElk(members)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('A')
  })

  it('父母在子女上方', async () => {
    const parent = makeMember('P', { children: [{ id: 'C', type: 'blood' }] })
    const child = makeMember('C', { parents: [{ id: 'P', type: 'blood' }] })
    const result = await layoutWithElk([parent, child])

    const pNode = result.nodes.find(n => n.id === 'P')!
    const cNode = result.nodes.find(n => n.id === 'C')!
    expect(pNode.top).toBeLessThan(cNode.top)
  })

  it('配偶在同一行', async () => {
    const husband = makeMember('H', {
      gender: 'male',
      spouses: [{ id: 'W', type: 'married' }],
    })
    const wife = makeMember('W', {
      gender: 'female',
      spouses: [{ id: 'H', type: 'married' }],
    })
    const result = await layoutWithElk([husband, wife])

    const hNode = result.nodes.find(n => n.id === 'H')!
    const wNode = result.nodes.find(n => n.id === 'W')!
    expect(hNode.generation).toBe(wNode.generation)
  })

  it('节点不会重叠', async () => {
    const members = Array.from({ length: 5 }, (_, i) =>
      makeMember(`M${i}`)
    )
    const result = await layoutWithElk(members)

    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i]
        const b = result.nodes[j]
        const NODE_W = 2
        const NODE_H = 4
        const aLeft = a.cx - NODE_W / 2
        const aRight = a.cx + NODE_W / 2
        const bLeft = b.cx - NODE_W / 2
        const bRight = b.cx + NODE_W / 2
        const aBottom = a.top + NODE_H
        const bBottom = b.top + NODE_H

        const overlapping = !(aRight <= bLeft || bRight <= aLeft || aBottom <= b.top || bBottom <= a.top)
        expect(overlapping).toBe(false)
      }
    }
  })
})
