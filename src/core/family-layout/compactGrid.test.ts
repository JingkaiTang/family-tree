import { describe, expect, it } from 'vitest'
import { compactGrid } from './compactGrid'
import { DEFAULT_LAYOUT_METRICS } from './types'
import type { FamilyUnit, LayoutScene } from './types'

describe('compactGrid', () => {
  it('returns an empty zero-sized scene for empty input', () => {
    expect(compactGrid({
      units: [],
      rows: [],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })).toEqual({
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  })

  it('builds fixed internal geometry for a couple unit', () => {
    const unit = couple('parents', ['left', 'right'])

    const scene = compactGrid({
      units: [unit],
      rows: [{ generation: 0, unitIds: [unit.id] }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.units[0].rect).toEqual({ x: 0, y: 0, width: 360, height: 216 })
    expect(scene.cards).toEqual([{
      id: 'left',
      unitId: unit.id,
      generation: 0,
      rect: { x: 0, y: 0, width: 168, height: 216 },
    }, {
      id: 'right',
      unitId: unit.id,
      generation: 0,
      rect: { x: 192, y: 0, width: 168, height: 216 },
    }])
    expect(scene.cards[1].rect.x - (
      scene.cards[0].rect.x + scene.cards[0].rect.width
    )).toBe(DEFAULT_LAYOUT_METRICS.spouseGap)
    expect(scene.hubs).toEqual([{
      id: `hub:${unit.id}`,
      unitId: unit.id,
      point: { x: 180, y: 108 },
    }])
  })

  it('adds a bottom-center hub only to a single unit that owns parentage', () => {
    const parent = single('parent')
    const unrelated = single('unrelated')

    const scene = compactGrid({
      units: [parent, unrelated],
      rows: [{ generation: 0, unitIds: [parent.id, unrelated.id] }],
      parentageGroups: [{
        id: 'parentage:parent',
        sourceUnitId: parent.id,
        childPersonIds: [],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.hubs).toEqual([{
      id: `hub:${parent.id}`,
      unitId: parent.id,
      point: { x: 84, y: 216 },
    }])
  })

  it('snaps units to the grid without overlapping same-row families', () => {
    const parent = couple('parents', ['parent-left', 'parent-right'], 0)
    const child = single('child', 1)
    const childCouple = couple('child-couple', ['child-left', 'child-right'], 1)

    const scene = compactGrid({
      units: [parent, child, childCouple],
      rows: [{ generation: 0, unitIds: [parent.id] }, {
        generation: 1,
        unitIds: [child.id, childCouple.id],
      }],
      parentageGroups: [{
        id: 'parentage:parents',
        sourceUnitId: parent.id,
        childPersonIds: ['child', 'child-left'],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(scene.units.every(unit => (
      unit.rect.x % DEFAULT_LAYOUT_METRICS.gridSize === 0
    ))).toBe(true)
    expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
    const [left, right] = scene.units
      .filter(unit => unit.generation === 1)
      .sort((a, b) => a.rect.x - b.rect.x)
    expect(right.rect.x - (left.rect.x + left.rect.width)).toBeGreaterThanOrEqual(
      DEFAULT_LAYOUT_METRICS.familyGap,
    )
  })

  it('aligns a parent center to a simple child block within one grid cell', () => {
    const parent = single('parent', 0)
    const firstChild = single('first-child', 1)
    const secondChild = single('second-child', 1)

    const scene = compactGrid({
      units: [parent, firstChild, secondChild],
      rows: [{ generation: 0, unitIds: [parent.id] }, {
        generation: 1,
        unitIds: [firstChild.id, secondChild.id],
      }],
      parentageGroups: [{
        id: 'parentage:parent',
        sourceUnitId: parent.id,
        childPersonIds: ['first-child', 'second-child'],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    })
    const placedParent = scene.units.find(unit => unit.id === parent.id)!
    const children = scene.units.filter(unit => unit.generation === 1)
    const parentCenter = placedParent.rect.x + placedParent.rect.width / 2
    const childBlockCenter = (
      Math.min(...children.map(unit => unit.rect.x))
      + Math.max(...children.map(unit => unit.rect.x + unit.rect.width))
    ) / 2

    expect(Math.abs(parentCenter - childBlockCenter)).toBeLessThanOrEqual(
      DEFAULT_LAYOUT_METRICS.gridSize,
    )
  })

  it('packs disconnected component bounds with two family gaps', () => {
    const left = single('left')
    const right = single('right')

    const scene = compactGrid({
      units: [left, right],
      rows: [{ generation: 0, unitIds: [left.id, right.id] }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    })
    const [placedLeft, placedRight] = scene.units
      .sort((a, b) => a.rect.x - b.rect.x)

    expect(
      placedRight.rect.x - (placedLeft.rect.x + placedLeft.rect.width),
    ).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_METRICS.familyGap * 2)
  })

  it('preserves relative x positions in an unchanged component', () => {
    const changedParent = single('changed-parent', 0)
    const changedChild = single('changed-child', 1)
    const stableParent = single('stable-parent', 0)
    const stableChild = single('stable-child', 1)
    const units = [changedParent, changedChild, stableParent, stableChild]
    const rows = [{
      generation: 0,
      unitIds: [changedParent.id, stableParent.id],
    }, {
      generation: 1,
      unitIds: [changedChild.id, stableChild.id],
    }]
    const parentageGroups = [{
      id: 'parentage:changed',
      sourceUnitId: changedParent.id,
      childPersonIds: ['changed-child'],
    }, {
      id: 'parentage:stable',
      sourceUnitId: stableParent.id,
      childPersonIds: ['stable-child'],
    }]
    const previousScene = sceneAt(units, rows, {
      [changedParent.id]: 0,
      [changedChild.id]: 0,
      [stableParent.id]: 960,
      [stableChild.id]: 1200,
    })

    const scene = compactGrid({
      units,
      rows,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
      changedIds: ['changed-parent'],
    })
    const stableParentX = scene.units.find(unit => unit.id === stableParent.id)!.rect.x
    const stableChildX = scene.units.find(unit => unit.id === stableChild.id)!.rect.x

    expect(stableChildX - stableParentX).toBe(240)
  })

  it('preserves absolute x outside the reordered row and its direct relatives', () => {
    const grandparent = single('grandparent', 0)
    const parent = single('parent', 1)
    const target = single('target', 2)
    const rowPeer = single('row-peer', 2)
    const child = single('child', 3)
    const grandchild = single('grandchild', 4)
    const independent = single('independent', 0)
    const units = [
      grandparent,
      parent,
      target,
      rowPeer,
      child,
      grandchild,
      independent,
    ]
    const rows = [
      { generation: 0, unitIds: [grandparent.id, independent.id] },
      { generation: 1, unitIds: [parent.id] },
      { generation: 2, unitIds: [rowPeer.id, target.id] },
      { generation: 3, unitIds: [child.id] },
      { generation: 4, unitIds: [grandchild.id] },
    ]
    const parentageGroups = [{
      id: 'parentage:grandparent',
      sourceUnitId: grandparent.id,
      childPersonIds: ['parent'],
    }, {
      id: 'parentage:parent',
      sourceUnitId: parent.id,
      childPersonIds: ['target', 'row-peer'],
    }, {
      id: 'parentage:target',
      sourceUnitId: target.id,
      childPersonIds: ['child'],
    }, {
      id: 'parentage:child',
      sourceUnitId: child.id,
      childPersonIds: ['grandchild'],
    }]
    const previousScene = sceneAt(units, [
      rows[0],
      rows[1],
      { generation: 2, unitIds: [target.id, rowPeer.id] },
      rows[3],
      rows[4],
    ], {
      [grandparent.id]: 480,
      [parent.id]: 480,
      [target.id]: 240,
      [rowPeer.id]: 720,
      [child.id]: 480,
      [grandchild.id]: 480,
      [independent.id]: 1440,
    })

    const scene = compactGrid({
      units,
      rows,
      parentageGroups,
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
      changedIds: ['target', 'parent', 'child'],
    })
    const x = (unitId: string) => scene.units.find(unit => unit.id === unitId)!.rect.x

    expect(x(grandparent.id)).toBe(480)
    expect(x(grandchild.id)).toBe(480)
    expect(x(independent.id)).toBe(1440)
  })

  it('re-applies row spacing after multiple parents align to one child block', () => {
    const firstParent = single('first-parent', 0)
    const secondParent = single('second-parent', 0)
    const child = single('shared-child', 1)

    const scene = compactGrid({
      units: [firstParent, secondParent, child],
      rows: [{
        generation: 0,
        unitIds: [firstParent.id, secondParent.id],
      }, {
        generation: 1,
        unitIds: [child.id],
      }],
      parentageGroups: [{
        id: 'parentage:first-parent',
        sourceUnitId: firstParent.id,
        childPersonIds: ['shared-child'],
      }, {
        id: 'parentage:second-parent',
        sourceUnitId: secondParent.id,
        childPersonIds: ['shared-child'],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    })

    expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
  })

  it('keeps collision shifts snapped when unit widths are not grid multiples', () => {
    const firstParent = single('first-parent', 0)
    const secondParent = single('second-parent', 0)
    const child = single('shared-child', 1)
    const metrics = { ...DEFAULT_LAYOUT_METRICS, cardWidth: 170 }

    const scene = compactGrid({
      units: [firstParent, secondParent, child],
      rows: [{
        generation: 0,
        unitIds: [firstParent.id, secondParent.id],
      }, {
        generation: 1,
        unitIds: [child.id],
      }],
      parentageGroups: [{
        id: 'parentage:first-parent',
        sourceUnitId: firstParent.id,
        childPersonIds: ['shared-child'],
      }, {
        id: 'parentage:second-parent',
        sourceUnitId: secondParent.id,
        childPersonIds: ['shared-child'],
      }],
      metrics,
    })
    const parents = scene.units
      .filter(unit => unit.generation === 0)
      .sort((left, right) => left.rect.x - right.rect.x)

    expect(scene.units.every(unit => unit.rect.x % metrics.gridSize === 0)).toBe(true)
    expect(scene.cards.every(card => card.rect.x % metrics.gridSize === 0)).toBe(true)
    expect(hasOverlappingRects(scene.units.map(unit => unit.rect))).toBe(false)
    expect(
      parents[1].rect.x - (parents[0].rect.x + parents[0].rect.width),
    ).toBeGreaterThanOrEqual(metrics.familyGap)
    expect(scene.hubs.map(hub => hub.point)).toEqual(parents.map(parent => ({
      x: parent.rect.x + metrics.cardWidth / 2,
      y: parent.rect.y + metrics.cardHeight,
    })))
  })

  it('preserves previous disconnected component order in geometry and row metadata', () => {
    const first = single('first')
    const second = single('second')
    const rows = [{ generation: 0, unitIds: [first.id, second.id] }]
    const previousScene = sceneAt([first, second], rows, {
      [first.id]: 480,
      [second.id]: 0,
    })

    const scene = compactGrid({
      units: [first, second],
      rows,
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
    })

    expect(scene.units.find(unit => unit.id === second.id)!.rect.x).toBeLessThan(
      scene.units.find(unit => unit.id === first.id)!.rect.x,
    )
    expect(scene.rows[0].unitIds).toEqual([second.id, first.id])
  })

  it('appends a new component after components in their previous order', () => {
    const first = single('first')
    const added = single('new')
    const second = single('second')
    const rows = [{ generation: 0, unitIds: [first.id, added.id, second.id] }]
    const previousScene = sceneAt(
      [first, second],
      [{ generation: 0, unitIds: [second.id, first.id] }],
      { [first.id]: 480, [second.id]: 0 },
    )

    const scene = compactGrid({
      units: [first, added, second],
      rows,
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
    })

    expect(scene.rows[0].unitIds).toEqual([second.id, first.id, added.id])
  })

  it('keeps surviving component coordinates when a component is added', () => {
    const first = single('first')
    const second = single('second')
    const added = single('added')
    const previousScene = sceneAt(
      [first, second],
      [{ generation: 0, unitIds: [first.id, second.id] }],
      { [first.id]: 240, [second.id]: 720 },
    )

    const scene = compactGrid({
      units: [first, second, added],
      rows: [{ generation: 0, unitIds: [first.id, second.id, added.id] }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
      changedIds: ['added'],
    })
    const x = new Map(scene.units.map(unit => [unit.id, unit.rect.x]))

    expect(x.get(first.id)).toBe(240)
    expect(x.get(second.id)).toBe(720)
  })

  it('keeps surviving component coordinates when a component is deleted', () => {
    const deleted = single('deleted')
    const first = single('first')
    const second = single('second')
    const previousScene = sceneAt(
      [deleted, first, second],
      [{ generation: 0, unitIds: [deleted.id, first.id, second.id] }],
      { [deleted.id]: 0, [first.id]: 480, [second.id]: 960 },
    )

    const scene = compactGrid({
      units: [first, second],
      rows: [{ generation: 0, unitIds: [first.id, second.id] }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
      previousScene,
      changedIds: ['deleted'],
    })
    const x = new Map(scene.units.map(unit => [unit.id, unit.rect.x]))

    expect(x.get(first.id)).toBe(480)
    expect(x.get(second.id)).toBe(960)
  })

  it('uses metric-driven clear space between generation rows', () => {
    const parent = single('parent', 0)
    const child = single('child', 1)
    const metrics = { ...DEFAULT_LAYOUT_METRICS, generationGap: 48 }

    const scene = compactGrid({
      units: [parent, child],
      rows: [{ generation: 0, unitIds: [parent.id] }, {
        generation: 1,
        unitIds: [child.id],
      }],
      parentageGroups: [{
        id: 'parentage:parent',
        sourceUnitId: parent.id,
        childPersonIds: ['child'],
      }],
      metrics,
    })
    const placedParent = scene.units.find(unit => unit.id === parent.id)!
    const placedChild = scene.units.find(unit => unit.id === child.id)!

    expect(placedChild.rect.y - (
      placedParent.rect.y + placedParent.rect.height
    )).toBe(48)
    expect(scene.bounds).toEqual({ x: 0, y: 0, width: 168, height: 480 })
  })

  it('returns byte-identical geometry for identical input', () => {
    const parent = couple('parents', ['left', 'right'], 0)
    const child = single('child', 1)
    const value = {
      units: [parent, child],
      rows: [{ generation: 0, unitIds: [parent.id] }, {
        generation: 1,
        unitIds: [child.id],
      }],
      parentageGroups: [{
        id: 'parentage:parents',
        sourceUnitId: parent.id,
        childPersonIds: ['child'],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    }

    expect(JSON.stringify(compactGrid(structuredClone(value)))).toBe(
      JSON.stringify(compactGrid(structuredClone(value))),
    )
  })

  it('places 500 disconnected components completely and deterministically', () => {
    const units = Array.from({ length: 500 }, (_, index) => (
      single(`person-${index.toString().padStart(3, '0')}`)
    ))
    const value = {
      units,
      rows: [{ generation: 0, unitIds: units.map(unit => unit.id) }],
      parentageGroups: [],
      metrics: DEFAULT_LAYOUT_METRICS,
    }

    const first = compactGrid(value)
    const second = compactGrid(structuredClone(value))

    expect(first.units).toHaveLength(500)
    expect(new Set(first.units.map(unit => unit.id)).size).toBe(500)
    expect(first.cards).toHaveLength(500)
    expect(new Set(first.cards.map(card => card.id)).size).toBe(500)
    expect(first.rows[0].unitIds).toHaveLength(500)
    expect(first.units.every(unit => (
      unit.rect.x % DEFAULT_LAYOUT_METRICS.gridSize === 0
    ))).toBe(true)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('does not mutate its input', () => {
    const parent = single('parent', 0)
    const child = single('child', 1)
    const value = {
      units: [parent, child],
      rows: [{ generation: 0, unitIds: [parent.id] }, {
        generation: 1,
        unitIds: [child.id],
      }],
      parentageGroups: [{
        id: 'parentage:parent',
        sourceUnitId: parent.id,
        childPersonIds: ['child'],
      }],
      metrics: DEFAULT_LAYOUT_METRICS,
    }
    const before = structuredClone(value)

    compactGrid(value)

    expect(value).toEqual(before)
  })
})

function hasOverlappingRects(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  return rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
    leftIndex < rightIndex
    && left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  )))
}

function single(id: string, generation = 0): FamilyUnit {
  return {
    id: `unit:person:${id}`,
    kind: 'single',
    memberIds: [id],
    generation,
    width: 168,
    lineageAffinity: {},
    accent: '',
  }
}

function couple(id: string, memberIds: [string, string], generation = 0): FamilyUnit {
  return {
    id: `unit:partnership:${id}`,
    kind: 'couple',
    memberIds,
    generation,
    width: 360,
    lineageAffinity: {},
    accent: '',
  }
}

function sceneAt(
  units: FamilyUnit[],
  rows: Array<{ generation: number; unitIds: string[] }>,
  xByUnitId: Record<string, number>,
): LayoutScene {
  const placedUnits = units.map((unit, order) => ({
    ...unit,
    order,
    rect: {
      x: xByUnitId[unit.id],
      y: unit.generation * 576,
      width: unit.width,
      height: 216,
    },
  }))
  return {
    units: placedUnits,
    cards: [],
    hubs: [],
    rows: rows.map(row => ({ id: `row:${row.generation}`, ...row })),
    routes: [],
    bounds: { x: 0, y: 0, width: 1368, height: 792 },
    diagnostics: [],
  }
}
