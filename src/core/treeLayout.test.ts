import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { layoutFamilyTree } from './treeLayout'
import {
  threeRootChainFamily,
  twoDisconnectedRootComponents,
  twoRootMarriageFamilyData,
} from '@/__tests__/fixtures/families'
import { positiveCollinearOverlap } from './family-layout/testHelpers'

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

function linkSibling(left: Member, right: Member) {
  left.siblings.push({ id: right.id, type: 'blood' })
  right.siblings.push({ id: left.id, type: 'blood' })
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
  it('orders explicit siblings without parent data as adjacent root domains', async () => {
    const siblingA = member('sibling-a')
    const siblingB = member('sibling-b')
    const siblingC = member('sibling-c')
    linkSibling(siblingA, siblingB)
    linkSibling(siblingB, siblingC)
    const data = familyData([siblingA, siblingB, siblingC])
    data.siblingOrders['siblings:sibling-a+sibling-b+sibling-c'] = [
      'sibling-c',
      'sibling-a',
      'sibling-b',
    ]

    const scene = await layoutFamilyTree(Object.values(data.members), { data })

    expect([...scene.rootDomains]
      .sort((left, right) => left.rect.x - right.rect.x)
      .map(domain => domain.personIds[0]))
      .toEqual(['sibling-c', 'sibling-a', 'sibling-b'])
  })

  it('returns continuous root and bridge domains through the public facade', async () => {
    const data = twoRootMarriageFamilyData()
    const scene = await layoutFamilyTree(Object.values(data.members), { data })

    expect(scene.rootDomains).toHaveLength(2)
    expect(scene.bridgeDomains).toHaveLength(1)
    const orderedRoots = [...scene.rootDomains].sort((left, right) => (
      left.rect.x - right.rect.x
    ))
    expect(orderedRoots[0].rect.x + orderedRoots[0].rect.width)
      .toBeLessThan(orderedRoots[1].rect.x)
    expect(hasOverlappingRects(scene.cards.map(card => card.rect))).toBe(false)
    for (let left = 0; left < scene.routes.length; left += 1) {
      for (let right = left + 1; right < scene.routes.length; right += 1) {
        if (scene.routes[left].routeOwnerId === scene.routes[right].routeOwnerId) continue
        for (const leftSegment of scene.routes[left].segments) {
          for (const rightSegment of scene.routes[right].segments) {
            expect(positiveCollinearOverlap(leftSegment, rightSegment)).toBe(false)
          }
        }
      }
    }
  })

  it('does not let rootMemberId redefine visible roots', async () => {
    const data = twoDisconnectedRootComponents()
    data.rootMemberId = 'b'
    const scene = await layoutFamilyTree(Object.values(data.members), { data })

    expect(scene.rootDomains.map(domain => domain.id).sort()).toEqual([
      'domain:root:a-root-a+a-root-b',
      'domain:root:b-root-a+b-root-b',
    ])
    expect(scene.rootDomains[0].componentId).toBe('component:b')
  })

  it('does not let defaultViewpointId change root domains or geometry', async () => {
    const baselineData = twoRootMarriageFamilyData()
    const viewpointData = structuredClone(baselineData)
    viewpointData.defaultViewpointId = 'cross-child'

    const baseline = await layoutFamilyTree(Object.values(baselineData.members), {
      data: baselineData,
    })
    const withViewpoint = await layoutFamilyTree(Object.values(viewpointData.members), {
      data: viewpointData,
    })

    expect(withViewpoint).toEqual(baseline)
  })

  it('routes one parent family to children in both root and bridge domains', async () => {
    const family = threeRootChainFamily()
    const scene = await layoutFamilyTree(Object.values(family))
    const childDomainIds = new Set(['a-child-1', 'a-child-2'].map(personId => {
      const card = scene.cards.find(value => value.id === personId)!
      return scene.units.find(unit => unit.id === card.unitId)!.domainId
    }))

    expect(childDomainIds.size).toBe(2)
    expect(scene.routes).toContainEqual(expect.objectContaining({
      routeOwnerId: 'parentage:a-root-a+a-root-b',
      kind: 'primary',
    }))
    expect(scene.diagnostics.filter(value => (
      value.code === 'UNROUTABLE_PRIMARY_EDGE'
    ))).toEqual([])
  })

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

  it('places siblings in their shared manual order without birth dates', async () => {
    const parentA = member('parent-a')
    const parentB = member('parent-b')
    const childA = member('child-a')
    const childB = member('child-b')
    const childC = member('child-c')
    linkSpouse(parentA, parentB)
    for (const child of [childA, childB, childC]) {
      linkParent(child, parentA)
      linkParent(child, parentB)
    }
    const data = familyData([parentA, parentB, childA, childB, childC])
    const previousScene = await layoutFamilyTree(Object.values(data.members), { data })
    data.siblingOrders['parentage:parent-a+parent-b'] = [
      'child-c',
      'child-a',
      'child-b',
    ]

    const scene = await layoutFamilyTree(Object.values(data.members), {
      data,
      previousScene,
    })
    const xById = new Map(scene.cards.map(card => [card.id, card.rect.x]))

    expect(scene.primaryParentageGroups![0].childPersonIds).toEqual([
      'child-c',
      'child-a',
      'child-b',
    ])
    expect(xById.get('child-c')!).toBeLessThan(xById.get('child-a')!)
    expect(xById.get('child-a')!).toBeLessThan(xById.get('child-b')!)
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

function hasOverlappingRects(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
    leftIndex < rightIndex
    && left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  )))
}
