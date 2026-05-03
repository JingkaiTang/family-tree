import {
  toRelativesTreeNodes,
  pickBestRootId,
  calcCombinedTree,
} from '@/core/relativesAdapter'
import type { Member } from '@/core/schema'
import calcTree from 'relatives-tree'
import { describe, it, expect } from 'vitest'

/** 重建用户上传的真实数据快照（去除 photoId 等无关字段） */
function buildUserFixture(): Member[] {
  const mk = (
    id: string,
    firstName: string,
    lastName: string,
    gender: 'male' | 'female',
    parents: string[],
    children: string[],
    spouses: string[],
  ): Member => ({
    id,
    firstName,
    lastName,
    gender,
    parents: parents.map((p) => ({ id: p, type: 'blood' })),
    children: children.map((c) => ({ id: c, type: 'blood' })),
    siblings: [],
    spouses: spouses.map((s) => ({ id: s, type: 'married' })),
    godparents: [],
    godchildren: [],
  })

  return [
    mk('tang_jingkai', '靖凯', '唐', 'male', ['tang_lingen', 'yao_xuehua'], ['tang_yuelin'], ['ding_yun']),
    mk('tang_yuelin', '跃鳞', '唐', 'male', ['tang_jingkai', 'ding_yun'], [], []),
    mk('ding_yun', '赟', '丁', 'female', ['ding_jinkun', 'dai_xiuzhen'], ['tang_yuelin'], ['tang_jingkai']),
    mk('tang_lingen', '林根', '唐', 'male', [], ['tang_jingkai'], ['yao_xuehua']),
    mk('yao_xuehua', '雪华', '姚', 'female', [], ['tang_jingkai'], ['tang_lingen']),
    mk('ding_jinkun', '金坤', '丁', 'male', [], ['ding_yun'], ['dai_xiuzhen']),
    mk('dai_xiuzhen', '秀珍', '戴', 'female', [], ['ding_yun'], ['ding_jinkun']),
  ]
}

describe('relatives-tree 限制（用于记录库行为）', () => {
  it('以 tang_jingkai 为 root 时漏掉妻家的父母（丁金坤、戴秀珍）', () => {
    const members = buildUserFixture()
    const nodes = toRelativesTreeNodes(members)
    const result = calcTree(nodes as never, { rootId: 'tang_jingkai' })
    const ids = result.nodes.map((n) => n.id)
    expect(ids).not.toContain('ding_jinkun')
    expect(ids).not.toContain('dai_xiuzhen')
  })
})

describe('pickBestRootId', () => {
  it('候选为所有无 parents 的成员', () => {
    const members = buildUserFixture()
    const best = pickBestRootId(members)
    expect(best).toBeDefined()
    // 任一顶层祖辈都可能被选中
    expect(['tang_lingen', 'yao_xuehua', 'ding_jinkun', 'dai_xiuzhen']).toContain(best!)
  })
})

describe('calcCombinedTree - 跨婚姻连通', () => {
  it('能覆盖全部 7 人', () => {
    const members = buildUserFixture()
    const combined = calcCombinedTree(members)
    const ids = combined.nodes.map((n) => n.id).sort()
    expect(ids).toEqual([
      'dai_xiuzhen',
      'ding_jinkun',
      'ding_yun',
      'tang_jingkai',
      'tang_lingen',
      'tang_yuelin',
      'yao_xuehua',
    ])
    expect(combined.orphanIds).toEqual([])
  })

  it('孤立成员（无关系）也能被渲染', () => {
    const solo: Member[] = [
      {
        id: 'solo',
        firstName: 'S',
        lastName: '',
        gender: 'male',
        parents: [],
        children: [],
        siblings: [],
        spouses: [],
        godparents: [],
        godchildren: [],
      },
      {
        id: 'solo2',
        firstName: 'T',
        lastName: '',
        gender: 'female',
        parents: [],
        children: [],
        siblings: [],
        spouses: [],
        godparents: [],
        godchildren: [],
      },
    ]
    const combined = calcCombinedTree(solo)
    expect(combined.nodes.length).toBe(2)
    expect(combined.orphanIds).toEqual([])
  })

  it('空输入返回空画布', () => {
    const combined = calcCombinedTree([])
    expect(combined.nodes).toEqual([])
    expect(combined.canvas).toEqual({ width: 0, height: 0 })
  })
})
