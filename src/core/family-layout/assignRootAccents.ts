import { stableHash } from './buildFamilyUnits'
import type {
  AssignRootAccentsInput,
  RootAccentDomainSnapshot,
  RootFamily,
} from './types'

export const ROOT_ACCENT_PALETTE = [
  '#4F7CAC', '#B56576', '#4C956C', '#C17C3A', '#7A6FAE',
  '#2A9D8F', '#9C6644', '#6D597A', '#3D7188', '#A26769',
] as const

const PREVIOUS_ROOT_MATCH_THRESHOLD = 0.5

interface PreviousRootMatch {
  rootId: string
  domain: RootAccentDomainSnapshot
  similarity: number
  seedContainment: number
}

export function assignRootAccents(
  input: AssignRootAccentsInput,
): Record<string, string> {
  const roots = [...input.roots].sort(compareRoots)
  const adjacentRootIds = buildRootAdjacency(
    roots.map(root => root.id),
    input.signatures.signatureByUnitId,
  )
  const previousDomainByRootId = matchPreviousDomains(input)
  const accentByRootId: Record<string, string> = {}

  for (const root of roots) {
    const unavailableAccents = new Set(
      [...(adjacentRootIds.get(root.id) ?? [])]
        .map(rootId => accentByRootId[rootId])
        .filter((accent): accent is string => accent !== undefined),
    )
    const preferredAccent = input.preferences.rootAccentAssignments[root.id]
      ?? previousDomainByRootId.get(root.id)?.accent
    if (preferredAccent !== undefined && !unavailableAccents.has(preferredAccent)) {
      accentByRootId[root.id] = preferredAccent
      continue
    }
    accentByRootId[root.id] = chooseStableAccent(root.id, unavailableAccents)
  }

  return accentByRootId
}

function compareRoots(left: RootFamily, right: RootFamily): number {
  return left.componentId.localeCompare(right.componentId)
    || left.generation - right.generation
    || left.id.localeCompare(right.id)
}

function buildRootAdjacency(
  rootIds: string[],
  signatureByUnitId: Record<string, string[]>,
): Map<string, Set<string>> {
  const knownRootIds = new Set(rootIds)
  const adjacentRootIds = new Map(
    rootIds.map(rootId => [rootId, new Set<string>()]),
  )

  for (const signature of Object.values(signatureByUnitId)) {
    const connectedRootIds = [...new Set(signature)]
      .filter(rootId => knownRootIds.has(rootId))
      .sort((left, right) => left.localeCompare(right))
    for (let leftIndex = 0; leftIndex < connectedRootIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < connectedRootIds.length;
        rightIndex += 1
      ) {
        const leftId = connectedRootIds[leftIndex]
        const rightId = connectedRootIds[rightIndex]
        adjacentRootIds.get(leftId)?.add(rightId)
        adjacentRootIds.get(rightId)?.add(leftId)
      }
    }
  }

  return adjacentRootIds
}

function matchPreviousDomains(
  input: AssignRootAccentsInput,
): Map<string, RootAccentDomainSnapshot> {
  const previousDomains = [...(input.previousScene?.rootDomains ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
  if (previousDomains.length === 0) return new Map()

  const domainByRootId = new Map<string, RootAccentDomainSnapshot>()
  const usedDomainIds = new Set<string>()
  for (const root of [...input.roots].sort(compareRoots)) {
    const previousRootId = input.previousRootIdByRootId?.[root.id]
    const domain = previousRootId === undefined
      ? undefined
      : previousDomains.find(value => value.rootIds.includes(previousRootId))
    if (domain === undefined || usedDomainIds.has(domain.id)) continue
    domainByRootId.set(root.id, domain)
    usedDomainIds.add(domain.id)
  }

  const matches: PreviousRootMatch[] = []
  for (const root of [...input.roots].sort(compareRoots)) {
    if (domainByRootId.has(root.id)) continue
    const currentPersonIds = new Set(
      Object.entries(input.signatures.signatureByPersonId)
        .filter(([, signature]) => signature.includes(root.id))
        .map(([personId]) => personId),
    )
    for (const domain of previousDomains) {
      const similarity = jaccardSimilarity(currentPersonIds, domain.personIds)
      if (similarity < PREVIOUS_ROOT_MATCH_THRESHOLD) continue
      const previousPersonIds = new Set(domain.personIds)
      const seedContainment = root.seedPersonIds.filter(personId => (
        previousPersonIds.has(personId)
      )).length
      matches.push({
        rootId: root.id,
        domain,
        similarity,
        seedContainment,
      })
    }
  }

  matches.sort((left, right) => (
    right.similarity - left.similarity
    || right.seedContainment - left.seedContainment
    || left.rootId.localeCompare(right.rootId)
    || left.domain.id.localeCompare(right.domain.id)
  ))

  for (const match of matches) {
    if (domainByRootId.has(match.rootId) || usedDomainIds.has(match.domain.id)) continue
    domainByRootId.set(match.rootId, match.domain)
    usedDomainIds.add(match.domain.id)
  }
  return domainByRootId
}

function jaccardSimilarity(
  currentPersonIds: ReadonlySet<string>,
  previousPersonIds: string[],
): number {
  const previous = new Set(previousPersonIds)
  const intersectionSize = [...currentPersonIds]
    .filter(personId => previous.has(personId)).length
  const unionSize = new Set([...currentPersonIds, ...previous]).size
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

function chooseStableAccent(
  rootId: string,
  unavailableAccents: ReadonlySet<string>,
): string {
  const startIndex = stableHash(rootId) % ROOT_ACCENT_PALETTE.length
  for (let offset = 0; offset < ROOT_ACCENT_PALETTE.length; offset += 1) {
    const accent = ROOT_ACCENT_PALETTE[
      (startIndex + offset) % ROOT_ACCENT_PALETTE.length
    ]
    if (!unavailableAccents.has(accent)) return accent
  }
  return ROOT_ACCENT_PALETTE[startIndex]
}
