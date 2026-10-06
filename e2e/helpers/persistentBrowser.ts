import { test as base } from '@playwright/test'

/**
 * Directory handles must survive real IndexedDB serialization. Chromium M153's
 * in-memory (incognito) backend breaks that round trip: crbug.com/562119515.
 * Use a fresh on-disk profile per test, as in a normal Web/PWA session. Passing
 * an empty userDataDir lets Playwright create and remove the temporary profile.
 * No storage APIs or permission checks are replaced by this fixture.
 */
export const test = base.extend({
  context: async ({ playwright, launchOptions, contextOptions, baseURL, viewport, isMobile, hasTouch }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext('', {
      ...launchOptions,
      ...contextOptions,
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
  },
})

export { expect } from '@playwright/test'
