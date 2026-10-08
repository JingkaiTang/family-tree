import { test as base } from '@playwright/test'

/**
 * Directory handles must survive real IndexedDB serialization. Chromium M153's
 * in-memory (incognito) backend breaks that round trip: crbug.com/562119515.
 * Use a fresh on-disk profile per test, as in a normal Web/PWA session. Passing
 * an empty userDataDir lets Playwright create and remove the temporary profile.
 * No storage APIs or permission checks are replaced by this fixture.
 */
export const test = base.extend({
  // Browser startup has its own budget so it cannot consume the test's timeout.
  context: [async ({ playwright, launchOptions, contextOptions, baseURL, viewport, isMobile, hasTouch }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext('', {
      ...launchOptions,
      ...contextOptions,
      timeout: 45_000,
      baseURL,
      viewport,
      isMobile,
      hasTouch,
    })
    try {
      await testInfo.attach('browser-runtime.txt', {
        body: `Chromium ${context.browser()?.version()}\nStorage context: isolated persistent profile\n`,
        contentType: 'text/plain',
      })
      await use(context)
    } finally {
      await context.close()
    }
  }, { scope: 'test', timeout: 60_000 }],
})

export { expect } from '@playwright/test'
