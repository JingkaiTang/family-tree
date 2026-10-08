import { expect, test, type Page } from '@playwright/test'
import { installGoogleIdentity } from './helpers/googleDrive'

const directoryName = 'member-editing-e2e'
const errorsByPage = new WeakMap<Page, string[]>()
interface SavedFamily {
  members: Record<string, {
    firstName: string
    lastName: string
    occupation?: string
    parents: Array<{ id: string; type: string }>
    children: Array<{ id: string; type: string }>
  }>
  rootMemberId?: string
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  errorsByPage.set(page, errors)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await installGoogleIdentity(page)
  await page.addInitScript(name => {
    // Replace only the OS chooser; storage uses real OPFS files and handles.
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name),
    })
  }, directoryName)
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = errorsByPage.get(page) || []
  if (errors.length) await testInfo.attach('browser-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
  expect(errors, 'Member editing must not cause browser exceptions').toEqual([])
})

async function openProject(page: Page, empty = false) {
  await page.goto('/')
  await page.evaluate(async ({ name, empty }) => {
    const { mk, addParent, addSpouse } = await import('/src/__tests__/fixtures/families.ts')
    const { createEmptyFamily, createEmptyMeta } = await import('/src/core/schema.ts')
    const family = createEmptyFamily()
    if (!empty) {
      const self = mk('self', { firstName: '知夏', lastName: '林' })
      const father = mk('father', { firstName: '景和', lastName: '林' })
      const mother = mk('mother', { firstName: '兰', lastName: '许' })
      addSpouse(father, mother)
      addParent(self, father)
      addParent(self, mother)
      family.members = { self, father, mother }
      family.rootMemberId = 'self'
      family.defaultViewpointId = 'self'
    }
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
    for (const [fileName, content] of [['family.json', family], ['meta.json', createEmptyMeta('成员编辑回归家族')]] as const) {
      const writer = await (await directory.getFileHandle(fileName, { create: true })).createWritable()
      await writer.write(JSON.stringify(content))
      await writer.close()
    }
  }, { name: directoryName, empty })
  await page.getByRole('button', { name: '打开已有家族', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
}

async function readFamily(page: Page): Promise<SavedFamily> {
  return page.evaluate(async name => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    const file = await (await directory.getFileHandle('family.json')).getFile()
    return JSON.parse(await file.text())
  }, directoryName)
}

async function openSelf(page: Page) {
  await page.locator('[data-testid="member-node"][data-member-id="self"]').dblclick()
  await expect(page).toHaveURL(/#\/member\/self$/)
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('知夏')
}

test('saving personal details after removing a parent keeps both saved relationship directions consistent', async ({ page }) => {
  await openProject(page)
  await openSelf(page)
  await page.getByLabel('职业', { exact: true }).fill('教师')
  const fatherRow = page.locator('aside li').filter({ hasText: '林景和' })
  await fatherRow.getByRole('button', { name: '移除', exact: true }).click()
  await expect(fatherRow).toHaveCount(0)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(fatherRow, 'Saving personal fields must not resurrect the removed parent').toHaveCount(0)
  await expect.poll(async () => {
    const saved = await readFamily(page)
    return {
      occupation: saved.members.self.occupation,
      parents: saved.members.self.parents,
      fatherChildren: saved.members.father.children,
      motherChildren: saved.members.mother.children,
    }
  }).toEqual({
    occupation: '教师', parents: [{ id: 'mother', type: 'blood' }],
    fatherChildren: [], motherChildren: [{ id: 'self', type: 'blood' }],
  })
})

test('unsaved personal details show their state and let the user continue editing or discard on return', async ({ page }) => {
  await openProject(page)
  await openSelf(page)
  await page.getByLabel('名', { exact: true }).fill('知春')
  await expect(page.locator('header')).toContainText('未保存')
  expect((await readFamily(page)).members.self.firstName).toBe('知夏')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('有未保存修改')
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('知春')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await dialog.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  await openSelf(page)
  expect((await readFamily(page)).members.self.firstName).toBe('知夏')
})

test('browser Back uses the draft guard and keyboard Save and leave persists the edit before navigation', async ({ page }) => {
  await openProject(page)
  await openSelf(page)
  await page.getByLabel('名', { exact: true }).fill('知春')
  await page.goBack()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('有未保存修改')
  await dialog.getByRole('button', { name: '保存并离开', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/tree$/)
  await expect.poll(async () => (await readFamily(page)).members.self.firstName).toBe('知春')
  await page.locator('[data-testid="member-node"][data-member-id="self"]').dblclick()
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('知春')
  await expect(page.locator('header')).toContainText('已保存')
})

test('new-member cancellation leaves no records and the first save creates one root without leaving a draft history entry', async ({ page }) => {
  await openProject(page, true)
  const startNew = async () => {
    await page.getByRole('button', { name: '+ 新建成员', exact: true }).click()
    await expect(page).toHaveURL(/#\/members\/new$/)
  }
  const expectEmpty = async () => {
    await expect(page).toHaveURL(/#\/tree$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const saved = await readFamily(page)
    expect(saved.members).toEqual({})
    expect(saved.rootMemberId).toBeUndefined()
    await expect(page.getByTestId('member-node')).toHaveCount(0)
  }

  await startNew()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expectEmpty()

  await startNew()
  await page.getByLabel('名', { exact: true }).fill('明确取消的草稿')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expectEmpty()

  await startNew()
  await page.getByLabel('名', { exact: true }).fill('返回放弃的草稿')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  await expectEmpty()

  await startNew()
  await page.getByLabel('姓', { exact: true }).fill('林')
  await page.getByLabel('名', { exact: true }).fill('新枝')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/#\/member\/[^/]+$/)
  await expect.poll(async () => Object.keys((await readFamily(page)).members).length).toBe(1)
  const saved = await readFamily(page)
  const [id] = Object.keys(saved.members)
  expect(saved.members[id]).toMatchObject({ firstName: '新枝', lastName: '林', parents: [], children: [] })
  expect(saved.rootMemberId).toBe(id)
  await expect(page.locator('header')).toContainText('已保存')

  // Updating the newly saved member must not create a second record.
  await page.getByRole('button', { name: '保存', exact: true }).click()
  // Back is intentionally blocked while saving; wait for the full save to finish.
  await expect(page.locator('header')).toContainText('已保存')
  expect(Object.keys((await readFamily(page)).members)).toEqual([id])
  // The new route is replaced on save: Back should reach the tree directly.
  await page.goBack()
  await expect(page).toHaveURL(/#\/tree$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('member-node')).toHaveCount(1)
})
