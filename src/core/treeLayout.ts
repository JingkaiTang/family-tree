import type { Member } from './schema'
import type { LayoutResult } from './elkLayout'
import { layoutWithElk } from './elkLayout'

export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

export async function layoutFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
): Promise<LayoutResult> {
  return layoutWithElk(members, opts)
}
