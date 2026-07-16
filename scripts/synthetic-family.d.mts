import type { FamilyData } from '../src/core/schema'

export const SYNTHETIC_FAMILY_SEED: number
export const SYNTHETIC_GENERATION_COUNTS: readonly [12, 24, 36, 48, 48, 32]
export const SYNTHETIC_AVATARS_PER_GENERATION: number

export interface SyntheticAvatarManifest {
  kind: 'synthetic-avatar-pool'
  source: string
  columns: number
  rows: number
  avatars: Array<{
    photoId: string
    generation: number
    slot: number
    memberIds: string[]
  }>
}

export interface SyntheticFamilyStats {
  memberCount: number
  generationCounts: number[]
  founderMemberCount: number
  incomingSpouseCount: number
  rootFamilyCount: number
  currentCoupleCount: number
  crossRootCurrentCoupleCount: number
  historicalCoupleCount: number
  adoptedParentRefCount: number
  stepParentRefCount: number
  godparentRefCount: number
  avatarCount: number
}

export function syntheticFamily200(seed?: number): FamilyData
export function syntheticAvatarManifest(family: FamilyData): SyntheticAvatarManifest
export function syntheticFamilyStats(family: FamilyData): SyntheticFamilyStats
