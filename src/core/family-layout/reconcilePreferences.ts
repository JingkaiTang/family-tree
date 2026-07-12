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
  const { built, generationByUnitId, unitIdsByGeneration } = buildCurrentLayoutState(data)
  const legacySlots = new Map(
    buildGridFamilyModel(data).slots.map(slot => [slot.id, slot]),
  )
  const entriesByGeneration = new Map<number, Array<{
    unitId: string
    order: number
  }>>()

  for (const [slotId, override] of Object.entries(data.gridLayoutOverrides)) {
    const order = readLegacyOrder(override)
    if (order === null) continue
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
    entries.push({ unitId, order })
    entriesByGeneration.set(generation, entries)
  }

  const rowOrders = [...entriesByGeneration]
    .sort(([left], [right]) => left - right)
    .map(([generation, entries]) => {
      const orderedUnitIds = [...new Set(
        entries
          .sort((left, right) => left.order - right.order || left.unitId.localeCompare(right.unitId))
          .map(entry => entry.unitId),
      )]
      const orderedUnitIdSet = new Set(orderedUnitIds)
      const remainingUnitIds = [...(unitIdsByGeneration.get(generation) ?? [])]
        .filter(unitId => !orderedUnitIdSet.has(unitId))
        .sort((left, right) => left.localeCompare(right))
      return {
        id: `row:v2:${generation}`,
        unitIds: [...orderedUnitIds, ...remainingUnitIds],
      }
    })

  return {
    rowOrders,
    familyAccentAssignments: {},
  }
}

export function reconcileLayoutPreferences(data: FamilyData): PersistedLayoutPreferences {
  const { built, unitIdsByGeneration } = buildCurrentLayoutState(data)
  const candidatesByGeneration = new Map<number, Array<{
    preference: PersistedLayoutPreferences['rowOrders'][number]
    overlap: number
  }>>()

  for (const preference of data.layoutPreferences.rowOrders) {
    const uniquePreferenceUnitIds = new Set(preference.unitIds)
    const bestGeneration = [...unitIdsByGeneration]
      .map(([generation, unitIds]) => ({
        generation,
        overlap: unitIds.filter(unitId => uniquePreferenceUnitIds.has(unitId)).length,
      }))
      .filter(candidate => candidate.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap || left.generation - right.generation)[0]
    if (!bestGeneration) continue
    const candidates = candidatesByGeneration.get(bestGeneration.generation) ?? []
    candidates.push({ preference, overlap: bestGeneration.overlap })
    candidatesByGeneration.set(bestGeneration.generation, candidates)
  }

  const rowOrders = [...candidatesByGeneration]
    .sort(([left], [right]) => left - right)
    .flatMap(([generation, candidates]) => {
      const selected = candidates.sort((left, right) => (
        right.overlap - left.overlap
        || left.preference.id.localeCompare(right.preference.id)
      ))[0]
      if (!selected) return []
      const currentUnitIds = unitIdsByGeneration.get(generation) ?? []
      const currentUnitIdSet = new Set(currentUnitIds)
      const savedUnitIds = [...new Set(
        selected.preference.unitIds.filter(unitId => currentUnitIdSet.has(unitId)),
      )]
      const savedUnitIdSet = new Set(savedUnitIds)
      return [{
        id: selected.preference.id,
        unitIds: [
          ...savedUnitIds,
          ...currentUnitIds.filter(unitId => !savedUnitIdSet.has(unitId)),
        ],
      }]
    })
  const currentUnitIdSet = new Set(built.units.map(unit => unit.id))
  const familyAccentAssignments = Object.fromEntries(
    Object.entries(data.layoutPreferences.familyAccentAssignments)
      .filter(([unitId]) => currentUnitIdSet.has(unitId))
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  return { rowOrders, familyAccentAssignments }
}

function buildCurrentLayoutState(data: FamilyData) {
  const { facts } = normalizeFacts(data)
  const projected = projectView(facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(
    projected,
    EMPTY_LAYOUT_PREFERENCES,
    DEFAULT_LAYOUT_METRICS,
  )
  const { generationByUnitId } = assignGenerations(projected, built)
  const unitIdsByGeneration = new Map<number, string[]>()
  for (const unit of built.units) {
    const generation = generationByUnitId[unit.id]
    if (generation === undefined) continue
    const unitIds = unitIdsByGeneration.get(generation) ?? []
    unitIds.push(unit.id)
    unitIdsByGeneration.set(generation, unitIds)
  }
  for (const unitIds of unitIdsByGeneration.values()) {
    unitIds.sort((left, right) => left.localeCompare(right))
  }
  return { built, generationByUnitId, unitIdsByGeneration }
}

function readLegacyOrder(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null
  const order = Reflect.get(value, 'order')
  return typeof order === 'number' && Number.isFinite(order) ? order : null
}
