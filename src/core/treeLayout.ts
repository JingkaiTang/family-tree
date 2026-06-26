import type { Member } from './schema'
import type { LayoutResult } from './elkLayout'
import { layoutConstraintFamilyTree } from './layout/constraintFamilyLayout'

export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

export async function layoutFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
): Promise<LayoutResult> {
  return layoutConstraintFamilyTree(members, opts)
}
