/** Browser-only Google Drive transport. Credentials never leave this module's closures. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API_ROOT = 'https://www.googleapis.com/drive/v3/'
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3/files'
const FILE_FIELDS = 'id,name,mimeType,parents,appProperties,createdTime,size,trashed'
const JSON_LIMIT = 4 * 1024 * 1024
const MULTIPART_LIMIT = 5 * 1024 * 1024
// Drive requires non-final upload chunks to be a multiple of 256 KiB.
const UPLOAD_CHUNK_BYTES = 1024 * 1024

export interface DriveAccount {
  permissionId: string
  displayName: string
  emailAddress?: string
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  appProperties?: Record<string, string>
  createdTime?: string
  size?: string
  trashed?: boolean
}

export interface DriveApi {
  getAccount(): Promise<DriveAccount>
  listFiles(query: string): Promise<DriveFile[]>
  getFile(id: string): Promise<DriveFile>
  readFile(id: string, maxBytes: number): Promise<Blob>
  generateId(): Promise<string>
  createFile(metadata: DriveFile, content?: Blob): Promise<DriveFile>
}

type DriveErrorCode = 'auth-required' | 'auth-failed' | 'account-mismatch' | 'cancelled'
  | 'network' | 'timeout' | 'rate-limit' | 'permission-denied' | 'not-found'
  | 'conflict' | 'too-large' | 'invalid-response' | 'configuration'

export class DriveError extends Error {
  constructor(readonly code: DriveErrorCode, message: string, readonly status?: number) {
    super(message)
    this.name = 'DriveError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): never {
  throw new DriveError('invalid-response', 'Google Drive 返回了无法识别的数据')
}

function parseFile(value: unknown): DriveFile {
  if (!record(value) || typeof value.id !== 'string' || !value.id
    || typeof value.name !== 'string' || typeof value.mimeType !== 'string') invalidResponse()
  const file: DriveFile = { id: value.id, name: value.name, mimeType: value.mimeType }
  if (value.parents !== undefined) {
    if (!Array.isArray(value.parents) || !value.parents.every(id => typeof id === 'string')) invalidResponse()
    file.parents = value.parents
  }
  if (value.appProperties !== undefined) {
    if (!record(value.appProperties) || !Object.values(value.appProperties).every(v => typeof v === 'string')) invalidResponse()
    file.appProperties = Object.fromEntries(Object.entries(value.appProperties).map(([key, v]) => [key, String(v)]))
  }
  for (const field of ['createdTime', 'size'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'string') invalidResponse()
      file[field] = value[field]
    }
  }
  if (value.trashed !== undefined) {
    if (typeof value.trashed !== 'boolean') invalidResponse()
    file.trashed = value.trashed
  }
  return file
}

async function boundedBlob(response: Response, maxBytes: number): Promise<Blob> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw new DriveError('too-large', 'Google Drive 文件超过允许读取的大小')
  }
  if (!response.body) return new Blob([], { type: response.headers.get('content-type') ?? '' })
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new DriveError('too-large', 'Google Drive 文件超过允许读取的大小')
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? '' })
}

async function readJson(response: Response): Promise<unknown> {
  const text = await (await boundedBlob(response, JSON_LIMIT)).text()
  try { return JSON.parse(text) } catch { return invalidResponse() }
}

function endpoint(path: string, parameters: Record<string, string> = {}): string {
  return `${API_ROOT}${path}?${new URLSearchParams(parameters)}`
}

function errorReason(value: unknown): string | undefined {
  if (!record(value) || !record(value.error) || !Array.isArray(value.error.errors)) return undefined
  const first = value.error.errors[0]
  return record(first) && typeof first.reason === 'string' ? first.reason : undefined
}

export interface DriveApiOptions {
  getToken: () => string
  invalidateToken: () => void
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Includes reading the response body, not only receiving headers. */
  timeoutMs?: number
}

