import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import type { DriveAccount, DriveApiOptions, GoogleDriveAuth } from './storage/googleDriveClient'

const mocks = vi.hoisted(() => ({
  createApi: vi.fn(), createStorage: vi.fn(),
}))
vi.mock('./storage/googleDriveClient', async importOriginal => ({
  ...await importOriginal<typeof import('./storage/googleDriveClient')>(),
  createDriveApi: mocks.createApi,
}))
vi.mock('./storage/googleDrive', () => ({ createGoogleDriveStorage: mocks.createStorage }))

import { createGoogleDriveConnection } from './googleDriveConnection'

function fixture() {
  let account: DriveAccount | null = null
  let token: string | null = null
  const auth: GoogleDriveAuth = {
    prepare: vi.fn(async () => {}),
    authorize: vi.fn(async expected => {
      account = { permissionId: expected ?? 'account-A', displayName: '家族用户' }
      token = `token-${account.permissionId}`
      return account
    }),
    getAccount: () => account,
    getToken: () => { if (!token) throw new Error('需要授权'); return token },
    invalidate: () => { token = null },
    disconnect: () => { token = null; account = null },
  }
  const provider = {
    id: 'unused',
    createProject: vi.fn(), loadProject: vi.fn(), saveProject: vi.fn(),
    importPhoto: vi.fn(), readPhoto: vi.fn(), deletePhoto: vi.fn(),
    listProjects: vi.fn(async () => [{ id: 'folder', displayName: '家族' }]),
    listVersions: vi.fn(async () => [{ id: 'version', createdTime: '2026-10-03', isHead: true }]),
    loadVersion: vi.fn(async () => ({ id: 'folder', displayName: '家族', meta: createEmptyMeta('家族'), family: createEmptyFamily() })),
    resolveConflict: vi.fn(),
  }
  let apiOptions: DriveApiOptions | undefined
  mocks.createApi.mockImplementation((options: DriveApiOptions) => { apiOptions = options; return {} })
  mocks.createStorage.mockImplementation((id: string) => ({ ...provider, id }))
  const connection = createGoogleDriveConnection('public-client', auth)
  return { auth, provider, connection, getApiOptions: () => apiOptions! }
}

beforeEach(() => { vi.resetAllMocks() })

describe('Google Drive application connection', () => {
  it('does not load identity services when the optional provider is not configured', async () => {
    const connection = createGoogleDriveConnection('')
    await connection.prepare()
    expect(connection.state.configured).toBe(false)
    expect(connection.state.ready).toBe(false)
    expect(connection.isProvider('google-drive:client:account')).toBe(false)
    await expect(connection.connect()).rejects.toThrow('尚未配置')
  })

  it('registers one stable provider per client/account and retains its save baseline after renewal', async () => {
    const { auth, connection } = fixture()
    const register = vi.fn()
    connection.registerWith(register)
    await connection.prepare()
    const id = await connection.connect()
    expect(id).toBe('google-drive:public-client:account-A')
    expect(connection.state.ready).toBe(true)
    expect(connection.state.providerId).toBe(id)
    expect(connection.state.mediaEpoch).toBe(1)
    await connection.connect(id)
    expect(auth.authorize).toHaveBeenCalledTimes(1)
    expect(connection.state.mediaEpoch).toBe(2)
    auth.invalidate()
    await connection.connect(id)
    expect(auth.authorize).toHaveBeenLastCalledWith('account-A')
    expect(register).toHaveBeenCalledOnce()
    expect(mocks.createStorage).toHaveBeenCalledOnce()
    expect(connection.state.mediaEpoch).toBe(3)
    expect(JSON.stringify(connection.state)).not.toContain('token-')
  })

  it('registers a restored session during preparation without requesting OAuth again', async () => {
    const { auth, connection } = fixture()
    vi.mocked(auth.prepare).mockImplementation(async () => {
      await auth.authorize('account-A')
      vi.mocked(auth.authorize).mockClear()
    })
    const register = vi.fn()
    connection.registerWith(register)
    await connection.prepare()
    expect(connection.state.providerId).toBe('google-drive:public-client:account-A')
    expect(connection.state.account?.permissionId).toBe('account-A')
    await connection.connect('google-drive:public-client:account-A')
    expect(auth.authorize).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledOnce()
  })

  it('preserves a recoverable account reference while rejecting another deployment identity', async () => {
    const { connection, auth } = fixture()
    expect(connection.isProvider('google-drive:public-client:account-A')).toBe(true)
    expect(connection.isProvider('google-drive:other-client:account-A')).toBe(false)
    expect(connection.isProvider('google-drive:public-client:%invalid')).toBe(false)
    await expect(connection.connect('google-drive:other-client:account-A')).rejects.toThrow('其他 Google OAuth')
    expect(auth.authorize).not.toHaveBeenCalled()
  })

  it('prevents a retained provider from using credentials for another account', async () => {
    const { connection, getApiOptions } = fixture()
    await connection.connect()
    const oldApi = getApiOptions()
    expect(oldApi.getToken()).toBe('token-account-A')
    connection.disconnect()
    await expect(Promise.resolve().then(oldApi.getToken)).rejects.toThrow('对应的')
    await connection.connect('google-drive:public-client:account-B')
    expect(getApiOptions().getToken()).toBe('token-account-B')
    expect(() => oldApi.getToken()).toThrow('对应的')
  })

  it('reports storage failures persistently and clears them only after successful save/renewal', async () => {
    const { connection, provider, getApiOptions } = fixture()
    const registered: Array<{ saveProject: (id: string, family: ReturnType<typeof createEmptyFamily>) => Promise<void> }> = []
    connection.registerWith(item => registered.push(item))
    await connection.connect()
    provider.saveProject.mockRejectedValueOnce(new Error('并发冲突'))
    await expect(registered[0].saveProject('folder', createEmptyFamily())).rejects.toThrow('并发冲突')
    expect(connection.state.error).toBe('并发冲突')
    await registered[0].saveProject('folder', createEmptyFamily())
    expect(connection.state.error).toBeNull()
    getApiOptions().invalidateToken()
    expect(connection.state.error).toContain('授权已过期')
    expect(() => getApiOptions().getToken()).toThrow('需要授权')
  })

  it('validates selected historical content and refuses malformed conflict resolutions', async () => {
    const { connection, provider } = fixture()
    const providerId = await connection.connect()
    const ref = { providerId, id: 'folder', displayName: '家族' }
    expect((await connection.selectVersion(ref, 'version')).family.schemaVersion).toBe(4)
    const invalid = { ...createEmptyFamily(), rootMemberId: 'missing' }
    expect(() => connection.resolveConflict(ref, invalid, ['version'])).toThrow('rootMemberId')
    expect(provider.resolveConflict).not.toHaveBeenCalled()
  })
})
