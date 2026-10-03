import { expect, test, type Page } from '@playwright/test'
import { installGoogleIdentity } from './helpers/googleDrive'

const directoryName = 'browser-test-family'
const errorsByPage = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  errorsByPage.set(page, errors)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  // The test server enables optional Drive; local storage tests stay independent of Google.
  await installGoogleIdentity(page)
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = errorsByPage.get(page) || []
  if (errors.length) {
    await testInfo.attach('browser-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
  }
  expect(errors, 'The Web app must run without page errors').toEqual([])
})

/**
 * Headless Chromium cannot operate the OS directory chooser. Only that chooser
 * is substituted here. The returned OPFS handle is a REAL FileSystemDirectoryHandle,
 * exercising Chromium's createWritable, locks, Blob IO and IndexedDB structured
 * cloning across reloads. Production never uses OPFS or this test helper.
 * External-folder OS permissions and Android document providers require manual QA.
 */
async function installDirectoryPicker(page: Page) {
  await page.addInitScript(({ name }) => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        const count = Number(sessionStorage.getItem('e2e:picker-count') || '0')
        sessionStorage.setItem('e2e:picker-count', String(count + 1))
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle(name, { create: true })
      },
    })
  }, { name: directoryName })
}

async function readFamily(page: Page, name = directoryName) {
  return page.evaluate(async name => {
    const root = await navigator.storage.getDirectory()
    const project = await root.getDirectoryHandle(name)
    const file = await (await project.getFileHandle('family.json')).getFile()
    return JSON.parse(await file.text()) as { members: Record<string, { firstName: string; lastName: string; notes?: string; photoId?: string }> }
  }, name)
}

