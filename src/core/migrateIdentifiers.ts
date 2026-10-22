import { normalizeFacts } from './family-graph/normalizeFacts'
import { assignGenerations } from './family-layout/assignGenerations'
import { buildFamilyUnits } from './family-layout/buildFamilyUnits'
import { buildRootDomains } from './family-layout/buildRootDomains'
import { discoverRootFamilies } from './family-layout/discoverRootFamilies'
import { projectView } from './family-layout/projectView'
import { propagateRootSignatures } from './family-layout/propagateRootSignatures'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  EMPTY_LAYOUT_PREFERENCES,
} from './family-layout/types'
import { compareIds, encodeIdTuple } from './idEncoding'
import type { FamilyData, RowOrderPreference } from './schema'
import { listSiblingOrderGroups } from './siblingOrder'

/** V4 keys were lossy joins. Only actual, uniquely recoverable aliases may be restored. */
export function migrateIdentifierPreferences(data: FamilyData, layoutAlreadyEncoded: boolean): FamilyData {
  const { facts } = normalizeFacts(data)
  const siblingAliases = new Aliases()
  for (const parentage of facts.parentages) {
    siblingAliases.add(`parentage:${parentage.parentIds.join('+')}`, parentage.id)
  }
  const knownIds = new Set(facts.people.map(person => person.id))
  // Pre-V5 collation ties retained the reference-array order. Recover those
  // spellings from the original facts without changing the member references.
  for (const person of facts.people) {
    for (const type of ['blood', 'adopted', 'step'] as const) {
      const parents = [...new Set(person.member.parents
        .filter(ref => ref.type === type && knownIds.has(ref.id) && ref.id !== person.id)
        .map(ref => ref.id))].sort((left, right) => left.localeCompare(right))
      if (parents.length > 0) {
        siblingAliases.add(`parentage:${parents.join('+')}`, `parentage:${encodeIdTuple(sortIds(parents))}`)
      }
    }
  }
  for (const group of listSiblingOrderGroups({ ...data, siblingOrders: {} })) {
    if (group.id.startsWith('siblings:')) {
      siblingAliases.add(`siblings:${sortIds(group.memberIds).join('+')}`, group.id)
    }
  }
  const siblingOrders = Object.fromEntries(Object.entries(data.siblingOrders).flatMap(([id, order]) => {
    const target = siblingAliases.resolve(id)
    if (target !== undefined) return [[target, order]]
    // Preserve the existing overlap-based reconciliation for stale groups, without
    // allowing an old percent-looking key to directly match a newly encoded group.
    return siblingAliases.has(id) ? [] : [[`legacy-sibling:${JSON.stringify(id)}`, order]]
  }))
  if (layoutAlreadyEncoded) return { ...data, siblingOrders }

  const projected = projectView(facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(projected, EMPTY_LAYOUT_PREFERENCES, DEFAULT_LAYOUT_METRICS)
  const { generationByUnitId } = assignGenerations(projected, built)
  const units = built.units.map(unit => ({ ...unit, generation: generationByUnitId[unit.id] ?? 0 }))
  const roots = discoverRootFamilies({ projected, units, generationByUnitId })
  const signatures = propagateRootSignatures({ projected, units, roots })
  const { domains } = buildRootDomains({
    projected, units, roots: roots.roots, signatures,
    accents: {}, preferences: EMPTY_LAYOUT_PREFERENCES,
  })

  const unitAliases = new Aliases()
  for (const person of facts.people) {
    unitAliases.add(`unit:person:${person.id}`, `unit:person:${person.id}`)
  }
  for (const unit of units) {
    if (unit.memberIds.length === 2) {
      unitAliases.add(`unit:partnership:current:${sortIds(unit.memberIds).join('+')}`, unit.id)
    }
  }
  // A saved couple order can still apply after separation. Resolve its old
  // spelling against real member IDs, rather than guessing where '+' belonged.
  const preferences = data.layoutPreferences
  const referencedUnits = new Set([
    ...Object.keys(preferences.familyAccentAssignments),
    ...[...preferences.rowOrders, ...preferences.bridgeOrders].flatMap(row => [
      ...row.unitIds, ...Object.keys(row.columns ?? {}),
    ]),
  ])
  for (const id of referencedUnits) addLegacyPairCandidates(id, 'unit:partnership:current:', knownIds, unitAliases)

  const rootAliases = new Aliases()
  for (const id of knownIds) rootAliases.add(`root:${id}`, `root:${encodeIdTuple([id])}`)
  for (const root of roots.roots) {
    const legacy = `root:${sortIds(root.seedPersonIds).join('+')}`
    rootAliases.add(legacy, root.id)
    if (root.seedPersonIds.length === 2 && root.seedPersonIds[0].localeCompare(root.seedPersonIds[1]) === 0) {
      rootAliases.add(`root:${[...root.seedPersonIds].reverse().join('+')}`, root.id)
    }
  }
  const referencedDomains = new Set([...preferences.rowOrders, ...preferences.bridgeOrders].map(row => row.domainId))
  const referencedRoots = new Set([
    ...rootAliases.sources(),
    ...preferences.rootOrders.flatMap(order => order.rootIds),
    ...Object.keys(preferences.rootAccentAssignments),
    ...[...referencedDomains].filter(id => id.startsWith('domain:root:')).map(id => id.slice('domain:'.length)),
  ])
  // Roots can also outlive a marriage. A known singleton and a separated pair
  // with the same old spelling are ambiguous even if only one is a root today.
  for (const id of referencedRoots) addLegacyPairCandidates(id, 'root:', knownIds, rootAliases)
  const domainAliases = new Aliases()
  const componentAliases = new Aliases()
  for (const domain of domains) {
    if (domain.kind === 'root') {
      for (const rootAlias of rootAliases.sources(domain.rootIds[0])) {
        if (rootAliases.resolve(rootAlias) === undefined) domainAliases.reject(`domain:${rootAlias}`)
        else domainAliases.add(`domain:${rootAlias}`, domain.id)
      }
    } else {
      const prefix = `domain:${domain.kind === 'pair-bridge' ? 'bridge' : 'island'}:`
      for (const legacy of referencedDomains) {
        if (!legacy.startsWith(prefix)) continue
        const match = matchLegacySignature(legacy.slice(prefix.length), domain.rootIds, rootAliases)
        if (match === null) domainAliases.reject(legacy)
        else if (match) domainAliases.add(legacy, domain.id)
      }
    }
    componentAliases.add(domain.componentId, domain.componentId)
    const minimumId = domain.componentId.slice('component:'.length)
    for (const memberId of domain.personIds) {
      if (memberId.localeCompare(minimumId) === 0) {
        componentAliases.add(`component:${memberId}`, domain.componentId)
      }
    }
  }
  const migrateRows = (rows: RowOrderPreference[]): RowOrderPreference[] => rows.flatMap(row => {
    const domainId = row.domainId === 'legacy' ? 'legacy' : domainAliases.resolve(row.domainId)
    if (domainId === undefined) return []
    return [{
      ...row,
      id: row.id === `row:${row.domainId}:${row.generation}` ? `row:${domainId}:${row.generation}` : row.id,
      domainId,
      unitIds: unitAliases.resolveList(row.unitIds),
      ...(row.columns ? { columns: unitAliases.resolveRecord(row.columns) } : {}),
    }]
  })

  return {
    ...data,
    siblingOrders,
    layoutPreferences: {
      rootOrders: preferences.rootOrders.map(order => ({
        componentId: componentAliases.resolve(order.componentId) ?? order.componentId,
        rootIds: rootAliases.resolveList(order.rootIds),
      })),
      rowOrders: migrateRows(preferences.rowOrders),
      bridgeOrders: migrateRows(preferences.bridgeOrders),
      rootAccentAssignments: rootAliases.resolveRecord(preferences.rootAccentAssignments),
      familyAccentAssignments: unitAliases.resolveRecord(preferences.familyAccentAssignments),
    },
  }
}

function addLegacyPairCandidates(id: string, prefix: string, knownIds: Set<string>, aliases: Aliases) {
  if (!id.startsWith(prefix)) return
  const suffix = id.slice(prefix.length)
  for (let index = suffix.indexOf('+'); index !== -1; index = suffix.indexOf('+', index + 1)) {
    const left = suffix.slice(0, index)
    const right = suffix.slice(index + 1)
    if (left === right || !knownIds.has(left) || !knownIds.has(right)) continue
    const pair = sortIds([left, right])
    if (left.localeCompare(right) <= 0) aliases.add(id, `${prefix}${encodeIdTuple(pair)}`)
  }
}

/** Match known root aliases against the saved bytes, including literal '|'. */
function matchLegacySignature(signature: string, rootIds: string[], aliases: Aliases): boolean | null {
  const options = rootIds.flatMap((rootId, index) => aliases.sources(rootId).map(source => ({
    source,
    bit: 1n << BigInt(index),
    ambiguous: aliases.resolve(source) === undefined,
  })))
  const fullMask = (1n << BigInt(rootIds.length)) - 1n
  const pending = [{ offset: 0, mask: 0n, previous: -1, ambiguous: false }]
  const visited = new Set<string>()
  let matched = false
  while (pending.length > 0) {
    const state = pending.pop()!
    if (state.mask === fullMask) {
      if (state.offset !== signature.length) continue
      if (state.ambiguous) return null
      matched = true
      continue
    }
    const key = `${state.offset}:${state.mask}:${state.previous}:${state.ambiguous}`
    if (visited.has(key)) continue
    visited.add(key)
    // Malformed legacy IDs can admit many segmentations. Do not guess after a
    // bounded search, or enumerate permutations of collation-equivalent roots.
    if (visited.size > 20_000) return null
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index]
      if ((state.mask & option.bit) !== 0n || !signature.startsWith(option.source, state.offset)) continue
      if (state.previous !== -1 && options[state.previous].source.localeCompare(option.source) > 0) continue
      const end = state.offset + option.source.length
      const mask = state.mask | option.bit
      if (mask === fullMask ? end !== signature.length : signature[end] !== '|') continue
      pending.push({
        offset: mask === fullMask ? end : end + 1,
        mask,
        previous: index,
        ambiguous: state.ambiguous || option.ambiguous,
      })
    }
  }
  return matched
}

class Aliases {
  private readonly targets = new Map<string, Set<string>>()
  private readonly rejected = new Set<string>()

  add(legacy: string, current: string) {
    const targets = this.targets.get(legacy) ?? new Set<string>()
    targets.add(current)
    this.targets.set(legacy, targets)
  }

  has(id: string): boolean { return this.targets.has(id) }

  reject(id: string) { this.rejected.add(id) }

  sources(target?: string): string[] {
    return [...this.targets].filter(([, targets]) => target === undefined || targets.has(target)).map(([source]) => source)
  }

  resolve(id: string): string | undefined {
    if (this.rejected.has(id)) return undefined
    const targets = this.targets.get(id)
    return targets?.size === 1 ? targets.values().next().value : undefined
  }

  resolveList(ids: string[]): string[] {
    return ids.flatMap(id => {
      const target = this.resolve(id)
      return target === undefined ? [] : [target]
    })
  }

  resolveRecord<T>(record: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(record).flatMap(([id, value]) => {
      const target = this.resolve(id)
      return target === undefined ? [] : [[target, value]]
    }))
  }
}

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareIds)
}
