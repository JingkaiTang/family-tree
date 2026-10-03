import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLastProjectRef,
  getLayoutModePreference,
  setLastProjectPath,
  setLastProjectRef,
  setLayoutModePreference,
} from './prefs'
import { externalProjectRef } from './projectRef'

describe('project preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('migrates the legacy last project path', () => {
    setLastProjectPath('/tmp/legacy.family')

    expect(getLastProjectRef()).toEqual(externalProjectRef('/tmp/legacy.family'))
  })

  it('persists a managed project reference without a physical path', () => {
    const project = { kind: 'managed', id: 'local-id' } as const

    setLastProjectRef(project)

    expect(getLastProjectRef()).toEqual(project)
    expect(localStorage.getItem('family-tree:lastProjectPath')).toBeNull()
  })

  it('clears the last project reference', () => {
    setLastProjectRef(externalProjectRef('/tmp/test.family'))

    setLastProjectRef(null)

    expect(getLastProjectRef()).toBeNull()
  })
})

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
  afterEach(() => vi.unstubAllGlobals())

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
