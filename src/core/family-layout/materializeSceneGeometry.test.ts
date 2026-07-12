import { describe, expect, it } from 'vitest'
import { materializeSceneGeometry } from './materializeSceneGeometry'
import { DEFAULT_LAYOUT_METRICS, type ParentageGroup, type PlacedFamilyUnit } from './types'

describe('materializeSceneGeometry', () => {
  it('does not add an unused generic hub beside explicit single-parentage ports', () => {
    const source: PlacedFamilyUnit = {
      id: 'unit:person:a',
      kind: 'single',
      memberIds: ['a'],
      generation: 0,
      width: 168,
      lineageAffinity: {},
      accent: '',
      rect: { x: 48, y: 0, width: 168, height: 216 },
      order: 0,
    }
    const parentageGroups: ParentageGroup[] = ['a+c', 'a+d'].map(id => ({
      id: `parentage:${id}`,
      sourceUnitId: source.id,
      sourceHubId: `hub:parentage:${id}`,
      sourceAnchorPersonId: 'a',
      childPersonIds: [`child:${id}`],
    }))

    const scene = materializeSceneGeometry({
      placedUnits: [source],
      rows: [{ generation: 0, unitIds: [source.id] }],
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.hubs.map(hub => hub.id)).toEqual([
      'hub:parentage:a+c',
      'hub:parentage:a+d',
    ])
  })

  it('allocates stable distinct bottom ports for repeated parentage anchors', () => {
    const source: PlacedFamilyUnit = {
      id: 'unit:partnership:current:a+b',
      kind: 'couple',
      memberIds: ['a', 'b'],
      generation: 0,
      width: 360,
      lineageAffinity: {},
      accent: '',
      rect: { x: 240, y: 0, width: 360, height: 216 },
      order: 0,
    }
    const parentageGroups: ParentageGroup[] = ['a+c', 'a+d'].map(id => ({
      id: `parentage:${id}`,
      sourceUnitId: source.id,
      sourceHubId: `hub:parentage:${id}`,
      sourceAnchorPersonId: 'a',
      childPersonIds: [`child:${id}`],
    }))

    const scene = materializeSceneGeometry({
      placedUnits: [source],
      rows: [{ generation: 0, unitIds: [source.id] }],
      parentageGroups: [...parentageGroups].reverse(),
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.hubs.filter(hub => hub.id.startsWith('hub:parentage:'))).toEqual([
      {
        id: 'hub:parentage:a+c',
        unitId: source.id,
        point: { x: 316, y: 216 },
      },
      {
        id: 'hub:parentage:a+d',
        unitId: source.id,
        point: { x: 332, y: 216 },
      },
    ])
  })

  it('compresses many anchor ports within the card bottom clearance', () => {
    const source: PlacedFamilyUnit = {
      id: 'unit:partnership:current:a+b',
      kind: 'couple',
      memberIds: ['a', 'b'],
      generation: 0,
      width: 360,
      lineageAffinity: {},
      accent: '',
      rect: { x: 240, y: 0, width: 360, height: 216 },
      order: 0,
    }
    const parentageGroups: ParentageGroup[] = Array.from({ length: 11 }, (_, index) => ({
      id: `parentage:a+${index.toString().padStart(2, '0')}`,
      sourceUnitId: source.id,
      sourceHubId: `hub:parentage:a+${index.toString().padStart(2, '0')}`,
      sourceAnchorPersonId: 'a',
      childPersonIds: [`child:${index}`],
    }))

    const scene = materializeSceneGeometry({
      placedUnits: [source],
      rows: [{ generation: 0, unitIds: [source.id] }],
      parentageGroups: [...parentageGroups].reverse(),
      metrics: DEFAULT_LAYOUT_METRICS,
    })
    const ports = scene.hubs.filter(hub => hub.id.startsWith('hub:parentage:'))

    expect(ports.map(hub => hub.id)).toEqual(parentageGroups.map(group => group.sourceHubId))
    expect(new Set(ports.map(hub => hub.point.x)).size).toBe(11)
    expect(Math.min(...ports.map(hub => hub.point.x))).toBe(252)
    expect(Math.max(...ports.map(hub => hub.point.x))).toBe(396)
  })
})
