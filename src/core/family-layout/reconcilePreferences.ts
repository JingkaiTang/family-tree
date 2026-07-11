import type { FamilyData, PersistedLayoutPreferences } from '@/core/schema'
import { buildGridFamilyModel } from '@/core/layout/gridFamilyModel'
import { assignGenerations } from './assignGenerations'
import { buildFamilyUnits } from './buildFamilyUnits'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './types'

export function convertLegacyGridPreferences(data: FamilyData): PersistedLayoutPreferences {
  const { facts } = normalizeFacts(data)
  const projected = projectView(facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(
    projected,
    EMPTY_LAYOUT_PREFERENCES,
    DEFAULT_LAYOUT_METRICS,
  )
  const { generationByUnitId } = assignGenerations(projected, built)
  const legacySlots = new Map(
    buildGridFamilyModel(data).slots.map(slot => [slot.id, slot]),
  )
  const entriesByGeneration = new Map<number, Array<{
    unitId: string
    order: number
  }>>()

  for (const [slotId, override] of Object.entries(data.gridLayoutOverrides)) {
    if (!Number.isFinite(override.order)) continue
    const slot = legacySlots.get(slotId)
    if (!slot) continue
    const unitIds = [...new Set(
      slot.memberIds
        .map(memberId => built.unitIdByPersonId[memberId])
        .filter((unitId): unitId is string => unitId !== undefined),
    )]
    if (unitIds.length !== 1) continue
    const unitId = unitIds[0]
    const generation = generationByUnitId[unitId]
    if (generation === undefined) continue
    const entries = entriesByGeneration.get(generation) ?? []
    entries.push({ unitId, order: override.order })
    entriesByGeneration.set(generation, entries)
  }

  const rowOrders = [...entriesByGeneration]
    .sort(([left], [right]) => left - right)
    .map(([generation, entries]) => ({
      id: `row:v2:${generation}`,
      unitIds: [...new Map(
        entries
          .sort((left, right) => left.order - right.order || left.unitId.localeCompare(right.unitId))
          .map(entry => [entry.unitId, entry.unitId]),
      ).values()],
    }))

  return {
    rowOrders,
    familyAccentAssignments: {},
  }
}
