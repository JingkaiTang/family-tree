import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLastProjectRef,
  getLayoutModePreference,
  setLastProjectRef,
  setLayoutModePreference,
} from './prefs'

const providers = vi.hoisted(() => new Set<string>())
vi.mock('./storage', () => ({ hasProvider: (id: string) => providers.has(id) }))
vi.mock('./googleDriveConnection', () => ({
  isGoogleDriveProvider: (id: string) => id === 'google-drive:configured-client:known-account',
}))

const LAST_PROJECT_REF_KEY = 'family-tree:lastProjectRef'
const PREVIOUS_PROJECT_KEY = 'family-tree:lastProject'
const LEGACY_PROJECT_PATH_KEY = 'family-tree:lastProjectPath'
const LAYOUT_MODE_KEY = 'family-tree:layoutModePreference'
const project = { providerId: 'browser-directory', id: 'opaque-project-id', displayName: '家族' }

let entries: Map<string, string>

beforeEach(() => {
  providers.clear()
  providers.add('browser-directory')
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
  it('保留当前部署的 Drive 账号引用，刷新后无需 token 也能显示重新连接入口', () => {
    const remote = { providerId: 'google-drive:configured-client:known-account', id: 'cloud-folder', displayName: '云端家族' }
    setLastProjectRef(remote)
    expect(providers.has(remote.providerId)).toBe(false)
    expect(getLastProjectRef()).toEqual(remote)
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(remote)
  })

  it('stores and restores only the public project reference fields', () => {
    const withCredentials = { ...project, accessToken: 'must-not-be-persisted' }
    setLastProjectRef(withCredentials)

    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(project)
    expect(getLastProjectRef()).toEqual(project)
  })

  it('restores a future provider only once it has been registered', () => {
    const remote = { providerId: 'drive-connection', id: 'opaque-remote-id', displayName: '远端家族' }
    setLastProjectRef(remote)

    expect(getLastProjectRef()).toBeNull()
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(remote)
    providers.add(remote.providerId)
    expect(getLastProjectRef()).toEqual(remote)
  })

  it.each(['tauri-local', 'tauri-managed'])('ignores references to the removed %s provider without deleting them', providerId => {
    const removed = { providerId, id: '/old-project', displayName: '旧项目' }
    entries.set(LAST_PROJECT_REF_KEY, JSON.stringify(removed))
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(project))

    expect(getLastProjectRef()).toBeNull()
    expect(entries.get(LAST_PROJECT_REF_KEY)).toBe(JSON.stringify(removed))
    expect(entries.get(PREVIOUS_PROJECT_KEY)).toBe(JSON.stringify(project))
  })

  it.each([
    { kind: 'external', path: '/tmp/legacy.family' },
    { kind: 'managed', id: 'old-managed-id' },
  ])('ignores a legacy $kind reference instead of treating it as a browser directory', stored => {
    entries.set(LAST_PROJECT_REF_KEY, JSON.stringify(stored))
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toBeNull()
    expect(entries.get(LAST_PROJECT_REF_KEY)).toBe(JSON.stringify(stored))
    expect(entries.get(LEGACY_PROJECT_PATH_KEY)).toBe('/stale/project')
  })

  it('ignores a legacy path without altering its record', () => {
    entries.set(LEGACY_PROJECT_PATH_KEY, '/home/user/家谱.family')

    expect(getLastProjectRef()).toBeNull()
    expect(entries.get(LEGACY_PROJECT_PATH_KEY)).toBe('/home/user/家谱.family')
    expect(entries.has(LAST_PROJECT_REF_KEY)).toBe(false)
  })

  it('migrates the previous canonical project key for a connected provider', () => {
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(project))

    expect(getLastProjectRef()).toEqual(project)
    expect(JSON.parse(entries.get(LAST_PROJECT_REF_KEY)!)).toEqual(project)
    expect(entries.has(PREVIOUS_PROJECT_KEY)).toBe(false)
  })

  it.each([
    'not-json',
    'null',
    '[]',
    '"/old/path"',
    '{"providerId":"browser-directory","id":"123"}',
    '{"providerId":"","id":"123","displayName":"家族"}',
    '{"providerId":"browser-directory","id":12,"displayName":"家族"}',
    '{"providerId":"browser-directory","id":"123","displayName":null}',
  ])('rejects invalid preferences without restoring a stale project: %s', value => {
    entries.set(LAST_PROJECT_REF_KEY, value)
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify(project))
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toBeNull()
  })

  it('does not restore a stale path when the previous canonical record is invalid', () => {
    entries.set(PREVIOUS_PROJECT_KEY, 'not-json')
    entries.set(LEGACY_PROJECT_PATH_KEY, '/stale/project')

    expect(getLastProjectRef()).toBeNull()
  })

  it('prefers the current key and discards unknown fields when reading', () => {
    entries.set(LAST_PROJECT_REF_KEY, JSON.stringify({ ...project, refreshToken: 'ignore' }))
    entries.set(PREVIOUS_PROJECT_KEY, JSON.stringify({ ...project, id: 'stale-project' }))
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

  it('keeps the previous canonical key if migration cannot be persisted', () => {
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
