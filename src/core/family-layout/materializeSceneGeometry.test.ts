import { describe, expect, it } from 'vitest'
import { materializeSceneGeometry } from './materializeSceneGeometry'
import {
  DEFAULT_LAYOUT_METRICS,
  type ParentageGroup,
  type PlacedFamilyUnit,
  type PlacedLayoutDomain,
  type PlacedRow,
} from './types'

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
      ...rootFields(['a']),
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

    const scene = materializeTestGeometry({
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
      ...rootFields(['a', 'b']),
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

    const scene = materializeTestGeometry({
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
      ...rootFields(['a', 'b']),
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

    const scene = materializeTestGeometry({
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

  it('preserves source-root member order in rooted cards and domain geometry', () => {
    const unit: PlacedFamilyUnit = {
      id: 'unit:partnership:current:a+b',
      kind: 'couple',
      memberIds: ['b', 'a'],
      generation: 0,
      width: 360,
      lineageAffinity: {},
      accent: '#345678',
      rootSignature: ['root:a', 'root:b'],
      domainId: 'domain:bridge:root:a|root:b',
      memberRootIds: { a: 'root:a', b: 'root:b' },
      rootAccent: '#4F7CAC',
      isRootFamily: false,
      rect: { x: 24, y: 0, width: 360, height: 216 },
      order: 0,
    }
    const domain: PlacedLayoutDomain = {
      id: unit.domainId,
      kind: 'pair-bridge',
      componentId: 'component:a',
      rootIds: ['root:b', 'root:a'],
      signature: ['root:a', 'root:b'],
      personIds: ['a', 'b'],
      unitIds: [unit.id],
      order: 0,
      accent: '#4F7CAC',
      rect: { x: 0, y: 0, width: 408, height: 216 },
      columnStart: 0,
      columnEnd: 16,
    }

    const scene = materializeSceneGeometry({
      placedUnits: [unit],
      placedDomains: [domain],
      rows: [{ id: `row:${domain.id}:0`, generation: 0, unitIds: [unit.id] }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.cards.map(card => [card.id, card.rect.x])).toEqual([
      ['b', 24],
      ['a', 216],
    ])
    expect(scene.rootDomains).toEqual([])
    expect(scene.bridgeDomains).toEqual([domain])
  })
})

function rootFields(memberIds: string[]) {
  return {
    rootSignature: ['root:test'],
    domainId: 'domain:root:test',
    memberRootIds: Object.fromEntries(memberIds.map(id => [id, 'root:test'])),
    rootAccent: '#4F7CAC',
    isRootFamily: true,
  }
}

function materializeTestGeometry(input: {
  placedUnits: PlacedFamilyUnit[]
  rows: Array<Omit<PlacedRow, 'id'>>
  parentageGroups: ParentageGroup[]
  metrics: typeof DEFAULT_LAYOUT_METRICS
}) {
  const domain: PlacedLayoutDomain = {
    id: 'domain:root:test',
    kind: 'root',
    componentId: 'component:test',
    rootIds: ['root:test'],
    signature: ['root:test'],
    personIds: input.placedUnits.flatMap(unit => unit.memberIds),
    unitIds: input.placedUnits.map(unit => unit.id),
    order: 0,
    accent: '#4F7CAC',
    rect: { x: 0, y: 0, width: 1200, height: 216 },
    columnStart: 0,
    columnEnd: 49,
  }
  return materializeSceneGeometry({
    ...input,
    placedDomains: [domain],
    rows: input.rows.map(row => ({
      ...row,
      id: `row:${row.generation}`,
    })),
  })
}
