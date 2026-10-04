import { expect, test, type Page } from '@playwright/test'
import { installGoogleIdentity } from './helpers/googleDrive'

const errorsByPage = new WeakMap<Page, string[]>()
const activeIds = ['gpa', 'gma', 'dad', 'mom', 'self', 'child', 'grandchild']
const mutedIds = ['brother', 'aunt', 'spouse', 'spouse-dad', 'spouse-mom', 'child-spouse']
const node = (page: Page, id: string) => page.locator(`[data-testid="member-node"][data-member-id="${id}"]`)

test.use({ viewport: { width: 1600, height: 1100 } })
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  errorsByPage.set(page, errors)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await installGoogleIdentity(page)
  // Substitute only the OS directory chooser. Read the actual project files via
  // the production directory provider, rather than injecting a live store.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('lineage-e2e'),
    })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mk, addParent, addSpouse } = await import('/src/__tests__/fixtures/families.ts')
    const { createEmptyFamily, createEmptyMeta } = await import('/src/core/schema.ts')
    const names: Record<string, string> = {
      gpa: '林远山', gma: '周静', dad: '林景和', mom: '许兰', aunt: '林景宁',
      self: '林知夏', brother: '林知秋', spouse: '陈书', 'spouse-dad': '陈远',
      'spouse-mom': '苏雨', child: '林予安', 'child-spouse': '赵宁', grandchild: '林星河',
    }
    const members = Object.fromEntries(Object.entries(names).map(([id, firstName]) => [id, mk(id, { firstName })]))
    for (const [a, b] of [['gpa', 'gma'], ['dad', 'mom'], ['self', 'spouse'], ['spouse-dad', 'spouse-mom'], ['child', 'child-spouse']]) {
      addSpouse(members[a], members[b])
    }
    for (const [child, parents] of [
      ['dad', ['gpa', 'gma']], ['aunt', ['gpa', 'gma']],
      ['self', ['dad', 'mom']], ['brother', ['dad', 'mom']],
      ['spouse', ['spouse-dad', 'spouse-mom']],
      ['child', ['self', 'spouse']], ['grandchild', ['child', 'child-spouse']],
    ] as const) for (const parent of parents) addParent(members[child], members[parent])
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle('lineage-e2e', { create: true })
    const data = { ...createEmptyFamily(), members, rootMemberId: 'self', defaultViewpointId: 'self' }
    for (const [name, value] of [['family.json', data], ['meta.json', createEmptyMeta('直系关系浏览器验证')]] as const) {
      const writer = await (await directory.getFileHandle(name, { create: true })).createWritable()
      await writer.write(JSON.stringify(value))
      await writer.close()
    }
  })
  await page.getByRole('button', { name: '打开已有家族', exact: true }).click()
  await expect(page).toHaveURL(/#\/tree$/)
  await expect(page.getByTestId('member-node')).toHaveCount(13)
  await expect(node(page, 'self')).toBeVisible()
  // Opening a saved viewpoint starts an animated pan. Finish that independent
  // transition before measuring whether hovering changes the layout.
  let previousTransform = ''
  let stableSamples = 0
  await expect.poll(async () => {
    const transform = await page.locator('.pz-stage').evaluate(element => getComputedStyle(element).transform)
    stableSamples = transform === previousTransform ? stableSamples + 1 : 0
    previousTransform = transform
    return stableSamples
  }, { intervals: [100] }).toBeGreaterThanOrEqual(3)
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = errorsByPage.get(page) || []
  if (errors.length) await testInfo.attach('browser-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
  expect(errors, 'The real tree must run without page exceptions').toEqual([])
})

async function expectSelfLineage(page: Page) {
  for (const id of activeIds) await expect(node(page, id), `${id} belongs to the direct lineage`).toHaveAttribute('data-lineage-state', 'active')
  for (const id of mutedIds) await expect(node(page, id), `${id} is collateral or related through marriage`).toHaveAttribute('data-lineage-state', 'muted')
  const routeChildren = await page.getByTestId('lineage-route').evaluateAll(paths => [...new Set(paths.map(path => path.getAttribute('data-child-person-id')))].sort())
  expect(routeChildren).toEqual(['child', 'dad', 'grandchild', 'self'])
  await expect(page.getByTestId('lineage-summary')).toContainText('祖先 4 人 · 后代 2 人')
}

async function blankPoint(page: Page) {
  return page.locator('.pz-stage').locator('..').evaluate(element => {
    const rect = element.getBoundingClientRect()
    for (const y of [rect.bottom - 100, rect.top + 160, rect.top + rect.height / 2]) {
      for (const x of [rect.left + 30, rect.right - 100, rect.left + rect.width / 2]) {
        const target = document.elementFromPoint(x, y)
        if (target && element.contains(target) && !target.closest('[data-testid="member-node"],button,[data-testid="lineage-summary"]')) return { x, y }
      }
    }
    throw new Error('No unobstructed canvas point found')
  })
}

test('hover previews complete direct ancestry and descendants without moving the tree; click locks and Escape/blank clear', async ({ page }) => {
  await page.mouse.move(10, 10)
  const positions = () => page.getByTestId('member-node').evaluateAll(nodes => nodes.map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-member-id'), x: rect.x, y: rect.y }
  }))
  const before = await positions()
  await node(page, 'self').hover()
  await expectSelfLineage(page)
  await expect(page.getByTestId('lineage-summary')).toContainText('预览')
  expect(await positions()).toEqual(before)
  await page.mouse.move(10, 10)
  await expect(page.getByTestId('lineage-summary')).toHaveCount(0)
  await node(page, 'self').click()
  await page.mouse.move(10, 10)
  await expectSelfLineage(page)
  await expect(page.getByTestId('lineage-summary')).toContainText('已锁定')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lineage-summary')).toHaveCount(0)
  await node(page, 'self').click()
  const blank = await blankPoint(page)
  await page.mouse.click(blank.x, blank.y)
  await expect(page.getByTestId('lineage-summary')).toHaveCount(0)
})

test('locked lineage survives canvas panning and stays readable after zooming', async ({ page }) => {
  await node(page, 'self').click()
  const stage = page.locator('.pz-stage')
  const transform = await stage.evaluate(element => getComputedStyle(element).transform)
  const blank = await blankPoint(page)
  await page.mouse.move(blank.x, blank.y)
  await page.mouse.down()
  await page.mouse.move(blank.x + 75, blank.y - 35, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => stage.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform)
  await expectSelfLineage(page)
  const screenStroke = () => page.getByTestId('lineage-route').first().evaluate(element => {
    const path = element as SVGPathElement
    const matrix = path.getScreenCTM()!
    return Number(path.getAttribute('stroke-width')) * Math.hypot(matrix.a, matrix.b)
  })
  const initialStroke = await screenStroke()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '−', exact: true }).click()
  await expect.poll(screenStroke).toBeCloseTo(initialStroke, 1)
  expect(await screenStroke()).toBeGreaterThanOrEqual(2.5)
  await expectSelfLineage(page)
  // The design compensates fully from 40% to 200%, then deliberately caps
  // compensation so closely spaced routes do not merge at the minimum zoom.
  await page.getByRole('button', { name: '−', exact: true }).click()
  await expect.poll(screenStroke).toBeLessThan(2.5)
  await page.mouse.move(10, 10)
  await page.screenshot({ path: '/tmp/family-tree-lineage-implemented.png', fullPage: true })
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '−', exact: true }).click()
  await expect.poll(() => stage.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(0.2, 2)
  expect(await screenStroke()).toBeGreaterThanOrEqual(1.49)
  await expectSelfLineage(page)
})
