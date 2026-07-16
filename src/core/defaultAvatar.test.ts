import { describe, expect, it } from 'vitest'
import { getDefaultAvatarAgeBand } from './defaultAvatar'

const today = new Date(2026, 6, 16)

describe('getDefaultAvatarAgeBand', () => {
  it.each([
    ['2012-07-17', 'child'],
    ['2000-07-16', 'young'],
    ['1975-07-16', 'adult'],
    ['1950-07-16', 'senior'],
  ] as const)('maps birth date %s to %s', (birthDate, expected) => {
    expect(getDefaultAvatarAgeBand({ birthDate }, today)).toBe(expected)
  })

  it('uses age at death for deceased members', () => {
    expect(getDefaultAvatarAgeBand({
      birthDate: '1930-02-10',
      deathDate: '1960-02-09',
    }, today)).toBe('young')
  })

  it('falls back to an adult silhouette for missing or invalid dates', () => {
    expect(getDefaultAvatarAgeBand({}, today)).toBe('adult')
    expect(getDefaultAvatarAgeBand({ birthDate: 'not-a-date' }, today)).toBe('adult')
    expect(getDefaultAvatarAgeBand({ birthDate: '2026-02-30' }, today)).toBe('adult')
  })
})
