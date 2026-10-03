import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'family-tree-pwa-'))
const versions = ['v1', 'v2'] as const
type Version = typeof versions[number]
let currentVersion: Version = 'v1'
let failIndex = false

try {
  for (const version of versions) {
    await build({
      configFile: path.join(projectRoot, 'vite.config.ts'),
      root: projectRoot,
      logLevel: 'warn',
      plugins: [{
        name: 'pwa-test-build-version',
        // The real Workbox plugin hashes this changed HTML and produces two
        // distinct workers. Neither production source nor worker logic is patched.
        transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'pwa-test-version', content: version }, injectTo: 'head' }],
      }],
      build: { outDir: path.join(temporaryRoot, version), emptyOutDir: true },
    })
  }
} catch (error) {
  await rm(temporaryRoot, { recursive: true, force: true })
  throw error
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const name = `${prefix}${entry.name}`
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), `${name}/`) : [name]
  }))
  return files.flat().sort()
}

const builtFiles = await listFiles(path.join(temporaryRoot, 'v1'))
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1:4178')
    if (url.pathname === '/__pwa_test__/health') {
      response.end('ready')
      return
    }
    if (url.pathname === '/__pwa_test__/files') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(builtFiles))
      return
    }
    if (url.pathname === '/__pwa_test__/deploy' && request.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const deployment: unknown = JSON.parse(Buffer.concat(chunks).toString())
      if (!deployment || typeof deployment !== 'object' || !('version' in deployment)
        || !versions.some(version => version === deployment.version)) {
        response.writeHead(400).end('Unknown build')
        return
      }
      currentVersion = deployment.version as Version
      failIndex = 'failIndex' in deployment && deployment.failIndex === true
      response.end('deployed')
      return
    }
    const mount = url.pathname.startsWith('/family-tree/') ? '/family-tree/' : '/'
    const relative = decodeURIComponent(url.pathname.slice(mount.length)) || 'index.html'
    const root = path.join(temporaryRoot, currentVersion)
    const filename = path.resolve(root, relative)
    if (!filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end()
      return
    }
    if (failIndex && relative === 'index.html') {
      response.writeHead(503).end('Simulated incomplete deployment')
      return
    }
    const contents = await readFile(filename)
    response.setHeader('Content-Type', mimeTypes[path.extname(filename)] || 'application/octet-stream')
    response.end(contents)
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    response.writeHead(missing ? 404 : 500).end()
  }
})

server.listen(4178, '127.0.0.1')
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.closeAllConnections()
  server.close(() => {
    void rm(temporaryRoot, { recursive: true, force: true }).finally(() => process.exit(0))
  })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
