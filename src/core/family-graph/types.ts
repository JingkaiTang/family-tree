import type { Member } from '@/core/schema'

export interface FamilyGraphDiagnostic {
  code: 'MISSING_REFERENCE'
  ids: string[]
  message: string
}

export interface PersonFact {
  id: string
  member: Member
}

export interface PartnershipFact {
  id: string
  partnerIds: string[]
  status: 'current' | 'historical'
}

export interface ParentageFact {
  id: string
  parentIds: string[]
  childIds: string[]
  typeByChildId: Record<string, 'blood' | 'adopted' | 'step'>
}

export interface FamilyFacts {
  people: PersonFact[]
  partnerships: PartnershipFact[]
  parentages: ParentageFact[]
}

export interface NormalizedFamilyFactsResult {
  facts: FamilyFacts
  diagnostics: FamilyGraphDiagnostic[]
}
