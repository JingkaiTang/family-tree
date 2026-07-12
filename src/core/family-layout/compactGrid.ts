import type {
  FamilyUnit,
  LayoutMetrics,
  LayoutScene,
  OrderedGeneration,
  ParentageGroup,
  PlacedFamilyUnit,
  SceneGeometry,
} from './types'
import {
  familyUnitWidth,
  materializeSceneGeometry,
} from './materializeSceneGeometry'

export { familyUnitWidth } from './materializeSceneGeometry'

export interface CompactGridInput {
  units: FamilyUnit[]
  rows: OrderedGeneration[]
  parentageGroups: ParentageGroup[]
  metrics: LayoutMetrics
  previousScene?: LayoutScene
  changedIds?: string[]
}

export function compactGrid(input: CompactGridInput): SceneGeometry {
  if (input.units.length === 0) {
    return {
      units: [],
      cards: [],
      hubs: [],
      rows: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const unitById = new Map(input.units.map(unit => [unit.id, unit]))
  const firstGeneration = Math.min(...input.rows.map(row => row.generation))
  const units: PlacedFamilyUnit[] = input.rows.flatMap(row => {
    let nextLeft = 0
    return row.unitIds.flatMap((unitId, order) => {
      const unit = unitById.get(unitId)
      if (unit === undefined) return []
      const width = familyUnitWidth(unit, input.metrics)
      const placedUnit: PlacedFamilyUnit = {
        ...unit,
        rect: {
          x: Math.round(nextLeft / input.metrics.gridSize) * input.metrics.gridSize,
          y: (row.generation - firstGeneration)
            * (input.metrics.cardHeight + input.metrics.generationGap),
          width,
          height: input.metrics.cardHeight,
        },
        order,
      }
      nextLeft = placedUnit.rect.x + width + input.metrics.familyGap
      return [placedUnit]
    })
  })
  const placedUnitById = new Map(units.map(unit => [unit.id, unit]))
  const placedUnitIdByPersonId = new Map<string, string>()
  units.forEach(unit => unit.memberIds.forEach(personId => (
    placedUnitIdByPersonId.set(personId, unit.id)
  )))
  const components = connectedComponents(
    units,
    input.parentageGroups,
    placedUnitIdByPersonId,
  )
  const componentIndexByUnitId = new Map<string, number>()
  components.forEach((component, componentIndex) => component.forEach(unitId => (
    componentIndexByUnitId.set(unitId, componentIndex)
  )))
  const rowUnitsByComponent = components.map(() => [] as PlacedFamilyUnit[][])
  for (const row of input.rows) {
    const rowUnits = new Map<number, PlacedFamilyUnit[]>()
    for (const unitId of row.unitIds) {
      const componentIndex = componentIndexByUnitId.get(unitId)
      const unit = placedUnitById.get(unitId)
      if (componentIndex === undefined || unit === undefined) continue
      const componentRowUnits = rowUnits.get(componentIndex) ?? []
      componentRowUnits.push(unit)
      rowUnits.set(componentIndex, componentRowUnits)
    }
    for (const [componentIndex, componentRowUnits] of rowUnits) {
      rowUnitsByComponent[componentIndex].push(componentRowUnits)
    }
  }
  const previousXByUnitId = new Map(
    input.previousScene?.units.map(unit => [unit.id, unit.rect.x]) ?? [],
  )
  const fixedUnitIds = new Set<string>()
  if (input.previousScene !== undefined && input.changedIds !== undefined) {
    const changedIds = new Set(input.changedIds)
    const reorderedUnitIds = changedRowUnitIds(input.rows, input.previousScene)
    for (const unit of units) {
      const unchanged = unit.memberIds.every(personId => !changedIds.has(personId))
        && !reorderedUnitIds.has(unit.id)
      const previousX = previousXByUnitId.get(unit.id)
      if (!unchanged || previousX === undefined) continue
      unit.rect.x = previousX
      fixedUnitIds.add(unit.id)
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    const desiredCenters = new Map<string, number[]>()
    for (const unit of units) {
      if (!fixedUnitIds.has(unit.id)) addDesiredCenter(
        desiredCenters,
        unit.id,
        unitCenter(unit),
      )
    }
    for (const group of [...input.parentageGroups]
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const source = placedUnitById.get(group.sourceUnitId)
      const children = [...new Set(group.childPersonIds
        .map(personId => placedUnitIdByPersonId.get(personId)))]
        .map(unitId => unitId === undefined ? undefined : placedUnitById.get(unitId))
        .filter((unit): unit is PlacedFamilyUnit => unit !== undefined)
      if (
        source === undefined
        || children.length === 0
        || fixedUnitIds.has(source.id)
      ) continue
      const childBlockLeft = Math.min(...children.map(unit => unit.rect.x))
      const childBlockRight = Math.max(...children.map(unit => (
        unit.rect.x + unit.rect.width
      )))
      const childBlockCenter = (childBlockLeft + childBlockRight) / 2
      const sourceCenter = unitCenter(source)
      addDesiredCenter(desiredCenters, source.id, childBlockCenter)
      const childBlockShift = sourceCenter - childBlockCenter
      for (const child of children) {
        if (fixedUnitIds.has(child.id)) continue
        addDesiredCenter(
          desiredCenters,
          child.id,
          unitCenter(child) + childBlockShift,
        )
      }
    }
    for (const [unitId, centers] of desiredCenters) {
      if (fixedUnitIds.has(unitId)) continue
      const unit = placedUnitById.get(unitId)!
      const desiredCenter = centers.reduce((sum, center) => sum + center, 0)
        / centers.length
      unit.rect.x = Math.round(
        (desiredCenter - unit.rect.width / 2) / input.metrics.gridSize,
      ) * input.metrics.gridSize
    }
    for (const componentIndex of components.keys()) {
      for (const rowUnits of rowUnitsByComponent[componentIndex]) {
        if (rowUnits.some(unit => fixedUnitIds.has(unit.id))) {
          scanRowPreservingFixed(rowUnits, fixedUnitIds, input.metrics)
        } else {
          scanRow(rowUnits, input.metrics)
        }
      }
    }
  }
  const inputPositionByUnitId = new Map(
    input.rows.flatMap(row => row.unitIds).map((unitId, index) => [unitId, index]),
  )
  components.sort((left, right) => {
    const leftPrevious = minimumKnownPosition(left, previousXByUnitId)
    const rightPrevious = minimumKnownPosition(right, previousXByUnitId)
    if (leftPrevious !== undefined && rightPrevious === undefined) return -1
    if (leftPrevious === undefined && rightPrevious !== undefined) return 1
    if (leftPrevious !== undefined && rightPrevious !== undefined) {
      return leftPrevious - rightPrevious || left[0].localeCompare(right[0])
    }
    return (minimumKnownPosition(left, inputPositionByUnitId) ?? 0)
      - (minimumKnownPosition(right, inputPositionByUnitId) ?? 0)
      || left[0].localeCompare(right[0])
  })
  let componentLeft = 0
  for (const component of components) {
    const componentUnits = component.map(unitId => placedUnitById.get(unitId)!)
    const localLeft = Math.min(...componentUnits.map(unit => unit.rect.x))
    if (!component.some(unitId => fixedUnitIds.has(unitId))) {
      const offset = componentLeft - localLeft
      componentUnits.forEach(unit => { unit.rect.x += offset })
    }
    const packedRight = Math.max(...componentUnits.map(unit => unit.rect.x + unit.rect.width))
    componentLeft = snapUp(
      Math.max(componentLeft, packedRight) + input.metrics.familyGap * 2,
      input.metrics.gridSize,
    )
  }
  return materializeSceneGeometry({
    placedUnits: units,
    rows: input.rows,
    parentageGroups: input.parentageGroups,
    metrics: input.metrics,
  })
}

function changedRowUnitIds(
  rows: OrderedGeneration[],
  previousScene: LayoutScene,
): Set<string> {
  const changed = new Set<string>()
  for (const row of rows) {
    const previous = previousScene.rows.find(value => value.generation === row.generation)
    if (
      previous === undefined
      || previous.unitIds.length !== row.unitIds.length
      || previous.unitIds.some((unitId, index) => unitId !== row.unitIds[index])
    ) {
      row.unitIds.forEach(unitId => changed.add(unitId))
    }
  }
  return changed
}

function connectedComponents(
  units: PlacedFamilyUnit[],
  groups: ParentageGroup[],
  unitIdByPersonId: Map<string, string>,
): string[][] {
  const adjacency = new Map(units.map(unit => [unit.id, new Set<string>()]))
  for (const group of groups) {
    if (!adjacency.has(group.sourceUnitId)) continue
    for (const childPersonId of group.childPersonIds) {
      const childUnitId = unitIdByPersonId.get(childPersonId)
      if (childUnitId === undefined || !adjacency.has(childUnitId)) continue
      adjacency.get(group.sourceUnitId)!.add(childUnitId)
      adjacency.get(childUnitId)!.add(group.sourceUnitId)
    }
  }

  const visited = new Set<string>()
  const components: string[][] = []
  for (const unitId of [...adjacency.keys()].sort((a, b) => a.localeCompare(b))) {
    if (visited.has(unitId)) continue
    const component: string[] = []
    const pending = [unitId]
    visited.add(unitId)
    while (pending.length > 0) {
      const currentId = pending.pop()!
      component.push(currentId)
      for (const neighborId of [...(adjacency.get(currentId) ?? [])]
        .sort((a, b) => b.localeCompare(a))) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        pending.push(neighborId)
      }
    }
    components.push(component.sort((a, b) => a.localeCompare(b)))
  }
  return components
}

function minimumKnownPosition(
  unitIds: string[],
  positions: Map<string, number>,
): number | undefined {
  const knownPositions = unitIds
    .map(unitId => positions.get(unitId))
    .filter((position): position is number => position !== undefined)
  return knownPositions.length === 0 ? undefined : Math.min(...knownPositions)
}

function scanRow(units: PlacedFamilyUnit[], metrics: LayoutMetrics) {
  for (let index = 1; index < units.length; index++) {
    const previous = units[index - 1]
    const minimumLeft = snapUp(
      previous.rect.x + previous.rect.width + metrics.familyGap,
      metrics.gridSize,
    )
    units[index].rect.x = Math.max(units[index].rect.x, minimumLeft)
  }
  for (let index = units.length - 2; index >= 0; index--) {
    const next = units[index + 1]
    const maximumLeft = snapDown(
      next.rect.x - metrics.familyGap - units[index].rect.width,
      metrics.gridSize,
    )
    units[index].rect.x = Math.min(units[index].rect.x, maximumLeft)
  }
  for (const unit of units) {
    unit.rect.x = Math.round(unit.rect.x / metrics.gridSize) * metrics.gridSize
  }
  for (let index = 1; index < units.length; index++) {
    const previous = units[index - 1]
    const minimumLeft = snapUp(
      previous.rect.x + previous.rect.width + metrics.familyGap,
      metrics.gridSize,
    )
    units[index].rect.x = Math.max(units[index].rect.x, minimumLeft)
  }
}

function scanRowPreservingFixed(
  units: PlacedFamilyUnit[],
  fixedUnitIds: Set<string>,
  metrics: LayoutMetrics,
) {
  for (let index = 1; index < units.length; index++) {
    const unit = units[index]
    if (fixedUnitIds.has(unit.id)) continue
    const previous = units[index - 1]
    unit.rect.x = Math.max(
      unit.rect.x,
      snapUp(previous.rect.x + previous.rect.width + metrics.familyGap, metrics.gridSize),
    )
  }
  for (let index = units.length - 2; index >= 0; index--) {
    const unit = units[index]
    if (fixedUnitIds.has(unit.id)) continue
    const next = units[index + 1]
    unit.rect.x = Math.min(
      unit.rect.x,
      snapDown(next.rect.x - metrics.familyGap - unit.rect.width, metrics.gridSize),
    )
  }
}

function snapUp(value: number, gridSize: number): number {
  return Math.ceil(value / gridSize) * gridSize
}

function snapDown(value: number, gridSize: number): number {
  return Math.floor(value / gridSize) * gridSize
}

function unitCenter(unit: PlacedFamilyUnit): number {
  return unit.rect.x + unit.rect.width / 2
}

function addDesiredCenter(
  desiredCenters: Map<string, number[]>,
  unitId: string,
  center: number,
) {
  const centers = desiredCenters.get(unitId) ?? []
  centers.push(center)
  desiredCenters.set(unitId, centers)
}
