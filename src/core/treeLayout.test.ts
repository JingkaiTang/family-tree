import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { layoutFamilyTree } from './treeLayout'

function member(id: string, patch: Partial<Member> = {}): Member {
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
    ...patch,
  }
}

function linkSpouse(left: Member, right: Member) {
  left.spouses.push({ id: right.id, type: 'married' })
  right.spouses.push({ id: left.id, type: 'married' })
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function buildUserFixture(): Member[] {
  const tangJingkai = member('tang_jingkai')
  const tangYuelin = member('tang_yuelin')
  const dingYun = member('ding_yun')
  const tangLingen = member('tang_lingen')
  const yaoXuehua = member('yao_xuehua')
  const dingJinkun = member('ding_jinkun')
  const daiXiuzhen = member('dai_xiuzhen')

  linkSpouse(tangLingen, yaoXuehua)
  linkSpouse(dingJinkun, daiXiuzhen)
  linkSpouse(tangJingkai, dingYun)
  linkParent(tangJingkai, tangLingen)
  linkParent(tangJingkai, yaoXuehua)
  linkParent(dingYun, dingJinkun)
  linkParent(dingYun, daiXiuzhen)
  linkParent(tangYuelin, tangJingkai)
  linkParent(tangYuelin, dingYun)

  return [
    tangJingkai,
    tangYuelin,
    dingYun,
    tangLingen,
    yaoXuehua,
    dingJinkun,
    daiXiuzhen,
  ]
}

function familyData(members: Member[]): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(value => [value.id, value])),
  }
}

describe('layoutFamilyTree', () => {
  it('returns one card per member and safe family-unit geometry', async () => {
    const members = buildUserFixture()

    const scene = await layoutFamilyTree(members)

    expect(scene.cards.map(card => card.id).sort()).toEqual(
      members.map(value => value.id).sort(),
    )
    expect(scene.units.filter(unit => unit.kind === 'couple')).toHaveLength(3)
    expect(scene.diagnostics.filter(value => value.code === 'NODE_OVERLAP')).toEqual([])
    expect(scene.diagnostics.filter(value => (
      value.code === 'CROSS_FAMILY_SEGMENT_OVERLAP'
    ))).toEqual([])
  })

  it('returns an empty zero-sized scene for no members', async () => {
    const scene = await layoutFamilyTree([])

    expect(scene.cards).toEqual([])
    expect(scene.units).toEqual([])
    expect(scene.routes).toEqual([])
    expect(scene.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('uses the complete family data and persisted family accent', async () => {
    const dad = member('dad')
    const mom = member('mom')
    linkSpouse(dad, mom)
    const data = familyData([dad, mom])
    const unitId = 'unit:partnership:current:dad+mom'
    data.layoutPreferences.familyAccentAssignments[unitId] = '#123456'

    const scene = await layoutFamilyTree([dad, mom], { data })

    expect(scene.units).toHaveLength(1)
    expect(scene.units[0]).toMatchObject({ id: unitId, accent: '#123456' })
  })

  it('passes normalization diagnostics through the public facade', async () => {
    const child = member('child', {
      parents: [{ id: 'missing-parent', type: 'blood' }],
    })

    const scene = await layoutFamilyTree([child])

    expect(scene.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MISSING_REFERENCE',
      ids: ['child', 'missing-parent'],
    }))
  })

  it('does not turn a legacy primary spouse into a parent fact', async () => {
    const dad = member('dad')
    const stepMom = member('step-mom')
    const child = member('child')
    linkSpouse(dad, stepMom)
    linkParent(child, dad)
    const data = familyData([dad, stepMom, child])
    data.childLayoutAssignments.child = {
      primaryParentId: 'dad',
      primarySpouseId: 'step-mom',
    }

    const scene = await layoutFamilyTree([dad, stepMom, child], { data })

    expect(scene.cards.map(card => card.id).sort()).toEqual(['child', 'dad', 'step-mom'])
    expect(scene.diagnostics.filter(value => (
      value.code === 'INVALID_PRIMARY_PARENTAGE'
    ))).toEqual([])
  })
})