export function createDriveApi(options: DriveApiOptions): DriveApi {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? 30_000

  function checkToken(token: string) {
    if (!token || options.getToken() !== token) throw new DriveError('auth-required', 'Google Drive 连接已变化，请重新连接')
  }

  async function request<T>(token: string, url: string, init: RequestInit, consume: (response: Response) => Promise<T>,
    settings: { acceptedStatuses?: number[]; retries?: number } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      checkToken(token)
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let retryDelay: number | undefined
      try {
        return await Promise.race([
          (async () => {
            const headers = new Headers(init.headers)
            headers.set('Authorization', `Bearer ${token}`)
            const response = await fetcher(url, { ...init, headers, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' })
            checkToken(token)
            if (!response.ok && !settings.acceptedStatuses?.includes(response.status)) {
              if (response.status === 401) {
                options.invalidateToken()
                void response.body?.cancel().catch(() => {})
                throw new DriveError('auth-required', 'Google Drive 授权已过期，请点击重新连接', 401)
              }
              let reason: string | undefined
              try { reason = errorReason(await readJson(response)) } catch { /* Preserve HTTP failure for non-JSON responses. */ }
              if (response.status === 429 || response.status >= 500
                || (response.status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'))) {
                const retryAfter = Number(response.headers.get('retry-after'))
                retryDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : undefined
                throw new DriveError('rate-limit', 'Google Drive 暂时繁忙，请稍后重试', response.status)
              }
              if (response.status === 403) throw new DriveError('permission-denied', 'Google Drive 拒绝访问，请检查文件权限和存储空间', 403)
              if (response.status === 404) throw new DriveError('not-found', 'Google Drive 文件不存在或当前账号无权访问', 404)
              if (response.status === 409) throw new DriveError('conflict', 'Google Drive 文件已存在，需要核对内容', 409)
              throw new DriveError('invalid-response', `Google Drive 请求失败（${response.status}）`, response.status)
            }
            const result = await consume(response)
            checkToken(token)
            return result
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new DriveError('timeout', 'Google Drive 请求超时，请检查网络后重试'))
              controller.abort()
            }, timeoutMs)
          }),
        ])
      } catch (error) {
        const failure = error instanceof DriveError ? error
          : new DriveError('network', '无法连接 Google Drive，请检查网络后重试')
        if (attempt >= (settings.retries ?? 3) || !['network', 'timeout', 'rate-limit'].includes(failure.code)) throw failure
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
      await sleep(retryDelay ?? Math.min(250 * 2 ** attempt + Math.random() * 250, 5000))
    }
  }

  function getFile(token: string, id: string): Promise<DriveFile> {
    return request(token, endpoint(`files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS }), {}, async r => {
      const file = parseFile(await readJson(r))
      if (file.id !== id) invalidResponse()
      return file
    })
  }

  function readFile(token: string, id: string, maxBytes: number): Promise<Blob> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new DriveError('configuration', '文件大小限制无效')
    return request(token, endpoint(`files/${encodeURIComponent(id)}`, { alt: 'media' }), {}, r => boundedBlob(r, maxBytes))
  }

  async function verifyExisting(token: string, metadata: DriveFile, content?: Blob): Promise<DriveFile> {
    const existing = await getFile(token, metadata.id)
    const sameParents = metadata.parents === undefined || (existing.parents?.length === metadata.parents.length
      && metadata.parents.every(id => existing.parents?.includes(id)))
    const sameProperties = Object.entries(metadata.appProperties ?? {}).every(([key, value]) => existing.appProperties?.[key] === value)
    if (existing.name !== metadata.name || existing.mimeType !== metadata.mimeType || existing.trashed || !sameParents || !sameProperties) {
      throw new DriveError('conflict', 'Google Drive 中已有不同的文件，未覆盖现有数据', 409)
    }
    if (content !== undefined) {
      const remote = await readFile(token, metadata.id, content.size)
      const digest = async (blob: Blob) => new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
      const [expected, actual] = await Promise.all([digest(content), digest(remote)])
      if (remote.size !== content.size || !expected.every((byte, index) => byte === actual[index])) {
        throw new DriveError('conflict', 'Google Drive 中已有不同的文件内容，未覆盖现有数据', 409)
      }
    }
    checkToken(token)
    return existing
  }

  async function resumableUpload(token: string, metadata: DriveFile, content: Blob): Promise<DriveFile> {
    const startSession = () => request(token,
      `${UPLOAD_ROOT}?${new URLSearchParams({ uploadType: 'resumable', fields: FILE_FIELDS, ignoreDefaultVisibility: 'true' })}`, {
        method: 'POST', body: JSON.stringify(metadata),
        headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': metadata.mimeType, 'X-Upload-Content-Length': String(content.size) },
      }, async response => {
        const location = response.headers.get('location')
        if (!location) invalidResponse()
        let target: URL
        try { target = new URL(location) } catch { return invalidResponse() }
        // The Location header is untrusted. Never send a bearer token to another origin/path.
        if (target.origin !== 'https://www.googleapis.com' || target.username || target.password || target.hash
          || !['/upload/drive/v3/files', '/resumable/upload/drive/v3/files'].includes(target.pathname)
          || !target.searchParams.get('upload_id')) invalidResponse()
        void response.body?.cancel().catch(() => {})
        return target.href
      })
    let session = await startSession()
    let offset = 0
    let probe = false
    let stalled = 0
    // Progress does not consume the failure budget. The independent ceiling still
    // bounds a malformed server that acknowledges only a few bytes forever.
    for (let requests = 0; requests < 1024 && stalled < 8; requests++) {
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, content.size)
      try {
        const result = await request(token, session, {
          method: 'PUT', body: probe ? new Blob([]) : content.slice(offset, end),
          headers: {
            'Content-Type': metadata.mimeType,
            'Content-Range': probe ? `bytes */${content.size}` : `bytes ${offset}-${end - 1}/${content.size}`,
          },
        }, async response => {
          if (response.status !== 308) {
            const created = parseFile(await readJson(response))
            if (created.id !== metadata.id) invalidResponse()
            return { file: created }
          }
          const range = response.headers.get('range')
          const match = range?.match(/^bytes=0-(\d+)$/)
          if (range && !match) invalidResponse()
          const nextOffset = match ? Number(match[1]) + 1 : 0
          if (!Number.isSafeInteger(nextOffset) || nextOffset < offset || nextOffset >= content.size
            || (!probe && nextOffset > end)) invalidResponse()
          void response.body?.cancel().catch(() => {})
          return { offset: nextOffset }
        }, { acceptedStatuses: [308], retries: 0 })
        if (result.file) return result.file
        stalled = result.offset! > offset ? 0 : stalled + 1
        if (stalled > 0 && stalled < 8) await sleep(250 * 2 ** Math.min(stalled - 1, 4))
        offset = result.offset!
        probe = false
      } catch (error) {
        if (!(error instanceof DriveError)) throw error
        stalled++
        if (error.code === 'not-found') {
          // An upload session may expire after completion; first check the fixed file ID.
          try { return await verifyExisting(token, metadata, content) } catch (existingError) {
            if (!(existingError instanceof DriveError) || existingError.code !== 'not-found') throw existingError
          }
          if (stalled >= 8 || requests === 1023) throw error
          session = await startSession()
          offset = 0
          probe = false
        } else if (['network', 'timeout', 'rate-limit'].includes(error.code) && stalled < 8 && requests < 1023) {
          await sleep(Math.min(250 * 2 ** (stalled - 1) + Math.random() * 250, 5000))
          // Query the acknowledged range before re-sending bytes after an uncertain response.
          probe = true
        } else throw error
      }
    }
    throw new DriveError('network', 'Google Drive 上传多次未完成，请检查网络后重试')
  }

  return {
    async getAccount() {
      const data = await request(options.getToken(), endpoint('about', { fields: 'user(permissionId,displayName,emailAddress)' }), {}, readJson)
      if (!record(data) || !record(data.user) || typeof data.user.permissionId !== 'string' || !data.user.permissionId) invalidResponse()
      return {
        permissionId: data.user.permissionId,
        displayName: typeof data.user.displayName === 'string' ? data.user.displayName : 'Google Drive 用户',
        ...(typeof data.user.emailAddress === 'string' ? { emailAddress: data.user.emailAddress } : {}),
      }
    },
    async listFiles(query) {
      const token = options.getToken()
      const files = new Map<string, DriveFile>()
      const visited = new Set<string>()
      let pageToken = ''
      do {
        if (visited.has(pageToken) || visited.size >= 1000) invalidResponse()
        visited.add(pageToken)
        const data = await request(token, endpoint('files', {
          q: query, spaces: 'drive', corpora: 'user', pageSize: '1000',
          fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
          ...(pageToken ? { pageToken } : {}),
        }), {}, readJson)
        if (!record(data) || data.incompleteSearch === true || (data.files !== undefined && !Array.isArray(data.files))) invalidResponse()
        for (const raw of (data.files ?? []) as unknown[]) {
          const file = parseFile(raw)
          files.set(file.id, file)
        }
        if (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string') invalidResponse()
        pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : ''
      } while (pageToken)
      return [...files.values()]
    },
    getFile: id => getFile(options.getToken(), id),
    readFile: (id, maxBytes) => readFile(options.getToken(), id, maxBytes),
    async generateId() {
      const data = await request(options.getToken(), endpoint('files/generateIds', { count: '1', space: 'drive', type: 'files' }), {}, readJson)
      if (!record(data) || !Array.isArray(data.ids) || typeof data.ids[0] !== 'string' || !data.ids[0]) invalidResponse()
      return data.ids[0]
    },
    async createFile(metadata, content) {
      parseFile(metadata)
      const token = options.getToken()
      const boundary = `family-tree-${crypto.randomUUID()}`
      const body = content === undefined ? JSON.stringify(metadata) : new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, content, `\r\n--${boundary}--\r\n`,
      ])
      try {
        if (content && content.size > MULTIPART_LIMIT) return await resumableUpload(token, metadata, content)
        return await request(token, content === undefined ? endpoint('files', { fields: FILE_FIELDS, ignoreDefaultVisibility: 'true' })
          : `${UPLOAD_ROOT}?${new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS, ignoreDefaultVisibility: 'true' })}`, {
          method: 'POST', body,
          headers: { 'Content-Type': content === undefined ? 'application/json' : `multipart/related; boundary=${boundary}` },
        }, async r => {
          const file = parseFile(await readJson(r))
          if (file.id !== metadata.id) invalidResponse()
          return file
        })
      } catch (error) {
        if (!(error instanceof DriveError) || error.code !== 'conflict') throw error
        return verifyExisting(token, metadata, content)
      }
    },
  }
}

export interface GoogleTokenResponse {
  access_token?: string
  expires_in?: string | number
  scope?: string
  error?: string
}

export interface GoogleIdentityOAuth {
  initTokenClient(config: {
    client_id: string
    scope: string
    include_granted_scopes: boolean
    callback: (response: GoogleTokenResponse) => void
    error_callback: (error: { type: string }) => void
  }): { requestAccessToken(config: { prompt: string; login_hint?: string }): void }
}

export interface GoogleDriveAuth {
  prepare(): Promise<void>
  authorize(expectedPermissionId?: string): Promise<DriveAccount>
  getToken(): string
  invalidate(): void
  disconnect(): void
  getAccount(): DriveAccount | null
}

export interface GoogleDriveAuthOptions {
  loadIdentity?: () => Promise<GoogleIdentityOAuth>
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

function readIdentity(): GoogleIdentityOAuth | undefined {
  const global = globalThis as typeof globalThis & { google?: { accounts?: { oauth2?: GoogleIdentityOAuth } } }
  return global.google?.accounts?.oauth2
}

let identityLoad: Promise<GoogleIdentityOAuth> | undefined
function loadIdentity(): Promise<GoogleIdentityOAuth> {
  const available = readIdentity()
  if (available) return Promise.resolve(available)
  if (identityLoad) return identityLoad
  identityLoad = new Promise<GoogleIdentityOAuth>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new DriveError('configuration', 'Google Drive 登录需要浏览器环境'))
      return
    }
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timer)
      script.remove()
      reject(new DriveError('network', '无法加载 Google 登录服务，请检查网络后重试'))
    }
    const timer = setTimeout(fail, 20_000)
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      clearTimeout(timer)
      const oauth = readIdentity()
      if (oauth) resolve(oauth)
      else fail()
    }
    script.onerror = fail
    document.head.append(script)
  }).catch(error => { identityLoad = undefined; throw error })
  return identityLoad
}

export function createGoogleDriveAuth(clientId: string, options: GoogleDriveAuthOptions = {}): GoogleDriveAuth {
  const now = options.now ?? Date.now
  let identity: GoogleIdentityOAuth | undefined
  let preparation: Promise<void> | undefined
  let accessToken = ''
  let expiresAt = 0
  let account: DriveAccount | null = null
  let pending: { cancel: () => void } | undefined
  const invalidate = () => { accessToken = ''; expiresAt = 0 }
  return {
    prepare() {
      if (!clientId.trim()) return Promise.reject(new DriveError('configuration', '请先配置 Google OAuth Web Client ID'))
      if (!preparation) preparation = (options.loadIdentity ?? loadIdentity)().then(value => { identity = value }).catch(error => {
        preparation = undefined
        throw error
      })
      return preparation
    },
    authorize(expectedPermissionId) {
      if (!identity) return Promise.reject(new DriveError('configuration', '请先加载 Google 登录服务，再点击连接'))
      if (pending) return Promise.reject(new DriveError('auth-failed', 'Google Drive 授权正在进行，请完成当前窗口'))
      const loginHint = account?.permissionId === expectedPermissionId ? account?.emailAddress : undefined
      invalidate()
      account = null
      return new Promise<DriveAccount>((resolve, reject) => {
        const finish = (error?: DriveError, result?: DriveAccount, token?: string, deadline?: number) => {
          if (pending !== operation) return
          clearTimeout(timer)
          pending = undefined
          if (error || !result || !token || !deadline) {
            invalidate()
            account = null
            reject(error ?? new DriveError('auth-failed', 'Google Drive 授权未完成'))
          } else {
            accessToken = token
            expiresAt = deadline
            account = result
            resolve({ ...result })
          }
        }
        const operation = { cancel: () => finish(new DriveError('cancelled', '已取消 Google Drive 连接')) }
        pending = operation
        const timer = setTimeout(() => finish(new DriveError('timeout', 'Google Drive 授权超时，请重试')), options.timeoutMs ?? 120_000)
        try {
          const client = identity!.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_DRIVE_SCOPE,
            include_granted_scopes: false,
            error_callback: error => finish(new DriveError(error.type === 'popup_closed' ? 'cancelled' : 'auth-failed',
              error.type === 'popup_closed' ? '已关闭 Google 授权窗口' : '无法打开 Google 授权窗口，请允许弹窗后重试')),
            callback: response => {
              if (pending !== operation) return
              const lifetime = Number(response.expires_in)
              const token = response.access_token
              if (response.error || typeof token !== 'string' || !token || !Number.isFinite(lifetime) || lifetime <= 30
                || typeof response.scope !== 'string' || !response.scope.split(/\s+/).includes(GOOGLE_DRIVE_SCOPE)) {
                finish(new DriveError('auth-failed', '未获得 Google Drive 所需权限，请重新授权'))
                return
              }
              const deadline = now() + (lifetime - 30) * 1000
              const api = createDriveApi({ getToken: () => token, invalidateToken: () => {}, fetch: options.fetch })
              void api.getAccount().then(result => {
                if (expectedPermissionId && result.permissionId !== expectedPermissionId) {
                  finish(new DriveError('account-mismatch', '所选 Google 账号与此项目不匹配，请选择原账号'))
                } else if (now() >= deadline) {
                  finish(new DriveError('auth-required', 'Google Drive 授权已过期，请重新连接'))
                } else finish(undefined, result, token, deadline)
              }).catch(error => finish(error instanceof DriveError ? error : new DriveError('auth-failed', '无法确认 Google Drive 账号')))
            },
          })
          // Deliberately synchronous: preserve the click's transient user activation.
          client.requestAccessToken({ prompt: loginHint ? '' : 'select_account', ...(loginHint ? { login_hint: loginHint } : {}) })
        } catch {
          finish(new DriveError('auth-failed', '无法启动 Google Drive 授权，请重试'))
        }
      })
    },
    getToken() {
      if (!accessToken || now() >= expiresAt) {
        invalidate()
        throw new DriveError('auth-required', '请连接 Google Drive 后继续')
      }
      return accessToken
    },
    invalidate,
    disconnect() { pending?.cancel(); invalidate(); account = null },
    getAccount: () => account ? { ...account } : null,
  }
}
