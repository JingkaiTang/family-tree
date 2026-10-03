import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLastProjectRef,
  getLayoutModePreference,
  setLastProjectRef,
  setLayoutModePreference,
} from './prefs'
import { externalProjectRef, managedProjectRef } from './projectRef'

const LAST_PROJECT_REF_KEY = 'family-tree:lastProjectRef'
const PREVIOUS_PROJECT_KEY = 'family-tree:lastProject'
const LEGACY_PROJECT_PATH_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'

let entries: Map<string, string>

beforeEach(() => {
  entries = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recent project preferences', () => {
  it('stores and restores only the public project reference fields', () => {
    const project = {
      providerId: 'drive-connection',
      id: 'opaque-project-id',
      displayName: '家族',
      accessToken: 'must-not-be-persisted',
    }

    setLastProjectRef(project)

    const expected = {
      providerId: 'drive-connection',
      id: 'opaque-project-id',
      displayName: '家族',
    }
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(expected)
    expect(getLastProjectRef()).toEqual(expected)
  })

  it.each([
    ['/home/user/家谱.family/', '家谱.family'],
    ['C:\\Users\\user\\家谱.family\\', '家谱.family'],
  ])('migrates the legacy local path %s', (path, displayName) => {
    entries.set(LEGACY_PROJECT_PATH_KEY, path)

    const project = getLastProjectRef()

    expect(project).toEqual({ providerId: 'tauri-local', id: path, displayName })
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(project)
    expect(entries.has(LEGACY_PROJECT_PATH_KEY)).toBe(false)
  })

  it.each([
    {
      stored: { kind: 'external', path: '/tmp/legacy.family', accessToken: 'discard' },
      expected: externalProjectRef('/tmp/legacy.family'),
    },
    {
      stored: { kind: 'managed', id: 'local-id', accessToken: 'discard' },
      expected: managedProjectRef('local-id'),
    },
  ])('migrates the previous $stored.kind project reference', ({ stored, expected }) => {
    entries.set(LAST_PROJECT_REF_KEY, JSON.stringify(stored))
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toEqual(expected)
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(expected)
    expect(entries.has(LEGACY_PROJECT_PATH_KEY)).toBe(false)
  })

  it('migrates the previous canonical project key', () => {
    const project = { providerId: 'other-connection', id: 'opaque-id', displayName: '云端项目' }
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(project))

    expect(getLastProjectRef()).toEqual(project)
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(project)
    expect(entries.has(PREVIOUS_PROJECT_KEY)).toBe(false)
  })

  it('persists a named managed project without a physical path', () => {
    const project = managedProjectRef('local-id', '移动端家谱')

    setLastProjectRef(project)

    expect(getLastProjectRef()).toEqual(project)
    expect(getLastProjectRef()?.providerId).toBe('tauri-managed')
    expect(entries.has(LEGACY_PROJECT_PATH_KEY)).toBe(false)
  })

  it.each([
    'not-json',
    'null',
    '[]',
    '"/old/path"',
    '{"providerId":"drive","id":"123"}',
    '{"providerId":"","id":"123","displayName":"家族"}',
    '{"providerId":"drive","id":12,"displayName":"家族"}',
    '{"providerId":"drive","id":"123","displayName":null}',
    '{"kind":"managed","id":""}',
    '{"kind":"external","path":42}',
  ])('rejects invalid structured preferences without restoring a stale path: %s', value => {
    entries.set(LAST_PROJECT_REF_KEY, value)
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(externalProjectRef('/another/stale/project')))
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toBeNull()
  })

  it('does not restore a stale path when the previous canonical record is invalid', () => {
    entries.set(PREVIOUS_PROJECT_KEY, 'not-json')
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toBeNull()
  })

  it('prefers the current key and discards unknown fields when reading', () => {
    const project = { providerId: 'another-provider', id: 'project', displayName: '另一个项目' }
    entries.set(LAST_PROJECT_REF_KEY, JSON.stringify({ ...project, refreshToken: 'ignore' }))
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(externalProjectRef('/another/stale/project')))
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toEqual(project)
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(project)
    expect(entries.has(PREVIOUS_PROJECT_KEY)).toBe(false)
    expect(entries.has(LEGACY_PROJECT_PATH_KEY)).toBe(false)
  })

  it('forgetting a project removes every project key and preserves layout preferences', () => {
    entries.set(LAST_PROJECT_REF_KEY, '{}')
    entries.set(PREVIOUS_PROJECT_KEY, '{}')
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')
    entries.set(LAYOUT_MODE_KEY, 'focus-flow')

    setLastProjectRef(null)

    expect(getLastProjectRef()).toBeNull()
    expect(entries.size).toBe(1)
    expect(getLayoutModePreference()).toBe('focus-flow')
  })

  it('keeps legacy recovery available when writing the migration is denied', () => {
    entries.set(LEGACY_PROJECT_PATH_KEY, '/home/user/project.family')
    localStorage.setItem = () => { throw new Error('quota exceeded') }

    expect(getLastProjectRef()).toEqual({
      providerId: 'tauri-local',
      id: '/home/user/project.family',
      displayName: 'project.family',
    })
    expect(entries.get(LEGACY_PROJECT_PATH_KEY)).toBe('/home/user/project.family')
  })

  it('keeps the previous canonical key if migration cannot be persisted', () => {
    const project = managedProjectRef('local-id', '家谱')
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(project))
    localStorage.setItem = () => { throw new Error('quota exceeded') }

    expect(getLastProjectRef()).toEqual(project)
    expect(entries.get(PREVIOUS_PROJECT_KEY)).toBe(JSON.stringify(project))
  })

  it('tolerates unavailable browser preference storage', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(getLastProjectRef()).toBeNull()
    expect(() => setLastProjectRef(null)).not.toThrow()
    expect(getLayoutModePreference()).toBe('auto')
    expect(() => setLayoutModePreference('focus-flow')).not.toThrow()
  })
})

describe('layout mode preferences', () => {
  it('stores explicit choices locally and removes the key for auto', () => {
    expect(getLayoutModePreference()).toBe('auto')
    setLayoutModePreference('focus-flow')
    expect(getLayoutModePreference()).toBe('focus-flow')
    setLayoutModePreference('family-grid')
    expect(getLayoutModePreference()).toBe('family-grid')
    setLayoutModePreference('auto')
    expect(getLayoutModePreference()).toBe('auto')
    expect(entries.has(LAYOUT_MODE_KEY)).toBe(false)
  })

  it('ignores unknown stored values', () => {
    entries.set(LAYOUT_MODE_KEY, 'legacy-mode')

    expect(getLayoutModePreference()).toBe('auto')
  })
})
