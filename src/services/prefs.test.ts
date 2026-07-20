/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLayoutModePreference,
  setLayoutModePreference,
} from './prefs'

describe('layout mode preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
  })

  it('stores explicit choices locally and removes the key for auto', () => {
    expect(getLayoutModePreference()).toBe('auto')
    setLayoutModePreference('focus-flow')
    expect(getLayoutModePreference()).toBe('focus-flow')
    setLayoutModePreference('family-grid')
    expect(getLayoutModePreference()).toBe('family-grid')
    setLayoutModePreference('auto')
    expect(getLayoutModePreference()).toBe('auto')
  })

  it('ignores unknown stored values', () => {
    localStorage.setItem('family-tree:layoutModePreference', 'legacy-mode')
    expect(getLayoutModePreference()).toBe('auto')
  })
})
