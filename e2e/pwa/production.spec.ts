import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { LayoutWorkerResponse } from '../../src/core/treeLayoutProtocol'

const directoryName = 'pwa-test-family'
const updateMessage = '新版已准备好。保存并关闭所有家族树窗口后，重新打开即可更新。'
const errors: string[] = []

async function deploy(request: APIRequestContext, version: 'v1' | 'v2', failIndex = false) {
  const response = await request.post('/__pwa_test__/deploy', { data: { version, failIndex } })
  expect(response.ok()).toBe(true)
}

test.beforeEach(async ({ context, page, request }) => {
  errors.length = 0
  const observe = (observed: Page) => observed.on('pageerror', error => errors.push(error.stack || error.message))
  observe(page)
  context.on('page', observe)
  await deploy(request, 'v1')
})

test.afterEach(async ({}, testInfo) => {
  if (errors.length) await testInfo.attach('browser-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
  expect(errors, 'Production pages must run without uncaught errors').toEqual([])
})

async function installDirectoryPicker(page: Page, name = directoryName) {
  // Only the OS chooser is replaced. IO and persisted handles use Chromium's
  // real OPFS implementation; ordinary-folder permissions need manual testing.
  await page.addInitScript(name => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true }),
    })
  }, name)
}

async function readFamily(page: Page, name = directoryName) {
  return page.evaluate(async name => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    return JSON.parse(await (await (await directory.getFileHandle('family.json')).getFile()).text()) as {
      members: Record<string, { firstName: string; notes?: string; photoId?: string }>
    }
  }, name)
}

async function createFamily(page: Page, mount = '/', name = directoryName) {
  await installDirectoryPicker(page, name)
  await page.goto(mount)
  // Another tab may have remembered its project in origin-wide localStorage.
  if (name !== directoryName) {
    await expect(page.getByRole('heading', { name: directoryName, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
  }
  await page.getByRole('button', { name: '新建家族', exact: true }).click()
  await page.getByRole('button', { name: '加载示例（临时）', exact: true }).click()
  await expect(page.getByTestId('member-node')).toHaveCount(5)
  await expect.poll(async () => Object.keys((await readFamily(page, name)).members).length).toBe(5)
}

async function waitForActiveWorker(page: Page, mount: string) {
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe(mount)
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated')
}

async function expectVersion(page: Page, version: 'v1' | 'v2') {
  await expect(page.locator('meta[name="pwa-test-version"]')).toHaveAttribute('content', version)
}

for (const mount of ['/', '/family-tree/']) {
  test(`production ${mount} reopens offline with lazy pages, real layout Worker and directory photos`, async ({ page, context, request }) => {
    const builtFiles = await (await request.get('/__pwa_test__/files')).json() as string[]
    const onlinePageScripts: string[] = []
    page.on('request', request => {
      if (request.resourceType() === 'script') onlinePageScripts.push(request.url())
    })
    await createFamily(page, mount)
    await waitForActiveWorker(page, mount)
    await expectVersion(page, 'v1')
    // Never open MemberDetail online: its first application import must succeed
    // from the generated precache, rather than a previously visited page.
    expect(onlinePageScripts.some(url => /MemberDetail-.*\.js/.test(url))).toBe(false)

    await page.close()
    await context.setOffline(true)
    const offline = await context.newPage()
    await installDirectoryPicker(offline)
    // This is a pass-through listener on the real Worker, not a layout mock.
    // Observing its successful result prevents the synchronous fallback from
    // disguising an uncached or broken production Worker chunk.
    await offline.addInitScript(() => {
      window.Worker = new Proxy(window.Worker, {
        construct(Target, args: [string | URL, WorkerOptions?]) {
          const worker = new Target(...args)
          worker.addEventListener('message', (event: MessageEvent<LayoutWorkerResponse>) => {
            if (event.data.ok) document.documentElement.dataset.pwaLayoutCards = String(event.data.scene.cards.length)
          })
          return worker
        },
      })
    })
    const workerUrls: string[] = []
    offline.on('worker', worker => workerUrls.push(worker.url()))
    const navigation = await offline.goto(mount)
    expect(navigation?.fromServiceWorker()).toBe(true)
    await expect(offline.getByRole('heading', { name: directoryName, exact: true })).toBeVisible()
    await expect(offline.getByTestId('member-node')).toHaveCount(5)
    await expect(offline.locator('html'), 'The real Worker must return the layout; a synchronous fallback is insufficient')
      .toHaveAttribute('data-pwa-layout-cards', '5')
    expect(workerUrls.some(url => /\/assets\/treeLayout\.worker-.*\.js$/.test(url))).toBe(true)

    const lazyPage = offline.waitForResponse(response => /\/assets\/MemberDetail-.*\.js$/.test(response.url()))
    await offline.getByRole('button', { name: '+ 新建成员', exact: true }).click()
    expect((await lazyPage).fromServiceWorker()).toBe(true)
    await offline.getByLabel('姓', { exact: true }).fill('林')
    await offline.getByLabel('名', { exact: true }).fill('离线测试')
    const image = await offline.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 128
      const context = canvas.getContext('2d')!
      context.fillStyle = '#2478ad'
      context.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await offline.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'fictional-photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
    })
    await expect(offline.locator('.vue-advanced-cropper__image')).toBeVisible()
    await offline.getByRole('button', { name: '确认裁剪', exact: true }).click()
    await expect(offline.getByRole('img', { name: '头像', exact: true })).toBeVisible()
    await offline.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => Object.values((await readFamily(offline)).members)
      .find(member => member.firstName === '离线测试')?.photoId).toEqual(expect.any(String))
    await offline.reload()
    await expect(offline.getByText('林离线测试', { exact: true })).toBeVisible()
    const photo = offline.getByTestId('member-node').filter({ hasText: '林离线测试' }).getByTestId('member-photo').locator('img')
    await expect(photo).toBeVisible()
    await expect.poll(() => photo.evaluate(image => image instanceof HTMLImageElement && image.naturalWidth)).toBeGreaterThan(0)

    const cachedUrls = await offline.evaluate(async () => {
      const entries = await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))
      return entries.flat()
    })
    expect(cachedUrls.length).toBeGreaterThan(0)
    for (const cachedUrl of cachedUrls) {
      const url = new URL(cachedUrl)
      expect(url.origin).toBe('http://127.0.0.1:4178')
      expect(url.pathname.startsWith(mount)).toBe(true)
      expect(builtFiles).toContain(url.pathname.slice(mount.length))
      expect(url.pathname).not.toMatch(/family\.json|meta\.json|\/media\/|\.webp$/)
    }
  })
}

