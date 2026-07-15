import { stableHash } from './buildFamilyUnits'
import type {
  DecorateRootedUnitsInput,
  RootedFamilyUnit,
} from './types'

export function decorateRootedUnits(
  input: DecorateRootedUnitsInput,
): RootedFamilyUnit[] {
  const rootPositionById = new Map(
    input.domains.rootOrder.map((rootId, index) => [rootId, index]),
  )
  const rootUnitIds = new Set(input.roots.map(root => root.rootUnitId))

  return [...input.baseUnits]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(unit => {
      const rootSignature = input.signatures.signatureByUnitId[unit.id] ?? []
      const spatialRootIds = [...rootSignature].sort((left, right) => (
        (rootPositionById.get(left) ?? Number.POSITIVE_INFINITY)
        - (rootPositionById.get(right) ?? Number.POSITIVE_INFINITY)
        || left.localeCompare(right)
      ))
      const memberRootIds = Object.fromEntries(
        unit.memberIds.flatMap(personId => {
          const rootId = input.signatures.sourceRootIdByPersonId[personId]
          return rootId === undefined ? [] : [[personId, rootId]]
        }),
      )
      const memberIds = rootSignature.length > 1
        ? [...unit.memberIds].sort((left, right) => {
            const leftRootId = memberRootIds[left]
            const rightRootId = memberRootIds[right]
            const leftPosition = leftRootId === undefined
              ? Number.POSITIVE_INFINITY
              : rootPositionById.get(leftRootId) ?? Number.POSITIVE_INFINITY
            const rightPosition = rightRootId === undefined
              ? Number.POSITIVE_INFINITY
              : rootPositionById.get(rightRootId) ?? Number.POSITIVE_INFINITY
            return leftPosition - rightPosition || left.localeCompare(right)
          })
        : [...unit.memberIds]
      const rootAccent = input.accents[spatialRootIds[0]] ?? unit.accent

      return {
        ...unit,
        memberIds,
        rootSignature: [...rootSignature],
        domainId: input.domains.domainIdByUnitId[unit.id] ?? '',
        memberRootIds,
        rootAccent,
        isRootFamily: rootSignature.length === 1 && rootUnitIds.has(unit.id),
        accent: input.preferences.familyAccentAssignments[unit.id]
          ?? deriveFamilyAccent(rootAccent, unit.id),
      }
    })
}

function deriveFamilyAccent(rootAccent: string, unitId: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(rootAccent)
  if (match === null) return rootAccent
  const value = Number.parseInt(match[1], 16)
  const adjustment = (stableHash(unitId) % 37) - 18
  const channels = [value >> 16, value >> 8 & 0xff, value & 0xff]
    .map(channel => Math.max(0, Math.min(255, channel + adjustment)))
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}
