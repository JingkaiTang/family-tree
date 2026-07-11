import type {
  FamilyUnit,
  LayoutMetrics,
  LayoutPreferences,
  ParentageGroup,
  ProjectedFamily,
} from './types'

export interface BuiltFamilyUnits {
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  unitIdByPersonId: Record<string, string>
}

export const FAMILY_ACCENTS = [
  '#d6578b', '#5a78c9', '#2f9d7e', '#d48932',
  '#7c5ac7', '#4b9aaa', '#ba5f45', '#6f8f3d',
] as const

export function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function buildFamilyUnits(
  projected: ProjectedFamily,
  preferences: LayoutPreferences,
  metrics: LayoutMetrics,
): BuiltFamilyUnits {
  const unitIdByPersonId: Record<string, string> = {}
  const units: FamilyUnit[] = []
  const assignedPeople = new Set<string>()

  for (const partnership of [...projected.primaryPartnerships]
    .filter(value => value.status === 'current')
    .sort((a, b) => a.id.localeCompare(b.id))) {
    if (partnership.partnerIds.some(personId => assignedPeople.has(personId))) continue
    const memberIds = [...partnership.partnerIds].sort((a, b) => a.localeCompare(b))
    const unitId = `unit:${partnership.id}`
    units.push(createUnit(unitId, 'couple', memberIds, metrics))
    for (const personId of memberIds) {
      assignedPeople.add(personId)
      unitIdByPersonId[personId] = unitId
    }
  }

  for (const person of [...projected.people].sort((a, b) => a.id.localeCompare(b.id))) {
    if (assignedPeople.has(person.id)) continue
    const unitId = `unit:person:${person.id}`
    units.push(createUnit(unitId, 'single', [person.id], metrics))
    unitIdByPersonId[person.id] = unitId
  }

  const relatedUnitIds = buildRelatedUnitIds(projected, unitIdByPersonId)
  const accentByUnitId = new Map<string, string>()
  const unitsWithAccents = units.map(unit => {
    const persistedAccent = preferences.familyAccentAssignments[unit.id]
    const accent = persistedAccent ?? chooseAccent(unit.id, relatedUnitIds, accentByUnitId)
    accentByUnitId.set(unit.id, accent)
    return { ...unit, accent }
  })
  const memberById = new Map(projected.people.map(person => [person.id, person.member]))
  const parentageGroups = [...projected.primaryParentages]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap<ParentageGroup>(parentage => {
      const parentCountByUnitId = new Map<string, number>()
      for (const parentId of parentage.parentIds) {
        const unitId = unitIdByPersonId[parentId]
        if (unitId === undefined) continue
        parentCountByUnitId.set(unitId, (parentCountByUnitId.get(unitId) ?? 0) + 1)
      }
      const sourceUnitId = [...parentCountByUnitId]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      if (sourceUnitId === undefined) return []

      return [{
        id: parentage.id,
        sourceUnitId,
        childPersonIds: [...parentage.childIds].sort((a, b) => {
          const aBirthDate = memberById.get(a)?.birthDate
          const bBirthDate = memberById.get(b)?.birthDate
          if (aBirthDate && bBirthDate && aBirthDate !== bBirthDate) {
            return aBirthDate.localeCompare(bBirthDate)
          }
          if (aBirthDate && !bBirthDate) return -1
          if (!aBirthDate && bBirthDate) return 1
          return a.localeCompare(b)
        }),
      }]
    })

  return {
    units: unitsWithAccents,
    parentageGroups,
    unitIdByPersonId,
  }
}

function createUnit(
  id: string,
  kind: FamilyUnit['kind'],
  memberIds: string[],
  metrics: LayoutMetrics,
): FamilyUnit {
  return {
    id,
    kind,
    memberIds,
    generation: 0,
    width: kind === 'couple'
      ? metrics.cardWidth * 2 + metrics.spouseGap
      : metrics.cardWidth,
    lineageAffinity: {},
    accent: '',
  }
}

function buildRelatedUnitIds(
  projected: ProjectedFamily,
  unitIdByPersonId: Record<string, string>,
): Map<string, Set<string>> {
  const related = new Map<string, Set<string>>()
  const connect = (leftId: string, rightId: string) => {
    if (leftId === rightId) return
    const leftRelations = related.get(leftId) ?? new Set<string>()
    const rightRelations = related.get(rightId) ?? new Set<string>()
    leftRelations.add(rightId)
    rightRelations.add(leftId)
    related.set(leftId, leftRelations)
    related.set(rightId, rightRelations)
  }

  for (const parentage of projected.primaryParentages) {
    for (const parentId of parentage.parentIds) {
      const parentUnitId = unitIdByPersonId[parentId]
      if (parentUnitId === undefined) continue
      for (const childId of parentage.childIds) {
        const childUnitId = unitIdByPersonId[childId]
        if (childUnitId !== undefined) connect(parentUnitId, childUnitId)
      }
    }
  }

  return related
}

function chooseAccent(
  unitId: string,
  relatedUnitIds: Map<string, Set<string>>,
  accentByUnitId: Map<string, string>,
): string {
  const relatedAccents = new Set(
    [...(relatedUnitIds.get(unitId) ?? [])]
      .map(relatedUnitId => accentByUnitId.get(relatedUnitId))
      .filter((accent): accent is string => accent !== undefined),
  )
  const startIndex = stableHash(unitId) % FAMILY_ACCENTS.length
  for (let offset = 0; offset < FAMILY_ACCENTS.length; offset++) {
    const accent = FAMILY_ACCENTS[(startIndex + offset) % FAMILY_ACCENTS.length]
    if (!relatedAccents.has(accent)) return accent
  }
  return FAMILY_ACCENTS[startIndex]
}
