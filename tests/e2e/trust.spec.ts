// tests/e2e/trust.spec.ts
// The test build's selector.config.test.json trusts `http://localhost` only, so
// http://127.0.0.1:8082 is a genuinely unknown origin — no example.com, no network.
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const UNKNOWN = 'http://127.0.0.1:8082/site-lite.html'
const TRUSTED = 'http://localhost:8080/'

// gate() is started but NOT awaited (it settles on a click), so the dialog may not be
// mounted yet when the next protocol message arrives. Poll for it instead of racing.
async function dialogText(page: Page): Promise<string> {
  await expect
    .poll(() => page.evaluate(() => window.__uiSelectorTest.dialogText().length))
    .toBeGreaterThan(0)
  return page.evaluate(() => window.__uiSelectorTest.dialogText())
}

test('unknown origin requires confirmation, offers no permanent trust, and blocks Deep', async ({ page }) => {
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  const shadowText = await dialogText(page)
  expect(shadowText).toContain('Run once on 127.0.0.1')
  expect(shadowText).not.toMatch(/always|remember|trust this site/i)
  expect(shadowText).toContain('Deep mode unavailable')
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  expect(await gate).toEqual({ trust: 'restricted', mode: 'standard' })
})

test('dismissing the dialog tears down completely', async ({ page }) => {
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await dialogText(page)
  await page.keyboard.press('Escape')
  expect(await gate).toBeNull()
  expect(await page.evaluate(() => (window as never as Record<string, unknown>).__uiSelectorActive__)).toBeUndefined()
})

test('a trusted origin can choose Deep, and a restricted one cannot', async ({ page }) => {
  await page.goto(TRUSTED)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const trusted = page.evaluate(() => window.__uiSelectorTest.gate())
  const text = await dialogText(page)
  expect(text).toMatch(/deep/i)                        // the control exists on trusted origins
  await page.evaluate(() => window.__uiSelectorTest.chooseMode('deep'))
  expect(await trusted).toEqual({ trust: 'trusted', mode: 'deep' })

  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const restricted = page.evaluate(() => window.__uiSelectorTest.gate())
  const restrictedText = await dialogText(page)
  expect(restrictedText).not.toContain('Standard')      // no mode control at all
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  expect(await restricted).toEqual({ trust: 'restricted', mode: 'standard' })
})

test('a trusted origin still defaults to Standard unless Deep is chosen', async ({ page }) => {
  await page.goto(TRUSTED)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await dialogText(page)
  await page.evaluate(() => window.__uiSelectorTest.clickProceed())
  expect(await gate).toEqual({ trust: 'trusted', mode: 'standard' })
})

test('no storage API is touched on any path', async ({ page }) => {
  // addInitScript MUST precede goto: registered afterwards it does not instrument the
  // already-loaded document, and the assertion would pass vacuously.
  await page.addInitScript(() => {
    const w = window as never as Record<string, unknown>
    w.__touched = [] as string[]
    const note = (what: string) => (w.__touched as string[]).push(what)

    // The earlier draft hooked only setItem, so a read, a removeItem, a cookie write,
    // or an IndexedDB open would all have passed silently. Cover the surface.
    for (const name of ['localStorage', 'sessionStorage']) {
      const store = (window as never as Record<string, Storage>)[name]
      for (const m of ['setItem', 'getItem', 'removeItem', 'clear', 'key'] as const) {
        const real = (store[m] as (...a: unknown[]) => unknown).bind(store)
        ;(store as never as Record<string, unknown>)[m] = (...a: unknown[]) => {
          note(`${name}.${m}`); return real(...a)
        }
      }
    }
    const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      get() { note('cookie.get'); return cookieDesc.get!.call(document) },
      set(v) { note('cookie.set'); cookieDesc.set!.call(document, v) },
    })
    const openReal = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((...a: Parameters<typeof openReal>) => { note('indexedDB.open'); return openReal(...a) }) as typeof openReal
    if ('caches' in window) {
      const cachesOpen = caches.open.bind(caches)
      caches.open = ((...a: Parameters<typeof cachesOpen>) => { note('caches.open'); return cachesOpen(...a) }) as typeof cachesOpen
    }
  })
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await dialogText(page)
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  await gate
  // Run a full capture too: the invariant is "never touches storage", not
  // "never touches storage during the trust dialog". runHeadless is the same
  // composition the real flow uses, so this covers the whole capture path.
  await page.evaluate(() => window.__uiSelectorTest.runHeadless('.b'))
  expect(await page.evaluate(() => (window as never as Record<string, string[]>).__touched)).toEqual([])
})
