import type { ChildLayoutAssignments, GridLayoutOverrides, ManualPositions, Member } from './schema'
import { createEmptyFamily, type FamilyData } from './schema'
import type { LayoutResult } from './elkLayout'
import { layoutGridFamilyTree } from './layout/gridFamilyLayout'

export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

export interface LayoutFamilyTreeOptions {
  manualPositions?: ManualPositions
  childLayoutAssignments?: ChildLayoutAssignments
  gridLayoutOverrides?: GridLayoutOverrides
}

export async function layoutFamilyTree(
  members: Member[],
  opts: LayoutFamilyTreeOptions = {},
): Promise<LayoutResult> {
  const familyData: FamilyData = {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map((member) => [member.id, member])),
    manualPositions: opts.manualPositions ?? {},
    childLayoutAssignments: opts.childLayoutAssignments ?? {},
    gridLayoutOverrides: opts.gridLayoutOverrides ?? {},
  }
  return layoutGridFamilyTree(familyData)
}
