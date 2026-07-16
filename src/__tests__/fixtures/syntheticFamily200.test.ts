import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { FamilyData } from '@/core/schema'
import { validateFamilyIntegrity } from '@/core/familyIntegrity'
import {
  SYNTHETIC_GENERATION_COUNTS,
  syntheticAvatarManifest,
  syntheticFamily200,
  syntheticFamilyStats,
} from './syntheticFamily200'

describe('syntheticFamily200', () => {
  it('produces a deterministic, schema-valid 200-person family across exactly six generations', () => {
    const family = syntheticFamily200()
    const parsed = FamilyData.safeParse(family)

    expect(parsed.success).toBe(true)
    expect(validateFamilyIntegrity(family)).toEqual([])
    expect(syntheticFamily200()).toEqual(family)
    expect(syntheticFamily200(1)).not.toEqual(family)
    expect(syntheticFamilyStats(family)).toEqual({
      memberCount: 200,
      generationCounts: [...SYNTHETIC_GENERATION_COUNTS],
      founderMemberCount: 12,
      incomingSpouseCount: 72,
      rootFamilyCount: 6,
      currentCoupleCount: 84,
      crossRootCurrentCoupleCount: 6,
      historicalCoupleCount: 2,
      adoptedParentRefCount: 2,
      stepParentRefCount: 1,
      godparentRefCount: 3,
      avatarCount: 48,
    })
  })

  it('keeps every parent, spouse and godparent relation reciprocal and generation-safe', () => {
    const family = syntheticFamily200()

    for (const member of Object.values(family.members)) {
      expect(new Set(member.parents.map(parent => parent.id)).size).toBe(member.parents.length)
      expect(new Set(member.spouses.map(spouse => `${spouse.type}:${spouse.id}`)).size)
        .toBe(member.spouses.length)

      for (const parentRef of member.parents) {
        const parent = family.members[parentRef.id]
        expect(parent).toBeDefined()
        expect(parent.children).toContainEqual({ id: member.id, type: parentRef.type })
        expect(Number(parent.syntheticGeneration)).toBe(Number(member.syntheticGeneration) - 1)
        expect(parent.birthDate! < member.birthDate!).toBe(true)
      }
      for (const spouseRef of member.spouses) {
        const spouse = family.members[spouseRef.id]
        expect(spouse.spouses).toContainEqual({ id: member.id, type: spouseRef.type })
        expect(spouse.syntheticGeneration).toBe(member.syntheticGeneration)
      }
      for (const godparentRef of member.godparents) {
        expect(family.members[godparentRef.id].godchildren)
          .toContainEqual({ id: member.id, type: 'godchild' })
      }
    }
  })

  it('does not reuse an avatar between spouses or siblings in the same generation', () => {
    const family = syntheticFamily200()

    for (const member of Object.values(family.members)) {
      for (const spouse of member.spouses) {
        expect(family.members[spouse.id].photoId).not.toBe(member.photoId)
      }
      const parentIds = new Set(member.parents.map(parent => parent.id))
      const siblings = Object.values(family.members).filter(candidate => (
        candidate.id !== member.id
        && candidate.parents.some(parent => parentIds.has(parent.id))
      ))
      for (const sibling of siblings) expect(sibling.photoId).not.toBe(member.photoId)
    }
    expect(syntheticAvatarManifest(family).avatars).toHaveLength(48)
  })

  it('keeps the committed demo project in sync with the generator', async () => {
    const json = await readFile(new URL(
      '../../../test-data/synthetic-family-200-6.family/family.json',
      import.meta.url,
    ), 'utf8')

    expect(JSON.parse(json)).toEqual(syntheticFamily200())
  })

  it('ships one valid WebP photo and thumbnail for every avatar slot', async () => {
    const family = syntheticFamily200()
    const expectedFiles = syntheticAvatarManifest(family).avatars
      .map(avatar => `${avatar.photoId}.webp`)
      .sort()
    const mediaUrl = new URL(
      '../../../test-data/synthetic-family-200-6.family/media/',
      import.meta.url,
    )

    for (const directory of ['photos', 'thumbs']) {
      const directoryUrl = new URL(`${directory}/`, mediaUrl)
      const files = (await readdir(directoryUrl)).filter(file => file.endsWith('.webp')).sort()
      expect(files).toEqual(expectedFiles)
      for (const file of files) {
        const bytes = await readFile(new URL(file, directoryUrl))
        expect(bytes.byteLength).toBeGreaterThan(100)
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
      }
    }
  })
})
