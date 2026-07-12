import type {
  AuxiliaryRelation,
  FamilyFacts,
  FamilyViewPolicy,
  LayoutDiagnostic,
  ParentageFact,
  ProjectedFamily,
} from './types'

const PARENTAGE_TYPE_PRIORITY = { blood: 0, adopted: 1, step: 2 } as const

export function projectView(facts: FamilyFacts, view: FamilyViewPolicy): ProjectedFamily {
  const diagnostics: LayoutDiagnostic[] = []
  const selectedPartnershipIds = new Set<string>()
  const assignedPeople = new Set<string>()
  const currentPartnerships = facts.partnerships
    .filter(value => value.status === 'current')
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const partnership of currentPartnerships) {
    const explicitlySelected = partnership.partnerIds.every(
      personId => view.primaryPartnershipByPerson[personId] === partnership.id,
    )
    if (!explicitlySelected) continue
    selectedPartnershipIds.add(partnership.id)
    partnership.partnerIds.forEach(personId => assignedPeople.add(personId))
  }

  for (const partnership of currentPartnerships) {
    if (selectedPartnershipIds.has(partnership.id)) continue
    if (partnership.partnerIds.some(personId => assignedPeople.has(personId))) continue
    selectedPartnershipIds.add(partnership.id)
    partnership.partnerIds.forEach(personId => assignedPeople.add(personId))
  }

  for (const [personId, partnershipId] of Object.entries(view.primaryPartnershipByPerson)) {
    if (selectedPartnershipIds.has(partnershipId)) continue
    diagnostics.push({
      code: 'INVALID_PRIMARY_PARTNERSHIP',
      ids: [personId, partnershipId],
      message: `Invalid primary partnership ${partnershipId} for ${personId}`,
    })
  }

  const primaryPartnerships = facts.partnerships
    .filter(value => selectedPartnershipIds.has(value.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  const parentagesByChildId = new Map<string, ParentageFact[]>()

  for (const parentage of facts.parentages) {
    for (const childId of parentage.childIds) {
      const list = parentagesByChildId.get(childId) ?? []
      list.push(parentage)
      parentagesByChildId.set(childId, list)
    }
  }

  const selectedParentageIdByChild = new Map<string, string>()
  for (const [childId, parentages] of parentagesByChildId) {
    parentages.sort((a, b) => compareParentagesForChild(childId, a, b))
    const explicit = view.primaryParentageByChild[childId]
    const selected = parentages.find(value => value.id === explicit) ?? parentages[0]
    selectedParentageIdByChild.set(childId, selected.id)
    if (explicit !== undefined && explicit !== selected.id) {
      diagnostics.push({
        code: 'INVALID_PRIMARY_PARENTAGE',
        ids: [childId, explicit],
        message: `Invalid primary parentage ${explicit} for ${childId}`,
      })
    }
  }

  const primaryParentages = facts.parentages
    .map(parentage => ({
      ...parentage,
      childIds: parentage.childIds.filter(
        childId => selectedParentageIdByChild.get(childId) === parentage.id,
      ),
    }))
    .filter(parentage => parentage.childIds.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
  const auxiliaryRelations: AuxiliaryRelation[] = []

  if (view.showHistoricalPartnerships) {
    for (const partnership of facts.partnerships.filter(value => value.status === 'historical')) {
      auxiliaryRelations.push({
        id: `aux:${partnership.id}`,
        kind: 'historical-partnership',
        sourceId: partnership.partnerIds[0],
        targetId: partnership.partnerIds[1],
      })
    }
    for (const partnership of currentPartnerships.filter(
      value => !selectedPartnershipIds.has(value.id),
    )) {
      auxiliaryRelations.push({
        id: `aux:secondary:${partnership.id}`,
        kind: 'secondary-partnership',
        sourceId: partnership.partnerIds[0],
        targetId: partnership.partnerIds[1],
      })
    }
  }

  if (view.showSecondaryParentage) {
    for (const parentage of facts.parentages) {
      for (const childId of parentage.childIds) {
        if (selectedParentageIdByChild.get(childId) === parentage.id) continue
        for (const parentId of parentage.parentIds) {
          auxiliaryRelations.push({
            id: `aux:${parentage.id}:${parentId}:${childId}`,
            kind: 'secondary-parentage',
            sourceId: parentId,
            targetId: childId,
          })
        }
      }
    }
  }

  if (view.showGodparentRelations) {
    const knownIds = new Set(facts.people.map(person => person.id))
    for (const person of facts.people) {
      for (const godparent of person.member.godparents) {
        if (!knownIds.has(godparent.id)) continue
        auxiliaryRelations.push({
          id: `aux:godparent:${godparent.id}>${person.id}`,
          kind: 'godparent',
          sourceId: godparent.id,
          targetId: person.id,
        })
      }
    }
  }

  return {
    people: [...facts.people].sort((a, b) => a.id.localeCompare(b.id)),
    primaryPartnerships,
    primaryParentages,
    auxiliaryRelations: [
      ...new Map(auxiliaryRelations.map(value => [value.id, value])).values(),
    ].sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: diagnostics.sort((a, b) => a.message.localeCompare(b.message)),
  }
}

function compareParentagesForChild(
  childId: string,
  left: ParentageFact,
  right: ParentageFact,
): number {
  return PARENTAGE_TYPE_PRIORITY[left.typeByChildId[childId]]
    - PARENTAGE_TYPE_PRIORITY[right.typeByChildId[childId]]
    || right.parentIds.length - left.parentIds.length
    || left.id.localeCompare(right.id)
}
