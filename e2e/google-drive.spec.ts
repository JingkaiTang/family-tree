import { expect, test, type Page } from '@playwright/test'
import { installGoogleDrive } from './helpers/googleDrive'

const projectName = '跨设备测试家族'
const errorsByPage = new WeakMap<Page, string[]>()

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test.beforeEach(({ page }) => {
  const errors: string[] = []
  errorsByPage.set(page, errors)
  page.on('pageerror', error => errors.push(error.stack || error.message))
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = errorsByPage.get(page) || []
  if (errors.length) await testInfo.attach('browser-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
  expect(errors, 'The Drive Web app must run without page errors').toEqual([])
})

async function createDriveProject(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建家族', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '连接 Google Drive', exact: true }).click()
  await page.getByRole('textbox', { name: 'Google Drive 家族名称', exact: true }).fill(projectName)
  await page.getByRole('button', { name: '在 Drive 新建', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await expect(page.getByTestId('focus-flow-view')).toBeVisible()
}

async function editMember(page: Page, withPhoto: boolean) {
  await page.getByRole('button', { name: '+ 新建成员', exact: true }).click()
  await page.getByLabel('姓', { exact: true }).fill('林')
  await page.getByLabel('名', { exact: true }).fill('云端')
  await page.getByLabel('备注（支持多行）', { exact: true }).fill('虚构测试资料，保存在个人 Drive')
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
      name: 'synthetic-drive-photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
    })
    await expect(page.locator('.vue-advanced-cropper__image')).toBeVisible()
    await page.getByRole('button', { name: '确认裁剪', exact: true }).click()
    await expect(page.getByRole('img', { name: '头像', exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
}

test('mobile Web creates a Drive family with private WebP photos and explicitly reconnects after reload without directory APIs', async ({ page }) => {
  const drive = await installGoogleDrive(page)
  await createDriveProject(page)
  expect(await drive.oauthRequests()).toBe(1)
  expect(await drive.oauthActivations()).toEqual([true])
  await editMember(page, true)
  await expect.poll(() => Object.values(drive.latestRevision()?.family.members ?? {})[0]?.firstName).toBe('云端')
  const saved = drive.latestRevision()!.family
  const member = Object.values(saved.members)[0]
  expect(member).toMatchObject({ lastName: '林', notes: '虚构测试资料，保存在个人 Drive', photoId: expect.any(String) })
  const media = [...drive.files.values()].filter(file => file.metadata.mimeType === 'image/webp')
  expect(media).toHaveLength(2)
  for (const file of media) {
    expect(file.metadata.appProperties?.photoId).toBe(member.photoId)
    expect(file.content.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(file.content.subarray(8, 12).toString('ascii')).toBe('WEBP')
  }
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('林云端', { exact: true })).toBeVisible()
  const readCount = drive.mediaReads
  await page.reload()
  await expect(page.getByRole('heading', { name: '家族树', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '连接 Google Drive', exact: true })).toBeEnabled()
  expect(await drive.oauthRequests()).toBe(0)
  // A recent project never opens an OAuth popup until the user asks for it.
  await page.getByRole('button', { name: projectName, exact: true }).click()
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await expect(page.getByText('林云端', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.getByRole('img', { name: '头像', exact: true })).toBeVisible()
  await expect.poll(() => page.getByRole('img', { name: '头像', exact: true }).evaluate(image =>
    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
  expect(drive.mediaReads).toBeGreaterThan(readCount)
  expect(drive.latestRevision()!.family).toEqual(saved)
  expect(await drive.oauthRequests()).toBe(1)
  const stored = await page.evaluate(() => ({
    project: JSON.parse(localStorage.getItem('family-tree:lastProjectRef')!),
    browserStorage: JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  }))
  expect(stored.project.providerId).toBe('google-drive:e2e-public.apps.googleusercontent.com:e2e-account')
  expect(stored.browserStorage).not.toContain('e2e-access-token-')
  expect(drive.errors).toEqual([])
})

test('401 stops background saving without an OAuth popup and explicit reconnect preserves the pending edits', async ({ page }) => {
  const drive = await installGoogleDrive(page)
  await createDriveProject(page)
  await editMember(page, false)
  await expect.poll(() => Object.values(drive.latestRevision()?.family.members ?? {})[0]?.firstName).toBe('云端')
  const original = drive.latestRevision()!.family
  drive.expireAccessTokens()
  await page.getByLabel('备注（支持多行）', { exact: true }).fill('授权过期期间的编辑仍需保留')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const status = page.getByRole('complementary', { name: 'Google Drive 保存状态', exact: true })
  await expect(status.getByRole('alert')).toBeVisible()
  expect(drive.unauthorizedRequests).toBeGreaterThan(0)
  expect(await drive.oauthRequests()).toBe(1)
  expect(drive.latestRevision()!.family).toEqual(original)
  await expect(page.getByLabel('备注（支持多行）', { exact: true })).toHaveValue('授权过期期间的编辑仍需保留')
  await status.getByRole('button', { name: '重新连接并保存', exact: true }).click()
  await expect.poll(() => Object.values(drive.latestRevision()?.family.members ?? {})[0]?.notes).toBe('授权过期期间的编辑仍需保留')
  expect(await drive.oauthRequests()).toBe(2)
  expect(await drive.oauthActivations()).toEqual([true, true])
  await expect(status.getByRole('alert')).toHaveCount(0)
  expect(drive.errors).toEqual([])
})
