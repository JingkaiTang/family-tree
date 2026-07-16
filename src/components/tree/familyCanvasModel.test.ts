import { describe, expect, it } from 'vitest'
import type { LayoutScene } from '@/core/family-layout/types'
import { createEmptyFamily, type Member } from '@/core/schema'
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
