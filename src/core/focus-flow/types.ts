import type { FamilyGraphDiagnostic } from '@/core/family-graph/types'

export type FocusFlowSectionKind =
  | 'parents'
  | 'focus'
  | 'siblings'
  | 'children'
  | 'ancestors'
  | 'descendants'
  | 'historical'
  | 'godparents'
  | 'godchildren'

export interface FocusFlowBlock {
  id: string
  kind: 'single' | 'couple' | 'members'
  memberIds: string[]
  label?: string
  relation: FocusFlowSectionKind
  parentageType?: 'blood' | 'adopted' | 'step'
}

export interface FocusFlowSection {
  id: string
  kind: FocusFlowSectionKind
  title: string
  blocks: FocusFlowBlock[]
  branch?: {
    id: string
    totalCount: number
    visibleCount: number
    expanded: boolean
  }
}

export interface FocusFlowBranchSummary {
  id: string
  kind: FocusFlowSectionKind
  label: string
  count: number
  expanded: boolean
  lockedOpen?: boolean
}

export interface FocusFlowScene {
  kind: 'focus-flow'
  focusId: string | null
  sections: FocusFlowSection[]
  branches: FocusFlowBranchSummary[]
  diagnostics: FamilyGraphDiagnostic[]
}
