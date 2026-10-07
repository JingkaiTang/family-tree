import { reactive, readonly } from 'vue'
import type { FamilyData } from '@/core/schema'
import type { ProjectRef, ProjectStorageProvider } from './storage/types'
import { createDriveApi, createGoogleDriveAuth, type GoogleDriveAuth, type DriveAccount } from './storage/googleDriveClient'
import { createGoogleDriveStorage } from './storage/googleDrive'
import { validateLoadedProject } from './projectValidation'

const PREFIX = 'google-drive:'

/** Application connection lifecycle. Credentials are managed privately by auth. */
export function createGoogleDriveConnection(clientId: string, authOverride?: GoogleDriveAuth) {
  const state = reactive({
    configured: !!clientId, ready: false, busy: false,
    account: null as DriveAccount | null, providerId: null as string | null,
    error: null as string | null, mediaEpoch: 0,
  })
  const auth = clientId ? authOverride ?? createGoogleDriveAuth(clientId) : null
  const providers = new Map<string, ReturnType<typeof createGoogleDriveStorage>>()
  let register: ((provider: ProjectStorageProvider) => void) | undefined

  function accountId(providerId: string): string | null {
    const prefix = `${PREFIX}${encodeURIComponent(clientId)}:`
    if (!clientId || !providerId.startsWith(prefix)) return null
    try {
      const value = decodeURIComponent(providerId.slice(prefix.length))
      return value && value.length <= 256 && encodeURIComponent(value) === providerId.slice(prefix.length) ? value : null
    } catch { return null }
  }

  function report(error: unknown): never {
    state.error = error instanceof Error ? error.message : String(error)
    throw error
  }

  function requireAccount(providerId: string): string {
    if (!auth || auth.getAccount()?.permissionId !== accountId(providerId)) {
      throw new Error('请连接此项目对应的 Google Drive 账号')
    }
    return auth.getToken()
  }

  function provider(providerId: string) {
    const found = providers.get(providerId)
    if (!found) throw new Error('请先连接 Google Drive')
    return found
  }

  function adoptAccount(account: DriveAccount): string {
    if (!auth) throw new Error('请先配置 Google Drive')
    const id = `${PREFIX}${encodeURIComponent(clientId)}:${encodeURIComponent(account.permissionId)}`
    if (!providers.has(id)) {
      const api = createDriveApi({
        getToken: () => requireAccount(id),
        invalidateToken: () => {
          auth.invalidate()
          state.error = 'Google Drive 授权已过期，请重新连接后保存；当前修改仍在此页面中。'
        },
      })
      const raw = createGoogleDriveStorage(id, api)
      // Expose failures persistently, including background saves and private photo reads.
      const wrapped = new Proxy(raw, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver)
          if (typeof value !== 'function') return value
          return async (...args: unknown[]) => {
            try {
              const result: unknown = await Reflect.apply(value, target, args)
              if (state.providerId === id && (key === 'saveProject' || key === 'resolveConflict')) state.error = null
              return result
            } catch (error) {
              // An old account's late response must not change the new connection's UI.
              if (state.providerId === id) return report(error)
              throw error
            }
          }
        },
      })
      register?.(wrapped)
      providers.set(id, wrapped)
    }
    state.account = account
    state.providerId = id
    state.error = null
    state.mediaEpoch++
    return id
  }

  async function prepare() {
    if (!auth || state.ready) return
    try {
      await auth.prepare()
      const restored = auth.getAccount()
      if (restored && !state.providerId) {
        auth.getToken()
        adoptAccount(restored)
      }
      state.ready = true
      state.error = null
    }
    catch (error) { report(error) }
  }

  async function connect(expectedProviderId?: string): Promise<string> {
    if (!auth) throw new Error('此部署尚未配置 Google Drive OAuth Client ID')
    const expected = expectedProviderId === undefined ? undefined : accountId(expectedProviderId)
    if (expected === null) throw new Error('此项目属于其他 Google OAuth 应用，无法在当前部署恢复')
    if (state.busy) throw new Error('Google Drive 正在连接，请稍候')
    if (state.providerId && (!expectedProviderId || expectedProviderId === state.providerId)) {
      try {
        requireAccount(state.providerId)
        // A transient photo/network failure also needs a retry even if OAuth is still valid.
        state.error = null
        state.mediaEpoch++
        return state.providerId
      } catch { /* Explicit click may renew. */ }
    }
    state.busy = true
    try {
      // authorize calls GIS synchronously before its first await: preserve this click's activation.
      const account = await auth.authorize(expected)
      return adoptAccount(account)
    } catch (error) {
      state.account = auth.getAccount()
      state.providerId = null
      return report(error)
    } finally { state.busy = false }
  }

  return {
    state: readonly(state), prepare, connect,
    isProvider: (id: string) => accountId(id) !== null,
    registerWith(callback: (provider: ProjectStorageProvider) => void) {
      register = callback
      for (const item of providers.values()) callback(item)
    },
    disconnect() {
      auth?.disconnect()
      state.account = null
      state.providerId = null
      state.error = null
      state.mediaEpoch++
    },
    async listProjects(providerId: string): Promise<ProjectRef[]> {
      return (await provider(providerId).listProjects()).map(project => ({ ...project, providerId }))
    },
    listVersions(ref: ProjectRef) { return provider(ref.providerId).listVersions(ref.id) },
    async selectVersion(ref: ProjectRef, revisionId: string) {
      const loaded = await provider(ref.providerId).loadVersion(ref.id, revisionId)
      return validateLoadedProject({
        ref: { ...ref, id: loaded.id, displayName: loaded.displayName },
        meta: loaded.meta, family: loaded.family,
      })
    },
    resolveConflict(ref: ProjectRef, family: FamilyData, heads: string[]) {
      // Use the same domain boundary as every other project save.
      const validated = validateLoadedProject({ ref, meta: null, family })
      return provider(ref.providerId).resolveConflict(ref.id, validated.family, heads)
    },
  }
}

const connection = createGoogleDriveConnection(import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? '')
export const googleDriveState = connection.state
export const prepareGoogleDrive = connection.prepare
export const connectGoogleDrive = connection.connect
export const disconnectGoogleDrive = connection.disconnect
export const isGoogleDriveProvider = connection.isProvider
export const registerGoogleDriveProviders = connection.registerWith
export const listGoogleDriveProjects = connection.listProjects
export const listGoogleDriveVersions = connection.listVersions
export const selectGoogleDriveVersion = connection.selectVersion
export const resolveGoogleDriveConflict = connection.resolveConflict
