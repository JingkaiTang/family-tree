import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { layoutFamilyScene } from './family-layout/layoutFamilyScene'
import { normalizeFacts } from './family-layout/normalizeFacts'
import {
  DEFAULT_FAMILY_VIEW_POLICY,
  DEFAULT_LAYOUT_METRICS,
  type FamilyViewPolicy,
  type LayoutPreferences,
  type LayoutScene,
} from './family-layout/types'

export type { LayoutScene } from './family-layout/types'

export interface LayoutFamilyTreeOptions {
  data?: FamilyData
  view?: Partial<FamilyViewPolicy>
  previousScene?: LayoutScene
  changedIds?: string[]
  auxiliaryFocusPersonId?: string
}

export async function layoutFamilyTree(
  members: Member[],
  options: LayoutFamilyTreeOptions = {},
): Promise<LayoutScene> {
  const data = options.data ?? temporaryFamily(members)
  const normalized = normalizeFacts(data)

  return layoutFamilyScene({
    facts: normalized.facts,
    view: mergeViewPolicy(data, normalized.facts.parentages, options.view),
    preferences: toLayoutPreferences(data),
    metrics: { ...DEFAULT_LAYOUT_METRICS },
    inputDiagnostics: normalized.diagnostics,
    previousScene: options.previousScene,
    changedIds: options.changedIds,
    auxiliaryFocusPersonId: options.auxiliaryFocusPersonId,
  })
}

function temporaryFamily(members: Member[]): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(member => [member.id, member])),
  }
}

function mergeViewPolicy(
  data: FamilyData,
  parentages: ReturnType<typeof normalizeFacts>['facts']['parentages'],
  view: Partial<FamilyViewPolicy> | undefined,
): FamilyViewPolicy {
  const legacyPrimaryParentageByChild: Record<string, string> = {}
  for (const [childId, assignment] of Object.entries(data.childLayoutAssignments)) {
    if (!assignment.primaryParentId) continue
    const parentage = parentages.find(value => (
      value.childIds.includes(childId)
      && value.parentIds.includes(assignment.primaryParentId!)
    ))
    if (parentage) legacyPrimaryParentageByChild[childId] = parentage.id
  }

  return {
    ...DEFAULT_FAMILY_VIEW_POLICY,
    ...view,
    primaryPartnershipByPerson: {
      ...DEFAULT_FAMILY_VIEW_POLICY.primaryPartnershipByPerson,
      ...view?.primaryPartnershipByPerson,
    },
    primaryParentageByChild: {
      ...legacyPrimaryParentageByChild,
      ...view?.primaryParentageByChild,
    },
  }
}

function toLayoutPreferences(data: FamilyData): LayoutPreferences {
  return {
    rowOrders: data.layoutPreferences.rowOrders.map(row => ({
      id: row.id,
      unitIds: [...row.unitIds],
    })),
    familyAccentAssignments: {
      ...data.layoutPreferences.familyAccentAssignments,
    },
  }
}