async function createAndSaveMember(page: Page, withPhoto = false) {
  await installDirectoryPicker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '新建家族', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
  await page.getByRole('button', { name: '+ 新建成员', exact: true }).click()
  await page.getByLabel('姓', { exact: true }).fill('林')
  await page.getByLabel('名', { exact: true }).fill('测试')
  await page.getByLabel('备注（支持多行）', { exact: true }).fill('仅用于自动化验证的虚构成员\n浏览器目录持久化')

  if (withPhoto) {
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 400
      const context = canvas.getContext('2d')!
      context.fillStyle = '#3a87c9'
      context.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'synthetic-photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
    })
    // Wait for the cropper's image to finish loading before confirming its canvas.
    await expect(page.locator('.vue-advanced-cropper__image')).toBeVisible()
    await page.getByRole('button', { name: '确认裁剪', exact: true }).click()
    await expect(page.getByRole('img', { name: '头像', exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => Object.values((await readFamily(page)).members)[0]?.firstName).toBe('测试')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
}

test('desktop Web saves family and WebP media in a real directory, then restores its IndexedDB handle after reload', async ({ page }) => {
  await createAndSaveMember(page, true)
  await expect(page.getByTestId('layout-mode-select').locator('option:checked')).toHaveText('自动（网格）')
  await expect(page.locator('.pz-stage')).toBeVisible()
  await expect(page.getByTestId('focus-flow-view')).toHaveCount(0)
  const saved = await readFamily(page)
  const member = Object.values(saved.members)[0]
  expect(member).toMatchObject({ lastName: '林', firstName: '测试', notes: '仅用于自动化验证的虚构成员\n浏览器目录持久化' })
  expect(member.photoId).toEqual(expect.any(String))

  const files = await page.evaluate(async ({ name, photoId }) => {
    const project = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    const media = await project.getDirectoryHandle('media')
    const photos = await media.getDirectoryHandle('photos')
    const thumbs = await media.getDirectoryHandle('thumbs')
    const inspect = async (directory: FileSystemDirectoryHandle) => {
      const file = await (await directory.getFileHandle(`${photoId}.webp`)).getFile()
      const bitmap = await createImageBitmap(file)
      try {
        return { width: bitmap.width, height: bitmap.height, signature: Array.from(new Uint8Array(await file.slice(0, 12).arrayBuffer())) }
      } finally { bitmap.close() }
    }
    return {
      photo: await inspect(photos), thumbnail: await inspect(thumbs),
      backup: (await (await project.getFileHandle('family.json.bak.1')).getFile()).size,
    }
  }, { name: directoryName, photoId: member.photoId! })
  // The cropper starts with an inset selection; assert its 3:4 aspect ratio,
  // valid decoded pixels and no upscaling rather than its internal default inset.
  expect(files.photo.width).toBeGreaterThan(0)
  expect(files.photo.height).toBeLessThanOrEqual(400)
  expect(files.photo.width * 4).toBe(files.photo.height * 3)
  expect(files.thumbnail).toMatchObject({ width: 192, height: 256 })
  expect(files.photo.signature.slice(0, 4)).toEqual([82, 73, 70, 70])
  expect(files.photo.signature.slice(8)).toEqual([87, 69, 66, 80])
  expect(files.backup).toBeGreaterThan(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
  await expect(page.getByText('林测试', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e:picker-count'))).toBe('1')
  expect(await readFamily(page)).toEqual(saved)
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('family-tree:lastProjectRef')!))
  expect(project.providerId).toBe('browser-directory')
})

test('exports a real familybundle stream and imports its family and photos into a different directory', async ({ page }) => {
  await createAndSaveMember(page, true)
  const original = await readFamily(page)
  const originalRef = await page.evaluate(() => JSON.parse(localStorage.getItem('family-tree:lastProjectRef')!))
  const backupName = 'roundtrip.familybundle'
  const importedDirectory = 'browser-imported-family'
  await page.evaluate(name => {
    // The OS save chooser is replaced; the destination and output stream are real.
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('e2e:export-user-activation', String(navigator.userActivation.isActive))
        return (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
      },
    })
  }, backupName)
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await expect(page.getByText('家族备份已导出', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:export-user-activation'))).toBe('true')
  const archive = await page.evaluate(async name => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile()
    return Array.from(new Uint8Array(await file.arrayBuffer()))
  }, backupName)
  expect(archive.slice(0, 4)).toEqual([80, 75, 3, 4])
  expect(archive.length).toBeGreaterThan(100)

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '家族树', exact: true })).toBeVisible()
  await page.evaluate(name => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('e2e:import-user-activation', String(navigator.userActivation.isActive))
        return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
      },
    })
  }, importedDirectory)
  await page.getByLabel('选择家族备份文件', { exact: true }).setInputFiles({
    name: backupName, mimeType: 'application/zip', buffer: Buffer.from(archive),
  })
  await expect(page.getByText(`已选择：${backupName}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择空文件夹并导入', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
  await expect(page.getByText('林测试', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:import-user-activation'))).toBe('true')
  expect(await readFamily(page, importedDirectory)).toEqual(original)
  const importedRef = await page.evaluate(() => JSON.parse(localStorage.getItem('family-tree:lastProjectRef')!))
  expect(importedRef.providerId).toBe('browser-directory')
  expect(importedRef.id).not.toBe(originalRef.id)

  const media = await page.evaluate(async ({ source, target, photoId }) => {
    const root = await navigator.storage.getDirectory()
    const inspect = async (name: string, kind: 'photos' | 'thumbs') => {
      const directory = await (await (await root.getDirectoryHandle(name)).getDirectoryHandle('media')).getDirectoryHandle(kind)
      const file = await (await directory.getFileHandle(`${photoId}.webp`)).getFile()
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
      const bitmap = await createImageBitmap(file)
      try { return { digest, width: bitmap.width, height: bitmap.height } }
      finally { bitmap.close() }
    }
    return {
      sourcePhoto: await inspect(source, 'photos'), importedPhoto: await inspect(target, 'photos'),
      sourceThumb: await inspect(source, 'thumbs'), importedThumb: await inspect(target, 'thumbs'),
    }
  }, { source: directoryName, target: importedDirectory, photoId: Object.values(original.members)[0].photoId! })
  expect(media.importedPhoto).toEqual(media.sourcePhoto)
  expect(media.importedThumb).toEqual(media.sourceThumb)
  expect(media.importedPhoto.width).toBeGreaterThan(0)
})

test('browser Back flushes pending changes before leaving the project and reopening it', async ({ page }) => {
  await installDirectoryPicker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '新建家族', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  expect(Object.keys((await readFamily(page)).members)).toHaveLength(0)
  // Leave immediately, while the regular 800 ms autosave debounce is pending.
  await page.getByRole('button', { name: '加载示例（临时）', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { name: '家族树', exact: true })).toBeVisible()
  expect(Object.keys((await readFamily(page)).members)).toHaveLength(5)
  await page.getByRole('button', { name: '打开已有家族', exact: true }).click()
  await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
  await expect(page.getByText('成员：5', { exact: true })).toBeVisible()
})

test.describe('narrow touch Web', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('shows half siblings and keeps automatic kinship distinct from a saved custom label', async ({ page }) => {
    await installDirectoryPicker(page)
    await page.goto('/')
    await page.getByRole('button', { name: '新建家族', exact: true }).click()
    await expect(page).toHaveURL(/#\/tree$/)
    await page.evaluate(async () => {
      const { multiUnionFamily } = await import('/src/__tests__/fixtures/families.ts')
      const { createEmptyFamily } = await import('/src/core/schema.ts')
      const { useFamilyStore } = await import('/src/stores/family.ts')
      const { useUiStore } = await import('/src/stores/ui.ts')
      const family = useFamilyStore()
      const members = multiUnionFamily()
      members.parentA.firstName = '父亲测试'
      members.childAB1.firstName = '视角成员'
      members.childAC.firstName = '异母弟弟测试'
      family.setProject(family.projectRef!, family.projectMeta!, {
        ...createEmptyFamily(), members,
        rootMemberId: 'childAB1', defaultViewpointId: 'childAB1',
      })
      family.markDirty()
      const ui = useUiStore()
      ui.setViewpoint('childAB1')
      ui.setLayoutFocus('childAB1')
    })

    await expect(page.getByTestId('focus-flow-section-siblings')
      .getByText('异母弟弟测试', { exact: true })).toBeVisible()
    const parentCard = page.getByTestId('focus-flow-section-parents')
      .getByTestId('focus-member-card').filter({ hasText: '父亲测试' })
    await parentCard.getByRole('button', { name: '详情', exact: true }).click()
    await expect(page.getByText('自动推算：父亲', { exact: true })).toBeVisible()
    await page.getByPlaceholder('例如：二叔 / 表姨婆').fill('老爸')
    await page.getByRole('button', { name: '保存覆盖', exact: true }).click()
    await expect(page.getByText('自动推算：父亲', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(parentCard.getByText('老爸', { exact: true })).toBeVisible()
    await expect(page.getByText('已保存', { exact: true })).toBeVisible()

    await page.reload()
    await expect(parentCard.getByText('老爸', { exact: true })).toBeVisible()
    await expect(page.getByTestId('focus-flow-section-siblings')
      .getByText('异母弟弟测试', { exact: true })).toBeVisible()
    await parentCard.getByRole('button', { name: '详情', exact: true }).click()
    await expect(page.getByText('自动推算：父亲', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('例如：二叔 / 表姨婆')).toHaveValue('老爸')
  })

  test('uses directory storage and the compact layout in the browser or user-agent gate', async ({ page }) => {
    await createAndSaveMember(page)
    await expect(page.getByTestId('layout-mode-select')).toHaveValue('auto')
    await expect(page.getByTestId('layout-mode-select').locator('option:checked')).toHaveText('自动（纵流）')
    await expect(page.getByTestId('focus-flow-view')).toBeVisible()
    await expect(page.locator('.pz-stage')).toHaveCount(0)
    await expect(page.getByText('林测试', { exact: true })).toBeVisible()
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }))
    expect(width.content).toBeLessThanOrEqual(width.viewport)
    await page.getByRole('button', { name: '详情', exact: true }).click()
    await expect(page.locator('main')).toHaveCSS('flex-direction', 'column')
    await expect(page.getByRole('heading', { name: '家庭关系', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()

    await page.setViewportSize({ width: 1180, height: 600 })
    await expect(page.getByTestId('layout-mode-select').locator('option:checked')).toHaveText('自动（纵流）')
    await expect(page.getByTestId('focus-flow-view')).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('button', { name: '打开已有家族', exact: true }).click()
    await expect(page.getByTestId('layout-mode-select').locator('option:checked')).toHaveText('自动（纵流）')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
    await expect(page.getByText('林测试', { exact: true })).toBeVisible()
    expect(Object.values((await readFamily(page)).members)[0].lastName).toBe('林')
  })
})

test('a narrow desktop window reuses the client grid and preserves an explicit layout choice across reloads', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  await createAndSaveMember(page)
  const layout = page.getByTestId('layout-mode-select')
  await expect(layout.locator('option:checked')).toHaveText('自动（网格）')
  await expect(page.locator('.pz-stage')).toBeVisible()
  await expect(page.getByTestId('focus-flow-view')).toHaveCount(0)

  await layout.selectOption('focus-flow')
  await expect(page.getByTestId('focus-flow-view')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(layout).toHaveValue('focus-flow')
  await page.reload()
  await expect(layout).toHaveValue('focus-flow')
  await expect(page.getByTestId('focus-flow-view')).toBeVisible()

  await page.getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.locator('main')).toHaveCSS('flex-direction', 'row')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await layout.selectOption('auto')
  await expect(layout.locator('option:checked')).toHaveText('自动（网格）')
  await expect(page.locator('.pz-stage')).toBeVisible()
})

test('cancelling the directory picker keeps Welcome usable without creating a project', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => { throw new DOMException('User cancelled the picker', 'AbortError') },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建家族', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建家族', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: '家族树', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('family-tree:lastProjectRef'))).toBeNull()
  await expect(page.getByText(/操作失败|User cancelled|AbortError/)).toHaveCount(0)
})

test('expired permission restores only after an explicit user action, using the cloned directory handle', async ({ page }) => {
  // OPFS always grants permission; model only the external-directory permission
  // state here while retaining real handles, persistence and file operations.
  await page.addInitScript(() => {
    Object.defineProperty(FileSystemHandle.prototype, 'queryPermission', {
      configurable: true,
      value: async () => sessionStorage.getItem('e2e:permission') === 'prompt' ? 'prompt' : 'granted',
    })
    Object.defineProperty(FileSystemHandle.prototype, 'requestPermission', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('e2e:permission-requests', String(Number(sessionStorage.getItem('e2e:permission-requests') || '0') + 1))
        sessionStorage.setItem('e2e:permission', 'granted')
        return 'granted'
      },
    })
  })
  await createAndSaveMember(page)
  await page.evaluate(() => sessionStorage.setItem('e2e:permission', 'prompt'))
  await page.reload()
  await expect(page.getByText(/需要重新授权此目录/)).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:permission-requests'))).toBeNull()
  await page.getByRole('button', { name: directoryName, exact: true }).click()
  await expect(page.getByRole('heading', { name: directoryName })).toBeVisible()
  await expect(page.getByText('林测试', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:permission-requests'))).toBe('1')
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:picker-count'))).toBe('1')
})

test('a missing directory API explains the requirement and disables project actions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('不支持本地目录 API')
  await expect(page.getByRole('button', { name: '新建家族', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '打开已有家族', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('family-tree:lastProjectRef'))).toBeNull()
})

test('real Chromium decodes PNG, JPEG and WebP and generates correctly sized WebP photos', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { prepareBrowserPhoto } = await import('/src/services/storage/browserPhotos.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 2800
    canvas.height = 2100
    const context = canvas.getContext('2d')!
    context.fillStyle = '#cf3020'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const result = []
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      const input = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), mime))
      if (input.type !== mime) throw new Error(`Browser fixture encoding failed: ${mime}`)
      const output = await prepareBrowserPhoto(new Uint8Array(await input.arrayBuffer()), mime)
      const inspect = async (blob: Blob) => {
        const image = await createImageBitmap(blob)
        try {
          return { type: blob.type, width: image.width, height: image.height, size: blob.size }
        } finally { image.close() }
      }
      result.push({ input: mime, photo: await inspect(output.photo), thumbnail: await inspect(output.thumbnail) })
    }
    canvas.width = 0
    canvas.height = 0
    return result
  })
  expect(results).toHaveLength(3)
  for (const result of results) {
    expect(result.photo).toMatchObject({ type: 'image/webp', width: 1600, height: 1200 })
    expect(result.thumbnail).toMatchObject({ type: 'image/webp', width: 256, height: 192 })
    expect(result.photo.size).toBeGreaterThan(0)
    expect(result.thumbnail.size).toBeGreaterThan(0)
  }
})
