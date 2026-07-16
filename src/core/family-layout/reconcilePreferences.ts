import type {
  BridgeOrderPreference,
  FamilyData,
  PersistedLayoutPreferences,
  RootOrderPreference,
  RowOrderPreference,
} from '@/core/schema'
import { assignGenerations } from './assignGenerations'
import { buildRootDomains } from './buildRootDomains'
import { buildFamilyUnits, type BuiltFamilyUnits } from './buildFamilyUnits'
import { discoverRootFamilies } from './discoverRootFamilies'
import { normalizeFacts } from './normalizeFacts'
import { projectView } from './projectView'
import { propagateRootSignatures } from './propagateRootSignatures'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
  type FamilyUnit,
  type RootFamily,
} from './types'

export function withRowOrderPreference(
  data: FamilyData,
  id: string,
  unitIds: string[],
): FamilyData {
  return withDomainRowOrderPreference(data, {
    id,
    domainId: 'legacy',
    generation: generationFromRowId(id),
    unitIds,
  })
}

export function withRootOrderPreference(
  data: FamilyData,
  componentId: string,
  rootIds: string[],
): FamilyData {
  const preference: RootOrderPreference = {
    componentId,
    rootIds: unique(rootIds),
  }
  const rootOrders = data.layoutPreferences.rootOrders
    .filter(value => value.componentId !== componentId)
    .map(cloneRootOrder)
  rootOrders.push(preference)
  rootOrders.sort((left, right) => left.componentId.localeCompare(right.componentId))
  return withPreferences(data, { rootOrders })
}

export function withDomainRowOrderPreference(
  data: FamilyData,
  preference: RowOrderPreference,
): FamilyData {
  const rowOrders = data.layoutPreferences.rowOrders
    .filter(value => value.id !== preference.id)
    .map(cloneRowOrder)
  rowOrders.push(cloneRowOrder({
    ...preference,
    unitIds: unique(preference.unitIds),
  }))
  return withPreferences(data, { rowOrders })
}

export function withBridgeOrderPreference(
  data: FamilyData,
  preference: BridgeOrderPreference,
): FamilyData {
  const bridgeOrders = data.layoutPreferences.bridgeOrders
    .filter(value => value.id !== preference.id)
    .map(cloneRowOrder)
  bridgeOrders.push(cloneRowOrder({
    ...preference,
    unitIds: unique(preference.unitIds),
  }))
  return withPreferences(data, { bridgeOrders })
}

export function withoutManualLayoutOrders(data: FamilyData): FamilyData {
  if (
    data.layoutPreferences.rootOrders.length === 0
    && data.layoutPreferences.rowOrders.length === 0
    && data.layoutPreferences.bridgeOrders.length === 0
  ) return data
  return withPreferences(data, {
    rootOrders: [],
    rowOrders: [],
    bridgeOrders: [],
  })
}

export function convertLegacyGridPreferences(data: FamilyData): PersistedLayoutPreferences {
  const state = buildCurrentLayoutState(data)
  const memberIdsByLegacySlotId = new Map<string, string[]>()
  const addAlias = (slotId: string, memberIds: string[]) => {
    if (!memberIdsByLegacySlotId.has(slotId)) memberIdsByLegacySlotId.set(slotId, memberIds)
  }
  for (const unit of state.built.units) {
    for (const memberId of unit.memberIds) {
      addAlias(`person:${memberId}`, [memberId])
      addAlias(`single-parent:${memberId}`, [memberId])
    }
    if (unit.memberIds.length === 2) {
      addAlias(`couple:${[...unit.memberIds].sort().join('+')}`, unit.memberIds)
    }
  }
  const entriesByGeneration = new Map<number, Array<{
    unitId: string
    order: number
    slotId: string
  }>>()

  for (const [slotId, override] of Object.entries(data.gridLayoutOverrides)) {
    const order = readLegacyOrder(override)
    if (order === null) continue
    const memberIds = memberIdsByLegacySlotId.get(slotId)
    if (!memberIds) continue
    const unitIds = unique(memberIds.flatMap(memberId => {
      const unitId = state.built.unitIdByPersonId[memberId]
      return unitId === undefined ? [] : [unitId]
    }))
    if (unitIds.length !== 1) continue
    const unitId = unitIds[0]
    const generation = state.generationByUnitId[unitId]
    if (generation === undefined) continue
    const entries = entriesByGeneration.get(generation) ?? []
    entries.push({ unitId, order, slotId })
    entriesByGeneration.set(generation, entries)
  }

  const rowOrders = [...entriesByGeneration]
    .sort(([left], [right]) => left - right)
    .map(([generation, entries]) => {
      const overrideByUnitId = new Map<string, { order: number; slotId: string }>()
      for (const entry of entries) {
        const current = overrideByUnitId.get(entry.unitId)
        if (
          current === undefined
          || entry.order < current.order
          || (entry.order === current.order && entry.slotId.localeCompare(current.slotId) < 0)
        ) overrideByUnitId.set(entry.unitId, { order: entry.order, slotId: entry.slotId })
      }
      const unitIds = [...(state.unitIdsByGeneration.get(generation) ?? [])]
        .sort((left, right) => (
          (overrideByUnitId.get(left)?.order ?? 0)
          - (overrideByUnitId.get(right)?.order ?? 0)
          || left.localeCompare(right)
        ))
      return scopeLegacyRow({
        id: `row:v2:${generation}`,
        domainId: 'legacy',
        generation,
        unitIds,
      }, state)
    })
    .filter((value): value is RowOrderPreference => value !== undefined)

  return {
    rootOrders: [],
    rowOrders,
    bridgeOrders: [],
    rootAccentAssignments: {},
    familyAccentAssignments: {},
  }
}

