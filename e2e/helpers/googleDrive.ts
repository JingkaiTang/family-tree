import type { Page } from '@playwright/test'

interface RemoteFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  appProperties?: Record<string, string>
  createdTime?: string
  size?: string
  trashed?: boolean
}

interface SavedRevision {
  revisionId: string
  parents: string[]
  family: {
    members: Record<string, { firstName: string; lastName: string; notes?: string; photoId?: string }>
  }
}

const scope = 'https://www.googleapis.com/auth/drive.file'
const identityScript = `
  window.__driveOAuthRequests = 0;
  window.__driveOAuthActivations = [];
  window.google = { accounts: { oauth2: {
    initTokenClient(config) {
      if (config.scope !== '${scope}' || config.include_granted_scopes !== false) {
        throw new Error('Unexpected OAuth scope');
      }
      return { requestAccessToken() {
        window.__driveOAuthRequests++;
        window.__driveOAuthActivations.push(navigator.userActivation.isActive);
        queueMicrotask(() => config.callback({
          access_token: 'e2e-access-token-' + crypto.randomUUID(),
          expires_in: 3600,
          scope: '${scope}'
        }));
      } };
    }
  } } };
`

/** Prepare GIS without external network access; no token is issued without a click. */
export async function installGoogleIdentity(page: Page) {
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript', body: identityScript,
  }))
}

/**
 * The browser runs the real GIS loader, REST transport, storage provider and UI.
 * Only Google's external script/HTTP responses are substituted. This is not a
 * live Google OAuth, popup-policy, CORS or Drive consistency certification.
 */
export async function installGoogleDrive(page: Page) {
  const files = new Map<string, { metadata: RemoteFile; content: Buffer }>()
  const observedTokens = new Set<string>()
  const expiredTokens = new Set<string>()
  const errors: string[] = []
  let sequence = 0
  let unauthorizedRequests = 0
  let mediaReads = 0

  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await installGoogleIdentity(page)
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    }
    const json = (body: unknown, status = 200) => route.fulfill({
      status, headers, contentType: 'application/json', body: JSON.stringify(body),
    })
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    const token = request.headers().authorization?.replace(/^Bearer /, '') ?? ''
    observedTokens.add(token)
    if (!token.startsWith('e2e-access-token-') || expiredTokens.has(token)) {
      unauthorizedRequests++
      await json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
      return
    }
    try {
      if (url.pathname === '/drive/v3/about') {
        await json({ user: { permissionId: 'e2e-account', displayName: '虚构测试账号', emailAddress: 'test@example.invalid' } })
        return
      }
      if (url.pathname === '/drive/v3/files/generateIds') {
        await json({ ids: [`drive-file-${++sequence}`] })
        return
      }
      if (request.method() === 'POST' && ['/drive/v3/files', '/upload/drive/v3/files'].includes(url.pathname)) {
        const body = request.postDataBuffer()
        if (!body) throw new Error('Missing create body')
        let metadata: RemoteFile
        let content: Buffer = Buffer.alloc(0)
        if (url.pathname.startsWith('/upload/')) {
          const boundary = request.headers()['content-type']?.match(/boundary=([^;]+)/)?.[1]
          if (!boundary) throw new Error('Missing multipart boundary')
          const delimiter = Buffer.from(`\r\n--${boundary}`)
          const metadataStart = body.indexOf('\r\n\r\n') + 4
          const metadataEnd = body.indexOf(delimiter, metadataStart)
          const mediaStart = body.indexOf('\r\n\r\n', metadataEnd) + 4
          const mediaEnd = body.indexOf(delimiter, mediaStart)
          if (metadataStart < 4 || metadataEnd < 0 || mediaStart < 4 || mediaEnd < 0) throw new Error('Invalid multipart upload')
          metadata = JSON.parse(body.subarray(metadataStart, metadataEnd).toString('utf8')) as RemoteFile
          content = body.subarray(mediaStart, mediaEnd)
        } else metadata = JSON.parse(body.toString('utf8')) as RemoteFile
        if (files.has(metadata.id)) {
          await json({ error: { code: 409 } }, 409)
          return
        }
        metadata = {
          ...metadata, createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, files.size)).toISOString(),
          size: String(content.length), trashed: false,
        }
        files.set(metadata.id, { metadata, content })
        await json(metadata)
        return
      }
      if (request.method() === 'GET' && url.pathname === '/drive/v3/files') {
        const query = url.searchParams.get('q') ?? ''
        const properties = [...query.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)]
        const parent = query.match(/'([^']+)' in parents/)?.[1]
        const mime = query.match(/mimeType = '([^']+)'/)?.[1]
        await json({ files: [...files.values()].map(file => file.metadata).filter(file =>
          !file.trashed && properties.every(([, key, value]) => file.appProperties?.[key] === value)
          && (!parent || file.parents?.includes(parent)) && (!mime || file.mimeType === mime)),
        })
        return
      }
      const id = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1]
      if (request.method() === 'PATCH' && id) {
        const file = files.get(decodeURIComponent(id))
        if (!file) { await json({ error: { code: 404 } }, 404); return }
        const body = request.postDataJSON() as { name: string }
        file.metadata.name = body.name
        await json(file.metadata)
        return
      }
      if (request.method() === 'GET' && id) {
        const file = files.get(decodeURIComponent(id))
        if (!file) { await json({ error: { code: 404 } }, 404); return }
        if (url.searchParams.get('alt') === 'media') {
          mediaReads++
          await route.fulfill({ headers, contentType: file.metadata.mimeType, body: file.content })
        } else await json(file.metadata)
        return
      }
      throw new Error(`Unexpected Drive request: ${request.method()} ${url.pathname}`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      await json({ error: { code: 400, message: 'E2E fixture rejected the request' } }, 400)
    }
  })

  return {
    files, errors,
    latestRevision(): SavedRevision | undefined {
      const latest = [...files.values()].filter(file => file.metadata.appProperties?.kind === 'revision').at(-1)
      return latest ? JSON.parse(latest.content.toString('utf8')) as SavedRevision : undefined
    },
    expireAccessTokens() { for (const token of observedTokens) expiredTokens.add(token) },
    get unauthorizedRequests() { return unauthorizedRequests },
    get mediaReads() { return mediaReads },
    oauthRequests: () => page.evaluate(() => Reflect.get(window, '__driveOAuthRequests') as number),
    oauthActivations: () => page.evaluate(() => Reflect.get(window, '__driveOAuthActivations') as boolean[]),
  }
}
