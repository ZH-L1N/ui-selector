// tests/e2e/text-boundaries.spec.ts
import { expect, test } from '@playwright/test'

test('capturing the whole seeded card leaks nothing', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx()
    return { text: window.__uiSelectorTest.visibleText(document.getElementById('card')!, 'trusted', ctx) }
  })
  expect(out.text).not.toMatch(/SEEDED-/)
  expect(out.text).toContain('Card')            // and it is not vacuously empty
})

test('every element inside the seeded card is individually safe as a root', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const leaks = await page.evaluate(() =>
    [...document.querySelectorAll('#card *')]
      .map(el => window.__uiSelectorTest.visibleText(el, 'trusted', window.__uiSelectorTest.ctx()))
      .filter(t => t && /SEEDED-/.test(t)))
  expect(leaks).toEqual([])
})

test('every reachable shadow relationship records a shadow-boundary omission', async ({ page }) => {
  await page.goto('http://localhost:8081/shadow.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const probe = (get: () => Element | null | undefined) => {
      const ctx = window.__uiSelectorTest.ctx()
      const el = get()
      if (!el) return null
      window.__uiSelectorTest.visibleText(el, 'trusted', ctx)
      return ctx.omissions.some(o => o.reason === 'shadow-boundary')
    }
    const openHost = document.getElementById('open-host')!
    return {
      host: probe(() => openHost),
      inside: probe(() => openHost.shadowRoot!.querySelector('button')),
      slotted: probe(() => document.getElementById('slotted-child')),
      closedHost: probe(() => document.getElementById('closed-host')),
      plain: probe(() => document.getElementById('plain')),
    }
  })
  expect(out.host).toBe(true)
  expect(out.inside).toBe(true)         // element INSIDE a shadow tree, not just the host
  expect(out.slotted).toBe(true)        // slotted content: light and shadow trees differ
  expect(out.plain).toBe(false)         // and no false positives on ordinary elements
  // A CLOSED host is not detectable after the fact. This asserts the documented limit
  // rather than pretending otherwise — see spec §6.1.
  expect(out.closedHost).toBe(false)
})
