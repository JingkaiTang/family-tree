import {
  familyUnitWidth,
  materializeSceneGeometry,
} from './materializeSceneGeometry'
import type {
  FamilyUnit,
  LayoutDiagnostic,
  LayoutMetrics,
  LayoutScene,
  OrderedGeneration,
  ParentageGroup,
  PlacedFamilyUnit,
} from './types'

export function buildSafeFallbackScene(
  units: FamilyUnit[],
  parentageGroups: ParentageGroup[],
  metrics: LayoutMetrics,
  diagnostics: LayoutDiagnostic[],
): LayoutScene {
  const unitsByGeneration = new Map<number, string[]>()
  for (const unit of units) {
    const generationUnits = unitsByGeneration.get(unit.generation) ?? []
    generationUnits.push(unit.id)
    unitsByGeneration.set(unit.generation, generationUnits)
  }
  const rows: OrderedGeneration[] = [...unitsByGeneration]
    .sort(([left], [right]) => left - right)
    .map(([generation, unitIds]) => ({
      generation,
      unitIds: [...unitIds].sort((left, right) => left.localeCompare(right)),
    }))
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const firstGeneration = rows[0]?.generation ?? 0
  const placedUnits: PlacedFamilyUnit[] = rows.flatMap(row => {
    let nextLeft = 0
    return row.unitIds.flatMap((unitId, order) => {
      const unit = unitById.get(unitId)
      if (unit === undefined) return []
      const x = snapUp(nextLeft, metrics.gridSize)
      const placedUnit: PlacedFamilyUnit = {
        ...unit,
        rect: {
          x,
          y: (row.generation - firstGeneration)
            * (metrics.cardHeight + metrics.generationGap),
          width: familyUnitWidth(unit, metrics),
          height: metrics.cardHeight,
        },
        order,
      }
      nextLeft = x + placedUnit.rect.width + metrics.familyGap
      return [placedUnit]
    })
  })
  const geometry = materializeSceneGeometry({
    placedUnits,
    rows,
    parentageGroups,
    metrics,
  })
  const fallbackDiagnostics: LayoutDiagnostic[] = [...diagnostics]
  const alreadyUnroutableOwnerIds = new Set(
    diagnostics
      .filter(value => (
        value.code === 'UNROUTABLE_PRIMARY_EDGE' && value.ids.length === 1
      ))
      .map(value => value.ids[0]),
  )

  for (const group of [...parentageGroups].sort((left, right) => (
    left.id.localeCompare(right.id)
  ))) {
    if (alreadyUnroutableOwnerIds.has(group.id)) continue
    fallbackDiagnostics.push({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: [group.id],
      message: `Primary family edge ${group.id} omitted from safe fallback`,
    })
  }
  fallbackDiagnostics.sort(compareDiagnostics)

  return {
    ...geometry,
    routes: [],
    diagnostics: fallbackDiagnostics,
  }
}

function snapUp(value: number, gridSize: number): number {
  return Math.ceil(value / gridSize) * gridSize
}

function compareDiagnostics(left: LayoutDiagnostic, right: LayoutDiagnostic): number {
  return left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
}