test('a real update waits for every editing tab without replacing drafts or reloading', async ({ page, context, request }) => {
  await createFamily(page)
  await waitForActiveWorker(page, '/')
  await page.reload()
  await page.getByTestId('member-node').first().dblclick()
  const notes = page.getByLabel('备注（支持多行）', { exact: true })
  await notes.fill('第一窗口尚未保存的虚构备注')
  await page.evaluate(() => { document.documentElement.dataset.pwaInstance = 'first-editor' })

  const second = await context.newPage()
  const secondDirectory = 'pwa-second-family'
  await createFamily(second, '/', secondDirectory)
  await second.getByTestId('member-node').first().dblclick()
  const secondNotes = second.getByLabel('备注（支持多行）', { exact: true })
  await secondNotes.fill('第二窗口尚未保存的虚构备注')
  await second.evaluate(() => { document.documentElement.dataset.pwaInstance = 'second-editor' })
  expect(await second.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await deploy(request, 'v2')
  const [waitingWorker] = await Promise.all([
    context.waitForEvent('serviceworker'),
    second.evaluate(async () => { await (await navigator.serviceWorker.ready).update() }),
  ])
  await expect.poll(() => second.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed')
  for (const [editor, instance, draft] of [
    [page, 'first-editor', '第一窗口尚未保存的虚构备注'],
    [second, 'second-editor', '第二窗口尚未保存的虚构备注'],
  ] as const) {
    await expect(editor.getByText(updateMessage, { exact: true })).toBeVisible()
    await expectVersion(editor, 'v1')
    await expect(editor.locator('html')).toHaveAttribute('data-pwa-instance', instance)
    await expect(editor.getByLabel('备注（支持多行）', { exact: true })).toHaveValue(draft)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
  }
  await expect.poll(async () => Object.values((await readFamily(page)).members).some(member => member.notes === '第一窗口尚未保存的虚构备注')).toBe(true)
  await expect.poll(async () => Object.values((await readFamily(second, secondDirectory)).members).some(member => member.notes === '第二窗口尚未保存的虚构备注')).toBe(true)

  await page.close()
  expect(await second.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed')
  await expect(secondNotes).toHaveValue('第二窗口尚未保存的虚构备注')
  await expect(second.locator('html')).toHaveAttribute('data-pwa-instance', 'second-editor')
  await second.close()
  await expect.poll(() => waitingWorker.evaluate(() => {
    const registration = Reflect.get(self, 'registration') as ServiceWorkerRegistration
    return registration.active?.state === 'activated' && !registration.waiting
  })).toBe(true)

  const reopened = await context.newPage()
  await installDirectoryPicker(reopened, secondDirectory)
  const navigation = await reopened.goto('/')
  expect(navigation?.fromServiceWorker()).toBe(true)
  await expectVersion(reopened, 'v2')
  await expect(reopened.getByRole('heading', { name: secondDirectory, exact: true })).toBeVisible()
  expect(Object.values((await readFamily(reopened, secondDirectory)).members).some(member => member.notes === '第二窗口尚未保存的虚构备注')).toBe(true)
})

test('a failed update precache leaves the previous version and project usable offline', async ({ page, context, request }) => {
  await createFamily(page)
  await waitForActiveWorker(page, '/')
  await page.reload()
  await expect(page.getByRole('heading', { name: directoryName, exact: true })).toBeVisible()
  await deploy(request, 'v2', true)
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const installed = new Promise<ServiceWorkerState>(resolve => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing!
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'redundant') resolve(worker.state)
        })
      }, { once: true })
    })
    await registration.update()
    return installed
  })
  expect(state).toBe('redundant')
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting)).toBeNull()
  await expect(page.getByText(updateMessage, { exact: true })).toHaveCount(0)
  await page.close()
  await context.setOffline(true)
  const reopened = await context.newPage()
  await installDirectoryPicker(reopened)
  const navigation = await reopened.goto('/')
  expect(navigation?.fromServiceWorker()).toBe(true)
  await expectVersion(reopened, 'v1')
  await expect(reopened.getByTestId('member-node')).toHaveCount(5)
  expect(Object.keys((await readFamily(reopened)).members)).toHaveLength(5)
})
