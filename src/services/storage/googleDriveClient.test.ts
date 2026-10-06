import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDriveApi, createGoogleDriveAuth, GOOGLE_DRIVE_SCOPE,
  type DriveFile, type GoogleIdentityOAuth, type GoogleTokenResponse,
} from './googleDriveClient'

const account = { permissionId: 'account-1', displayName: '用户一', emailAddress: 'one@example.com' }
const file: DriveFile = { id: 'fixed-id', name: 'snapshot.json', mimeType: 'application/json', parents: ['project'], appProperties: { revision: 'revision-1' } }
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers })
const failure = (status: number, reason = 'forbidden') => json({ error: { errors: [{ reason }] } }, status)

function transport(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => handler(String(input), init))
  const invalidateToken = vi.fn()
  const sleep = vi.fn(async () => {})
  const api = createDriveApi({ getToken: () => 'access-token', invalidateToken, fetch, sleep })
  return { api, fetch, invalidateToken, sleep }
}

afterEach(() => vi.useRealTimers())

describe('Drive REST transport', () => {
  it('renames only metadata using an authenticated PATCH', async () => {
    const test = transport(() => json({ ...file, name: '新家族' }))
    expect(await test.api.renameFile(file.id, '新家族')).toMatchObject({ id: file.id, name: '新家族' })
    const [url, init] = test.fetch.mock.calls[0]
    expect(String(url)).toContain(`/drive/v3/files/${file.id}?`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ name: '新家族' })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  it('verifies a rename whose PATCH response was lost', async () => {
    const test = transport((_url, init) => {
      if (init?.method === 'PATCH') throw new Error('lost response')
      return json({ ...file, name: '新家族' })
    })
    await expect(test.api.renameFile(file.id, '新家族')).resolves.toMatchObject({ name: '新家族' })
  })

  it('does not confirm a rename when readback disagrees', async () => {
    const test = transport((_url, init) => init?.method === 'PATCH' ? failure(403) : json(file))
    await expect(test.api.renameFile(file.id, '新家族')).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('identifies the account through Drive about without a userinfo request', async () => {
    const test = transport(() => json({ user: account }))
    expect(await test.api.getAccount()).toEqual(account)
    const [url, init] = test.fetch.mock.calls[0]
    expect(String(url)).toContain('/drive/v3/about?')
    expect(new URL(String(url)).searchParams.get('fields')).toBe('user(permissionId,displayName,emailAddress)')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token')
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
  })

  it('requires the opaque account ID but tolerates absent display name and email', async () => {
    const test = transport(() => json({ user: { permissionId: 'opaque' } }))
    expect(await test.api.getAccount()).toEqual({ permissionId: 'opaque', displayName: 'Google Drive 用户' })
    const broken = transport(() => json({ user: { emailAddress: 'not-an-id@example.com' } }))
    await expect(broken.api.getAccount()).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('continues through an empty page, deduplicates IDs, and encodes query parameters', async () => {
    const pages = [json({ files: [], nextPageToken: 'page+/2' }), json({ files: [file], nextPageToken: '3' }), json({ files: [file] })]
    const test = transport(() => pages.shift()!)
    expect(await test.api.listFiles("'project' in parents and trashed = false")).toEqual([file])
    expect(test.fetch).toHaveBeenCalledTimes(3)
    const second = new URL(String(test.fetch.mock.calls[1][0]))
    expect(second.searchParams.get('pageToken')).toBe('page+/2')
    expect(second.searchParams.get('q')).toBe("'project' in parents and trashed = false")
  })

  it('rejects incomplete search and repeated pagination tokens', async () => {
    const incomplete = transport(() => json({ files: [file], incompleteSearch: true }))
    await expect(incomplete.api.listFiles('')).rejects.toMatchObject({ code: 'invalid-response' })
    const repeated = transport(() => json({ files: [], nextPageToken: 'same' }))
    await expect(repeated.api.listFiles('')).rejects.toMatchObject({ code: 'invalid-response' })
    expect(repeated.fetch).toHaveBeenCalledTimes(2)
  })

  it('invalidates an expired token without retrying or opening authorization', async () => {
    const test = transport(() => failure(401))
    await expect(test.api.getFile('id')).rejects.toMatchObject({ code: 'auth-required', status: 401 })
    expect(test.invalidateToken).toHaveBeenCalledOnce()
    expect(test.fetch).toHaveBeenCalledOnce()
    expect(test.sleep).not.toHaveBeenCalled()
  })

  it.each([429, 500, 503])('retries %s with a bounded attempt count', async status => {
    const test = transport(() => failure(status))
    await expect(test.api.getFile('id')).rejects.toMatchObject({ code: 'rate-limit' })
    expect(test.fetch).toHaveBeenCalledTimes(4)
    expect(test.sleep).toHaveBeenCalledTimes(3)
  })

  it.each(['rateLimitExceeded', 'userRateLimitExceeded'])('retries the specific 403 reason %s', async reason => {
    let calls = 0
    const test = transport(() => ++calls === 1 ? failure(403, reason) : json(file))
    expect(await test.api.getFile('fixed-id')).toEqual(file)
    expect(test.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([403, 404])('does not retry permanent HTTP %s failures', async status => {
    const test = transport(() => failure(status, 'storageQuotaExceeded'))
    await expect(test.api.getFile('id')).rejects.toMatchObject({ status })
    expect(test.fetch).toHaveBeenCalledOnce()
  })

  it('bounds Retry-After delays', async () => {
    let calls = 0
    const test = transport(() => ++calls === 1 ? json({}, 429, { 'Retry-After': '3600' }) : json(file))
    await test.api.getFile(file.id)
    expect(test.sleep).toHaveBeenCalledWith(5000)
  })

  it('rejects downloads larger than the declared limit without consuming them', async () => {
    const test = transport(() => new Response('far too much', { headers: { 'Content-Length': '99' } }))
    await expect(test.api.readFile('id', 4)).rejects.toMatchObject({ code: 'too-large' })
    expect(test.fetch).toHaveBeenCalledOnce()
  })

  it('enforces the byte limit on streamed responses without Content-Length', async () => {
    const cancel = vi.fn()
    const test = transport(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4, 5, 6])) },
      cancel,
    })))
    await expect(test.api.readFile('id', 5)).rejects.toMatchObject({ code: 'too-large' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(test.fetch).toHaveBeenCalledOnce()
  })

  it('preserves downloaded binary data and MIME type', async () => {
    const test = transport(() => new Response(new Uint8Array([0, 128, 255]), { headers: { 'Content-Type': 'image/webp' } }))
    const result = await test.api.readFile('id / with space', 3)
    expect(result.type).toBe('image/webp')
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]))
    expect(String(test.fetch.mock.calls[0][0])).toContain('id%20%2F%20with%20space')
  })

  it('applies its timeout while streaming a body, then retries only a bounded number of times', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted'))) },
    })))
    const api = createDriveApi({ getToken: () => 'token', invalidateToken: vi.fn(), fetch, sleep: async () => {}, timeoutMs: 100 })
    const assertion = expect(api.readFile('id', 100)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(401)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('does not clear a new account token when an old request returns 401', async () => {
    let token = 'old'
    const invalidateToken = vi.fn()
    const fetch: typeof globalThis.fetch = async () => { token = 'new'; return failure(401) }
    const api = createDriveApi({ getToken: () => token, invalidateToken, fetch })
    await expect(api.getAccount()).rejects.toMatchObject({ code: 'auth-required' })
    expect(invalidateToken).not.toHaveBeenCalled()
  })

  it('does not continue an old operation with a replacement token after a retry delay', async () => {
    let token = 'old'
    const fetch = vi.fn<typeof globalThis.fetch>(async () => failure(503))
    const api = createDriveApi({ getToken: () => token, invalidateToken: vi.fn(), fetch, sleep: async () => { token = 'new' } })
    await expect(api.listFiles('')).rejects.toMatchObject({ code: 'auth-required' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('requests a server-generated Drive ID', async () => {
    const test = transport(() => json({ ids: ['new-drive-id'] }))
    expect(await test.api.generateId()).toBe('new-drive-id')
    expect(String(test.fetch.mock.calls[0][0])).toContain('files/generateIds?count=1&space=drive&type=files')
  })

  it('reconciles an upload whose success response was lost using fixed ID, metadata, and bytes', async () => {
    let uploads = 0
    const test = transport((url, init) => {
      if (init?.method === 'POST') {
        if (++uploads === 1) throw new TypeError('network response lost')
        return failure(409)
      }
      if (url.includes('alt=media')) return new Response('immutable snapshot')
      return json(file)
    })
    expect(await test.api.createFile(file, new Blob(['immutable snapshot']))).toEqual(file)
    expect(test.fetch).toHaveBeenCalledTimes(4)
    const firstBody = test.fetch.mock.calls[0][1]?.body
    expect(firstBody).toBe(test.fetch.mock.calls[1][1]?.body)
    expect(firstBody).toBeInstanceOf(Blob)
    if (!(firstBody instanceof Blob)) throw new Error('expected multipart upload')
    expect(await firstBody.text()).toContain('"id":"fixed-id"')
  })

  it('rejects a 409 if an existing file has different bytes even at the same size', async () => {
    const test = transport((url, init) => init?.method === 'POST' ? failure(409)
      : url.includes('alt=media') ? new Response('other') : json(file))
    await expect(test.api.createFile(file, new Blob(['local']))).rejects.toMatchObject({ code: 'conflict' })
  })

  it.each([
    { name: 'another.json' }, { parents: ['elsewhere'] }, { appProperties: { revision: 'someone-else' } }, { trashed: true },
  ])('rejects a 409 when metadata disagrees: %j', async change => {
    const test = transport((_url, init) => init?.method === 'POST' ? failure(409) : json({ ...file, ...change }))
    await expect(test.api.createFile(file, new Blob(['local']))).rejects.toMatchObject({ code: 'conflict' })
    expect(test.fetch).toHaveBeenCalledTimes(2)
  })

  it('creates folders through the non-upload endpoint and reconciles their fixed ID', async () => {
    const folder = { id: 'folder-id', name: '家谱', mimeType: 'application/vnd.google-apps.folder', appProperties: { project: 'project-id' } }
    const test = transport((_url, init) => init?.method === 'POST' ? failure(409) : json(folder))
    expect(await test.api.createFile(folder)).toEqual(folder)
    expect(String(test.fetch.mock.calls[0][0])).not.toContain('/upload/')
    expect(new URL(String(test.fetch.mock.calls[0][0])).searchParams.get('ignoreDefaultVisibility')).toBe('true')
    expect(test.fetch.mock.calls[0][1]?.body).toBe(JSON.stringify(folder))
  })

  it('uses a resumable session for files exceeding 5 MiB', async () => {
    const content = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])
    const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1'
    const test = transport((_url, init) => init?.method === 'POST'
      ? new Response(null, { headers: { Location: session } }) : json(file))
    expect(await test.api.createFile(file, content)).toEqual(file)
    const [start, put] = test.fetch.mock.calls
    expect(String(start[0])).toContain('uploadType=resumable')
    expect(new URL(String(start[0])).searchParams.get('ignoreDefaultVisibility')).toBe('true')
    expect(start[1]?.body).toBe(JSON.stringify(file))
    expect(new Headers(start[1]?.headers).get('X-Upload-Content-Length')).toBe(String(content.size))
    expect(put[0]).toBe(session)
    expect(put[1]?.method).toBe('PUT')
    expect(new Headers(put[1]?.headers).get('Content-Range')).toBe(`bytes 0-${1024 * 1024 - 1}/${content.size}`)
    expect(put[1]?.body).toBeInstanceOf(Blob)
  })

  it.each([
    'https://evil.example/upload/drive/v3/files?upload_id=secret',
    'http://www.googleapis.com/upload/drive/v3/files?upload_id=secret',
    'https://user@www.googleapis.com/upload/drive/v3/files?upload_id=secret',
    'https://www.googleapis.com/another-api?upload_id=secret',
    'https://www.googleapis.com/upload/drive/v3/files',
  ])('does not send a token to an untrusted upload Location: %s', async location => {
    const test = transport(() => new Response(null, { headers: { Location: location } }))
    await expect(test.api.createFile(file, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])))
      .rejects.toMatchObject({ code: 'invalid-response' })
    expect(test.fetch).toHaveBeenCalledOnce()
  })

  it('probes an uncertain upload and resumes from the acknowledged offset', async () => {
    const content = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])
    const session = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session'
    let requests = 0
    const test = transport((_url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: session } })
      if (++requests === 1) throw new TypeError('connection interrupted')
      if (requests === 2) return new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } })
      return json(file)
    })
    expect(await test.api.createFile(file, content)).toEqual(file)
    expect(new Headers(test.fetch.mock.calls[2][1]?.headers).get('Content-Range')).toBe(`bytes */${content.size}`)
    const final = test.fetch.mock.calls[3][1]
    expect(new Headers(final?.headers).get('Content-Range')).toBe(`bytes 262144-${262144 + 1024 * 1024 - 1}/${content.size}`)
    if (!(final?.body instanceof Blob)) throw new Error('expected binary upload')
    expect(final.body.size).toBe(1024 * 1024)
  })

  it('accepts a completed session discovered by a status probe without uploading twice', async () => {
    let requests = 0
    const test = transport((_url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } })
      if (++requests === 1) throw new TypeError('completion response lost')
      return json(file)
    })
    expect(await test.api.createFile(file, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]))).toEqual(file)
    expect(test.fetch).toHaveBeenCalledTimes(3)
    const probe = test.fetch.mock.calls[2][1]?.body
    if (!(probe instanceof Blob)) throw new Error('expected empty status probe')
    expect(probe.size).toBe(0)
  })

  it('verifies fixed-ID content when an upload session disappears after completion', async () => {
    const content = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])
    const test = transport((url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } })
      if (init?.method === 'PUT') return failure(404)
      if (url.includes('alt=media')) return new Response(content)
      return json(file)
    })
    expect(await test.api.createFile(file, content)).toEqual(file)
    expect(test.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(test.fetch).toHaveBeenCalledTimes(4)
  })

  it('restarts an expired resumable session only after confirming its fixed ID is absent', async () => {
    let starts = 0
    const test = transport((_url, init) => {
      if (init?.method === 'POST') {
        starts++
        return new Response(null, { headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=session-${starts}` } })
      }
      return starts === 1 ? failure(404) : json(file)
    })
    expect(await test.api.createFile(file, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]))).toEqual(file)
    expect(starts).toBe(2)
    expect(String(test.fetch.mock.calls[2][0])).toContain('/drive/v3/files/fixed-id?')
    expect(test.fetch.mock.calls[3][1]?.body).toBe(JSON.stringify(file))
  })

  it('bounds repeated incomplete resumable responses', async () => {
    const test = transport((_url, init) => init?.method === 'POST'
      ? new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } })
      : new Response(null, { status: 308 }))
    await expect(test.api.createFile(file, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])))
      .rejects.toMatchObject({ code: 'network' })
    expect(test.fetch).toHaveBeenCalledTimes(9)
  })

  it('uploads a 50 MiB file through more than eight progressing chunks without restarting', async () => {
    const content = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])
    const session = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session'
    let acknowledged = 0
    const chunkSizes: number[] = []
    const test = transport((url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: session } })
      expect(url).toBe(session)
      const range = new Headers(init?.headers).get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      if (!range || !(init?.body instanceof Blob)) throw new Error('expected a binary chunk')
      const [, start, end, total] = range.map(Number)
      expect(start).toBe(acknowledged)
      expect(total).toBe(content.size)
      expect(init.body.size).toBe(end - start + 1)
      chunkSizes.push(init.body.size)
      acknowledged = end + 1
      return acknowledged === content.size ? json(file)
        : new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } })
    })
    expect(await test.api.createFile(file, content)).toEqual(file)
    expect(acknowledged).toBe(content.size)
    expect(chunkSizes).toHaveLength(51)
    expect(chunkSizes.slice(0, -1).every(size => size === 1024 * 1024 && size % (256 * 1024) === 0)).toBe(true)
    expect(chunkSizes.at(-1)).toBe(1)
    expect(test.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(test.sleep).not.toHaveBeenCalled()
  })

  it('resets the failure budget when probes confirm progress despite repeated lost chunk responses', async () => {
    const content = new Blob([new Uint8Array(12 * 1024 * 1024 + 1)])
    let acknowledged = 0
    let lostResponses = 0
    const test = transport((_url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } })
      const range = new Headers(init?.headers).get('Content-Range')
      if (range === `bytes */${content.size}`) {
        return acknowledged === content.size ? json(file)
          : new Response(null, { status: 308, headers: { Range: `bytes=0-${acknowledged - 1}` } })
      }
      const match = range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      if (!match) throw new Error('expected chunk range')
      expect(Number(match[1])).toBe(acknowledged)
      acknowledged = Number(match[2]) + 1
      lostResponses++
      throw new TypeError('the chunk arrived, but its response was lost')
    })
    expect(await test.api.createFile(file, content)).toEqual(file)
    expect(lostResponses).toBe(13)
    expect(acknowledged).toBe(content.size)
    expect(test.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('still bounds a server that acknowledges indefinitely tiny amounts of progress', async () => {
    let acknowledged = 0
    const test = transport((_url, init) => init?.method === 'POST'
      ? new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } })
      : new Response(null, { status: 308, headers: { Range: `bytes=0-${acknowledged++}` } }))
    await expect(test.api.createFile(file, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])))
      .rejects.toMatchObject({ code: 'network' })
    expect(acknowledged).toBe(1024)
    expect(test.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})

function authFixture(overrides: { now?: () => number; response?: unknown; timeoutMs?: number } = {}) {
  let callbacks: Parameters<GoogleIdentityOAuth['initTokenClient']>[0] | undefined
  const requestAccessToken = vi.fn()
  const identity: GoogleIdentityOAuth = { initTokenClient(config) { callbacks = config; return { requestAccessToken } } }
  const loadIdentity = vi.fn(async () => identity)
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(overrides.response ?? { user: account }))
  const auth = createGoogleDriveAuth('web-client.apps.googleusercontent.com', { loadIdentity, fetch, now: overrides.now, timeoutMs: overrides.timeoutMs })
  return {
    auth, loadIdentity, fetch, requestAccessToken,
    callback(response: GoogleTokenResponse = { access_token: 'secret-token', expires_in: 3600, scope: GOOGLE_DRIVE_SCOPE }) {
      if (!callbacks) throw new Error('authorize must be called first')
      callbacks.callback(response)
    },
    error(type: string) {
      if (!callbacks) throw new Error('authorize must be called first')
      callbacks.error_callback({ type })
    },
    config: () => callbacks,
  }
}

describe('Google Drive authorization', () => {
  it('loads GIS only on explicit preparation and requests the popup synchronously on click', async () => {
    const test = authFixture()
    expect(test.loadIdentity).not.toHaveBeenCalled()
    await expect(test.auth.authorize()).rejects.toMatchObject({ code: 'configuration' })
    await test.auth.prepare()
    await test.auth.prepare()
    expect(test.loadIdentity).toHaveBeenCalledOnce()
    const connected = test.auth.authorize()
    expect(test.requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' })
    expect(test.config()).toMatchObject({ scope: GOOGLE_DRIVE_SCOPE, include_granted_scopes: false })
    expect(() => test.auth.getToken()).toThrow()
    test.callback()
    expect(await connected).toEqual(account)
    expect(test.auth.getToken()).toBe('secret-token')
    expect(test.auth.getAccount()).toEqual(account)
  })

  it('expires credentials before the provider lifetime while preserving account identity for reconnect', async () => {
    let time = 0
    const test = authFixture({ now: () => time })
    await test.auth.prepare()
    const connected = test.auth.authorize()
    test.callback()
    await connected
    time = 3_571_000
    expect(() => test.auth.getToken()).toThrowError(expect.objectContaining({ code: 'auth-required' }))
    expect(test.auth.getAccount()?.permissionId).toBe(account.permissionId)
    const reconnect = test.auth.authorize(account.permissionId)
    expect(test.requestAccessToken).toHaveBeenLastCalledWith({ prompt: '', login_hint: account.emailAddress })
    test.callback()
    await reconnect
  })

  it.each([
    { access_token: 'token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.readonly' },
    { access_token: 'token', expires_in: 3600, scope: '' },
    { access_token: 'token', expires_in: 'not-a-number', scope: GOOGLE_DRIVE_SCOPE },
    { error: 'access_denied' },
  ])('rejects invalid or insufficient authorization without accessing Drive: %j', async response => {
    const test = authFixture()
    await test.auth.prepare()
    const connected = test.auth.authorize()
    test.callback(response)
    await expect(connected).rejects.toMatchObject({ code: 'auth-failed' })
    expect(test.fetch).not.toHaveBeenCalled()
    expect(test.auth.getAccount()).toBeNull()
    expect(() => test.auth.getToken()).toThrow()
  })

  it('rejects a different account before publishing its token to the application', async () => {
    const test = authFixture()
    await test.auth.prepare()
    const connected = test.auth.authorize('expected-other-account')
    expect(test.requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' })
    test.callback()
    await expect(connected).rejects.toMatchObject({ code: 'account-mismatch' })
    expect(test.auth.getAccount()).toBeNull()
    expect(() => test.auth.getToken()).toThrow()
  })

  it('rejects concurrent authorization and ignores a late result after disconnect', async () => {
    const test = authFixture()
    await test.auth.prepare()
    const first = test.auth.authorize()
    await expect(test.auth.authorize()).rejects.toMatchObject({ code: 'auth-failed' })
    test.auth.disconnect()
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    test.callback()
    expect(test.fetch).not.toHaveBeenCalled()
    expect(() => test.auth.getToken()).toThrow()
  })

  it.each(['popup_closed', 'popup_failed_to_open'])('handles the non-OAuth failure %s', async type => {
    const test = authFixture()
    await test.auth.prepare()
    const connected = test.auth.authorize()
    test.error(type)
    await expect(connected).rejects.toMatchObject({ code: type === 'popup_closed' ? 'cancelled' : 'auth-failed' })
    expect(test.auth.getAccount()).toBeNull()
  })

  it('times out authorization and ignores its late callback', async () => {
    vi.useFakeTimers()
    const test = authFixture({ timeoutMs: 100 })
    await test.auth.prepare()
    const assertion = expect(test.auth.authorize()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    test.callback()
    expect(test.fetch).not.toHaveBeenCalled()
    expect(() => test.auth.getToken()).toThrow()
  })

  it('rejects missing deployment configuration before loading third-party code', async () => {
    const loadIdentity = vi.fn()
    const auth = createGoogleDriveAuth('', { loadIdentity })
    await expect(auth.prepare()).rejects.toMatchObject({ code: 'configuration' })
    expect(loadIdentity).not.toHaveBeenCalled()
  })

  it('allows preparation to retry after a script load failure', async () => {
    const loadIdentity = vi.fn<() => Promise<GoogleIdentityOAuth>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ initTokenClient: () => ({ requestAccessToken: vi.fn() }) })
    const auth = createGoogleDriveAuth('client', { loadIdentity })
    await expect(auth.prepare()).rejects.toThrow('offline')
    await expect(auth.prepare()).resolves.toBeUndefined()
    expect(loadIdentity).toHaveBeenCalledTimes(2)
  })
})
