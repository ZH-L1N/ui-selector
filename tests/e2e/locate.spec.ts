// tests/e2e/locate.spec.ts
import { expect, test } from '@playwright/test'

test('locators survive a reload on a real-world page', async ({ page }) => {
  await page.goto('http://localhost:8080/')          // committed realistic fixture
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const results = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, h1, h2, p, img, li, section')].slice(0, 20)
    return els.map(el => ({ selector: window.__uiSelectorTest.locate(el).selector, tag: el.tagName }))
  })
  await page.reload()
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const survived = await page.evaluate(rs =>
    rs.filter(r => document.querySelectorAll(r.selector).length === 1 &&
      document.querySelector(r.selector)!.tagName === r.tag).length, results)
  expect(survived).toBeGreaterThanOrEqual(18)
})
