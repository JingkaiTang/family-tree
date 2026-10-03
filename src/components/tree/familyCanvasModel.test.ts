import { describe, expect, it } from 'vitest'
import { multiUnionFamily } from '@/__tests__/fixtures/families'
import { linkParent } from '@/core/family-layout/testHelpers'
import type { LayoutScene } from '@/core/family-layout/types'
import { createEmptyFamily, type Member } from '@/core/schema'
import { layoutFamilyTreeSync } from '@/core/treeLayoutCore'
import {
  affectedMemberIds,
  buildFamilyCanvasSceneModel,
  hasExpectedLayoutPreference,
  primarySubtreeUnitIds,
} from './familyCanvasModel'

const scene = {
  units: [
    { id: 'parents', domainId: 'root', memberIds: ['a'] },
    { id: 'children', domainId: 'root', memberIds: ['b'] },
  ],
  cards: [
    { id: 'a', unitId: 'parents', rect: { x: 10, y: 20, width: 100, height: 120 } },
    { id: 'b', unitId: 'children', rect: { x: 10, y: 200, width: 100, height: 120 } },
  ],
  hubs: [{ id: 'hub', unitId: 'parents', point: { x: 60, y: 140 } }],
  rows: [],
  rootDomains: [{
    id: 'root',
    componentId: 'component',
    rootIds: ['root-family'],
    accent: '#123456',
    rect: { x: 0, y: 0, width: 200, height: 400 },
  }],
  bridgeDomains: [],
  primaryParentageGroups: [{
    id: 'parentage',
    sourceUnitId: 'parents',
    childPersonIds: ['b'],
  }],
  gateways: [],
  routes: [],
  bounds: { x: -20, y: -10, width: 220, height: 410 },
  diagnostics: [],
} as unknown as LayoutScene

function member(id: string): Member {
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
  }
}

describe('familyCanvasModel', () => {
  it('一次构建画布尺寸、索引和根域展示数据', () => {
    const model = buildFamilyCanvasSceneModel(scene, 40)

    expect(model.sceneOffset).toEqual({ x: 60, y: 50 })
    expect(model.canvasSize).toEqual({ width: 600, height: 490 })
    expect(model.cardsByUnitId.get('parents')?.[0].id).toBe('a')
    expect(model.hubsByUnitId.get('parents')?.[0].id).toBe('hub')
    expect(model.rootAccentById).toEqual({ 'root-family': '#123456' })
  })

  it('沿主亲子关系收集可拖动子树单元', () => {
    const model = buildFamilyCanvasSceneModel(scene, 40)
    expect(primarySubtreeUnitIds(scene, model, 'parents')).toEqual(['parents', 'children'])
  })

  it('拖动非根家庭时保留各段婚姻的全部子女及孙辈', () => {
    const members = multiUnionFamily()
    members.grandparent = member('grandparent')
    members.grandchildAB = member('grandchildAB')
    members.grandchildAC = member('grandchildAC')
    linkParent(members.parentA, members.grandparent)
    linkParent(members.grandchildAB, members.childAB1)
    linkParent(members.grandchildAC, members.childAC)
    const familyScene = layoutFamilyTreeSync(Object.values(members))
    const parentUnitId = familyScene.cards.find(card => card.id === 'parentA')!.unitId

    expect(familyScene.units.find(unit => unit.id === parentUnitId)?.isRootFamily).toBe(false)
    for (const groups of [
      familyScene.primaryParentageGroups,
      [...familyScene.primaryParentageGroups!].reverse(),
      [...familyScene.primaryParentageGroups!, ...familyScene.primaryParentageGroups!],
    ]) {
      const reordered = { ...familyScene, primaryParentageGroups: groups }
      const model = buildFamilyCanvasSceneModel(reordered, 40)
      const unitIds = primarySubtreeUnitIds(reordered, model, parentUnitId)
      expect(new Set(unitIds).size).toBe(unitIds.length)
      expect(familyScene.cards.filter(card => unitIds.includes(card.unitId))
        .map(card => card.id).sort())
        .toEqual(['childAB1', 'childAB2', 'childAC', 'grandchildAB', 'grandchildAC', 'parentA', 'parentB'])
    }
  })

  it('识别布局偏好回写并扩展受影响成员', () => {
    const data = createEmptyFamily()
    const parent = member('a')
    const child = member('b')
    parent.children.push({ id: 'b', type: 'blood' })
    child.parents.push({ id: 'a', type: 'blood' })
    data.members = { a: parent, b: child }
    data.layoutPreferences.rootOrders.push({
      componentId: 'component',
      rootIds: ['r2', 'r1'],
    })

    expect(hasExpectedLayoutPreference(data, {
      kind: 'root-domain',
      componentId: 'component',
      rootIds: ['r2', 'r1'],
    })).toBe(true)
    expect(affectedMemberIds(data, ['a'])).toEqual(['a', 'b'])
  })
})
