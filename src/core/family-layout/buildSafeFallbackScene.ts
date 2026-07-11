import { compactGrid } from './compactGrid'
import type {
  FamilyUnit,
  LayoutDiagnostic,
  LayoutMetrics,
  LayoutScene,
  OrderedGeneration,
  ParentageGroup,
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
  const geometry = compactGrid({ units, rows, parentageGroups, metrics })
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

function compareDiagnostics(left: LayoutDiagnostic, right: LayoutDiagnostic): number {
  return left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
}
