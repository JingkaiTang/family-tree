import type { Member } from './schema'
import type { LayoutScene } from './family-layout/types'
import type { LayoutFamilyTreeOptions } from './treeLayoutCore'

export interface LayoutWorkerRequest {
  id: number
  members: Member[]
  options: LayoutFamilyTreeOptions
}

export type LayoutWorkerResponse =
  | { id: number; ok: true; scene: LayoutScene }
  | { id: number; ok: false; error: string }
