// tests/e2e/flow.spec.ts — the full capture path, end to end, through the same
// runHeadless composition the redaction gate uses.
import { expect, test } from '@playwright/test'

// NOT an actionability test, despite what this was called until now: it asserts field
// PRESENCE and the absence of seeds. Whether a brief is actually usable by an agent is a
// different question, measured by hand — see docs/actionability.md.
test('full flow on a real-world page populates the contract and leaks no seeds', async ({ page, context }) => {
  await context.addCookies([{ name: 'sid', value: 'SEEDED-COOKIE', url: 'http://localhost:8080' }])
  await page.goto('http://localhost:8080/?q=SEEDED-QUERY')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const json = await page.evaluate(() => window.__uiSelectorTest.runHeadless('h1'))
  expect(json.schemaVersion).toBe('1.0')
  expect(json.page.pathname).toBe('/')
  const text = JSON.stringify(json)
  expect(text).not.toContain('SEEDED-')
  expect(json.styles.typography.declaredFamilies.length).toBeGreaterThan(0)
  expect(json.locator.confidence).toBe('exact')
})

test('the panel renders and downloads on a strict-CSP page without a single violation', async ({ page }) => {
  // Same collection pattern as pick.spec.ts: violations registered BEFORE
  // navigation, asserted zero afterwards. The panel must never trip default-src
  // 'self' — no blob <img>, no injected <style>, no inline style attribute.
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    ;(window as never as Record<string, string[]>).__csp = []
    document.addEventListener('securitypolicyviolation', e =>
      ((window as never as Record<string, string[]>).__csp).push(
        `${(e as SecurityPolicyViolationEvent).violatedDirective}:${(e as SecurityPolicyViolationEvent).blockedURI}`))
  })
  await page.goto('http://localhost:8081/strict-csp.html')
  const downloaded = page.waitForEvent('download')
  await page.evaluate(() => {
    const hook = window.__uiSelectorTest
    const result = hook.runHeadless('#t')
    hook.showPanel(result, null)
    hook.clickPanel('[data-act="download"]')
  })
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('ui-selector-capture.json')
  const panelText = await page.evaluate(() => window.__uiSelectorTest.panelText())
  expect(panelText).toContain('"schemaVersion": "1.0"')
  expect(await page.evaluate(() => (window as never as Record<string, string[]>).__csp)).toEqual([])
  expect(errors).toEqual([])
})

test('@live deployed skill-shelf still behaves the same', async ({ page }) => {
  await page.goto('https://skill-shelf.pages.dev/')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const json = await page.evaluate(() => window.__uiSelectorTest.runHeadless('h1'))
  expect(json.page.origin).toBe('https://skill-shelf.pages.dev')
  expect(json.locator.confidence).toBe('exact')
})
