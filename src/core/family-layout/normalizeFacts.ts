import type { FamilyData } from '@/core/schema'
import type { NormalizedFactsResult, ParentageFact, PartnershipFact } from './types'

const TYPE_PRIORITY = { blood: 0, adopted: 1, step: 2 } as const

export function normalizeFacts(data: FamilyData): NormalizedFactsResult {
  const diagnostics: NormalizedFactsResult['diagnostics'] = []
  const people = Object.values(data.members)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(member => ({ id: member.id, member }))
  const knownIds = new Set(people.map(person => person.id))
  const partnershipById = new Map<string, PartnershipFact>()

  for (const person of people) {
    for (const spouse of person.member.spouses) {
      if (!knownIds.has(spouse.id)) {
        diagnostics.push({
          code: 'MISSING_REFERENCE',
          ids: [person.id, spouse.id],
          message: `${person.id} references missing member ${spouse.id}`,
        })
        continue
      }
      if (spouse.id === person.id) continue
      const partnerIds = [person.id, spouse.id].sort((a, b) => a.localeCompare(b))
      const status = spouse.type === 'married' ? 'current' : 'historical'
      const id = `partnership:${status}:${partnerIds.join('+')}`
      partnershipById.set(id, { id, partnerIds, status })
    }
  }

  const parentageById = new Map<string, ParentageFact>()
  for (const child of people) {
    const validParents = child.member.parents
      .filter(parent => {
        if (knownIds.has(parent.id)) return parent.id !== child.id
        diagnostics.push({
          code: 'MISSING_REFERENCE',
          ids: [child.id, parent.id],
          message: `${child.id} references missing member ${parent.id}`,
        })
        return false
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    const parentIds = [...new Set(validParents.map(parent => parent.id))]
    if (parentIds.length === 0) continue
    const id = `parentage:${parentIds.join('+')}`
    const existing = parentageById.get(id) ?? {
      id,
      parentIds,
      childIds: [],
      typeByChildId: {},
    }
    existing.childIds.push(child.id)
    existing.typeByChildId[child.id] = [...validParents]
      .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])[0].type
    parentageById.set(id, existing)
  }

  const parentages = [...parentageById.values()].map(parentage => ({
    ...parentage,
    childIds: [...new Set(parentage.childIds)].sort((a, b) => a.localeCompare(b)),
  })).sort((a, b) => a.id.localeCompare(b.id))

  return {
    facts: {
      people,
      partnerships: [...partnershipById.values()].sort((a, b) => a.id.localeCompare(b.id)),
      parentages,
    },
    diagnostics: diagnostics.sort((a, b) => a.message.localeCompare(b.message)),
  }
}