export function reconcileLayoutPreferences(data: FamilyData): PersistedLayoutPreferences {
  const state = buildCurrentLayoutState(data)
  const rowOrders = reconcileRowOrders(data.layoutPreferences.rowOrders, state, 'root')
  const bridgeOrders = reconcileRowOrders(
    data.layoutPreferences.bridgeOrders,
    state,
    'bridge',
  )
  const rootOrders = reconcileRootOrders(data.layoutPreferences.rootOrders, state.roots)
  const currentUnitIdSet = new Set(state.built.units.map(unit => unit.id))
  const currentRootIdSet = new Set(state.roots.map(root => root.id))
  const rootAccentAssignments = Object.fromEntries(
    Object.entries(data.layoutPreferences.rootAccentAssignments)
      .filter(([rootId]) => currentRootIdSet.has(rootId))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const familyAccentAssignments = Object.fromEntries(
    Object.entries(data.layoutPreferences.familyAccentAssignments)
      .filter(([unitId]) => currentUnitIdSet.has(unitId))
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  return {
    rootOrders,
    rowOrders,
    bridgeOrders,
    rootAccentAssignments,
    familyAccentAssignments,
  }
}

export function inheritedUnitPositions(
  persistedUnitIds: string[],
  currentUnits: FamilyUnit[],
): Map<string, number> {
  const directPositions = new Map<string, number>()
  const memberPositions = new Map<string, number>()
  persistedUnitIds.forEach((unitId, position) => {
    if (!directPositions.has(unitId)) directPositions.set(unitId, position)
    for (const memberId of persistedUnitMemberIds(unitId)) {
      if (!memberPositions.has(memberId)) memberPositions.set(memberId, position)
    }
  })
  return new Map(currentUnits.flatMap(unit => {
    const direct = directPositions.get(unit.id)
    if (direct !== undefined) return [[unit.id, direct]]
    const inherited = unit.memberIds
      .map(memberId => memberPositions.get(memberId))
      .filter((position): position is number => position !== undefined)
    return inherited.length === 0 ? [] : [[unit.id, Math.min(...inherited)]]
  }))
}

interface CurrentLayoutState {
  built: BuiltFamilyUnits
  generationByUnitId: Record<string, number>
  unitIdsByGeneration: Map<number, string[]>
  unitIdsByDomainGeneration: Map<string, string[]>
  domainIdByUnitId: Record<string, string>
  bridgeDomainIds: Set<string>
  roots: RootFamily[]
}

interface RowCandidate {
  preference: RowOrderPreference
  overlap: number
}

function reconcileRowOrders(
  preferences: RowOrderPreference[],
  state: CurrentLayoutState,
  kind: 'root' | 'bridge',
): RowOrderPreference[] {
  const candidates = preferences.flatMap<RowCandidate>(preference => {
    const scoped = preference.domainId === 'legacy'
      ? scopeLegacyRow(preference, state)
      : scopeDomainRow(preference, state)
    if (scoped === undefined) return []
    const isBridge = state.bridgeDomainIds.has(scoped.domainId)
    if ((kind === 'bridge') !== isBridge) return []
    const positions = inheritedUnitPositions(preference.unitIds, state.built.units)
    const overlap = scoped.unitIds.filter(unitId => positions.has(unitId)).length
    return overlap === 0 ? [] : [{ preference: scoped, overlap }]
  })
  const selectedByKey = new Map<string, RowCandidate>()
  for (const candidate of candidates) {
    const key = rowScopeKey(candidate.preference)
    const current = selectedByKey.get(key)
    if (
      current === undefined
      || candidate.overlap > current.overlap
      || (
        candidate.overlap === current.overlap
        && candidate.preference.id.localeCompare(current.preference.id) < 0
      )
    ) selectedByKey.set(key, candidate)
  }
  return [...selectedByKey.values()]
    .map(value => value.preference)
    .filter(preference => (
      preference.unitIds.length >= 2
      || Object.keys(preference.columns ?? {}).length > 0
    ))
    .sort(compareRowOrders)
}

function reconcileRootOrders(
  preferences: RootOrderPreference[],
  roots: RootFamily[],
): RootOrderPreference[] {
  const rootsByComponentId = new Map<string, string[]>()
  for (const root of roots) {
    const rootIds = rootsByComponentId.get(root.componentId) ?? []
    rootIds.push(root.id)
    rootsByComponentId.set(root.componentId, rootIds)
  }
  const result: RootOrderPreference[] = []
  for (const [componentId, currentRootIds] of [...rootsByComponentId]
    .sort(([left], [right]) => left.localeCompare(right))) {
    const currentSet = new Set(currentRootIds)
    const selected = preferences
      .filter(value => value.componentId === componentId)
      .map(value => ({
        value,
        overlap: unique(value.rootIds).filter(rootId => currentSet.has(rootId)).length,
      }))
      .filter(value => value.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)[0]
    if (selected === undefined) continue
    const persisted = unique(selected.value.rootIds).filter(rootId => currentSet.has(rootId))
    const missing = currentRootIds
      .filter(rootId => !persisted.includes(rootId))
      .sort((left, right) => left.localeCompare(right))
    const rootIds = [...persisted, ...missing]
    if (rootIds.length >= 2) result.push({ componentId, rootIds })
  }
  return result
}

function scopeLegacyRow(
  preference: RowOrderPreference,
  state: CurrentLayoutState,
): RowOrderPreference | undefined {
  const positions = inheritedUnitPositions(preference.unitIds, state.built.units)
  const generation = bestGeneration(preference.generation, positions, state)
  if (generation === undefined) return undefined
  const overlappingUnitIds = (state.unitIdsByGeneration.get(generation) ?? [])
    .filter(unitId => positions.has(unitId))
  if (overlappingUnitIds.length === 0) return undefined
  const domainIds = unique(overlappingUnitIds.map(unitId => state.domainIdByUnitId[unitId]))
  const domainId = domainIds.length === 1 ? domainIds[0] : 'legacy'
  const candidates = domainId === 'legacy'
    ? state.unitIdsByGeneration.get(generation) ?? []
    : state.unitIdsByDomainGeneration.get(domainGenerationKey(domainId, generation)) ?? []
  return {
    id: preference.id,
    domainId,
    generation,
    unitIds: sortByPersistedPositions(candidates, positions),
  }
}

function scopeDomainRow(
  preference: RowOrderPreference,
  state: CurrentLayoutState,
): RowOrderPreference | undefined {
  const candidates = state.unitIdsByDomainGeneration.get(
    domainGenerationKey(preference.domainId, preference.generation),
  )
  if (candidates === undefined) return undefined
  const positions = inheritedUnitPositions(preference.unitIds, state.built.units)
  if (!candidates.some(unitId => positions.has(unitId))) return undefined
  const columns = Object.fromEntries(
    Object.entries(preference.columns ?? {})
      .filter(([unitId]) => candidates.includes(unitId)),
  )
  return {
    id: preference.id,
    domainId: preference.domainId,
    generation: preference.generation,
    unitIds: sortByPersistedPositions(candidates, positions),
    ...(Object.keys(columns).length > 0 ? { columns } : {}),
  }
}

function buildCurrentLayoutState(data: FamilyData): CurrentLayoutState {
  const { facts } = normalizeFacts(data)
  const projected = projectView(facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(projected, EMPTY_LAYOUT_PREFERENCES, DEFAULT_LAYOUT_METRICS)
  const { generationByUnitId } = assignGenerations(projected, built)
  const units = built.units.map(unit => ({
    ...unit,
    generation: generationByUnitId[unit.id] ?? 0,
  }))
  const roots = discoverRootFamilies({
    projected,
    units,
    generationByUnitId,
  })
  const signatures = propagateRootSignatures({ projected, units, roots })
  const domains = buildRootDomains({
    projected,
    units,
    roots: roots.roots,
    signatures,
    accents: {},
    preferences: EMPTY_LAYOUT_PREFERENCES,
  })
  const domainIdByUnitId = domains.domainIdByUnitId
  const bridgeDomainIds = new Set(
    domains.domains
      .filter(domain => domain.kind !== 'root')
      .map(domain => domain.id),
  )
  const unitIdsByGeneration = new Map<number, string[]>()
  const unitIdsByDomainGeneration = new Map<string, string[]>()
  for (const unit of units) {
    const generation = generationByUnitId[unit.id]
    if (generation === undefined) continue
    addSorted(unitIdsByGeneration, generation, unit.id)
    addSorted(
      unitIdsByDomainGeneration,
      domainGenerationKey(domainIdByUnitId[unit.id], generation),
      unit.id,
    )
  }
  return {
    built,
    generationByUnitId,
    unitIdsByGeneration,
    unitIdsByDomainGeneration,
    domainIdByUnitId,
    bridgeDomainIds,
    roots: roots.roots,
  }
}

function bestGeneration(
  preferredGeneration: number,
  positions: ReadonlyMap<string, number>,
  state: CurrentLayoutState,
): number | undefined {
  const preferredIds = state.unitIdsByGeneration.get(preferredGeneration) ?? []
  if (preferredIds.some(unitId => positions.has(unitId))) return preferredGeneration
  return [...state.unitIdsByGeneration]
    .map(([generation, unitIds]) => ({
      generation,
      overlap: unitIds.filter(unitId => positions.has(unitId)).length,
    }))
    .filter(value => value.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.generation - right.generation)[0]
    ?.generation
}

function sortByPersistedPositions(
  unitIds: string[],
  positions: ReadonlyMap<string, number>,
): string[] {
  return [...unitIds].sort((left, right) => (
    (positions.get(left) ?? Number.POSITIVE_INFINITY)
    - (positions.get(right) ?? Number.POSITIVE_INFINITY)
    || left.localeCompare(right)
  ))
}

function persistedUnitMemberIds(unitId: string): string[] {
  const personPrefix = 'unit:person:'
  if (unitId.startsWith(personPrefix)) return [unitId.slice(personPrefix.length)]
  const currentPartnershipPrefix = 'unit:partnership:current:'
  if (unitId.startsWith(currentPartnershipPrefix)) {
    return unitId.slice(currentPartnershipPrefix.length).split('+')
  }
  return []
}

function withPreferences(
  data: FamilyData,
  patch: Partial<PersistedLayoutPreferences>,
): FamilyData {
  return {
    ...data,
    layoutPreferences: {
      ...data.layoutPreferences,
      ...patch,
    },
  }
}

function cloneRootOrder(value: RootOrderPreference): RootOrderPreference {
  return { componentId: value.componentId, rootIds: [...value.rootIds] }
}

function cloneRowOrder(value: RowOrderPreference): RowOrderPreference {
  return {
    ...value,
    unitIds: [...value.unitIds],
    ...(value.columns ? { columns: { ...value.columns } } : {}),
  }
}

function compareRowOrders(left: RowOrderPreference, right: RowOrderPreference): number {
  return left.generation - right.generation
    || left.domainId.localeCompare(right.domainId)
    || left.id.localeCompare(right.id)
}

function rowScopeKey(value: RowOrderPreference): string {
  return domainGenerationKey(value.domainId, value.generation)
}

function domainGenerationKey(domainId: string, generation: number): string {
  return `${domainId}\0${generation}`
}

function generationFromRowId(rowId: string): number {
  const match = rowId.match(/(-?\d+)$/)
  if (match === null) return 0
  const generation = Number(match[1])
  return Number.isInteger(generation) ? generation : 0
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function addSorted<K>(map: Map<K, string[]>, key: K, value: string) {
  const values = map.get(key) ?? []
  values.push(value)
  values.sort((left, right) => left.localeCompare(right))
  map.set(key, values)
}

function readLegacyOrder(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null
  const order = Reflect.get(value, 'order')
  return typeof order === 'number' && Number.isFinite(order) ? order : null
}
