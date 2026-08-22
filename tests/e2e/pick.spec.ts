// tests/e2e/pick.spec.ts
import { expect, test } from '@playwright/test'

test('highlights on hover and resolves the clicked element', async ({ page }) => {
  await page.setContent('<button id="target" style="padding:20px">Pick me</button>')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const picked = page.evaluate(() => window.__uiSelectorTest.pick().then(e => e && e.id))
  await page.hover('#target')
  await page.click('#target')
  expect(await picked).toBe('target')
})

test('Escape cancels and removes every trace from the page', async ({ page }) => {
  await page.setContent('<button id="t">x</button>')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const cancelled = page.evaluate(() => window.__uiSelectorTest.pick().then(e => e && e.id))
  // Wait for the overlay host to exist before pressing a key: page.evaluate is NOT
  // awaited here (pick only settles on the key), so without this the Escape can be
  // dispatched before the capture-phase listeners are attached — a race, not a bug in
  // the picker. The host element is also the trace the last assertion checks is gone.
  await expect.poll(() => page.evaluate(() => document.body.children.length)).toBe(2)
  await page.keyboard.press('Escape')
  expect(await cancelled).toBeNull()
  expect(await page.evaluate(() => document.body.children.length)).toBe(1)
})

test('the selecting click never reaches the page own handlers', async ({ page }) => {
  await page.setContent('<a id="t" href="/navigated.html" style="padding:20px">link</a>')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  await page.evaluate(() => {
    ;(window as never as Record<string, unknown>).__pageClicks = 0
    document.getElementById('t')!.addEventListener('click', () => {
      ;(window as never as Record<string, number>).__pageClicks++
    })
  })
  const picked = page.evaluate(() => window.__uiSelectorTest.pick().then(e => e && e.id))
  await page.click('#t')
  expect(await picked).toBe('t')
  expect(await page.evaluate(() => (window as never as Record<string, number>).__pageClicks)).toBe(0)
})

test('resolves a click landing inside an open shadow root to the real target', async ({ page }) => {
  await page.goto('http://localhost:8081/shadow.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const picked = page.evaluate(() =>
    window.__uiSelectorTest.pick().then(e => {
      if (!e) return null
      const root = e.getRootNode()
      return `${e.tagName}:${root instanceof ShadowRoot ? root.mode : 'document'}`
    }))
  const box = await page.evaluate(() => {
    const target = document.getElementById('open-host')!.shadowRoot!.querySelector('button')!
    const r = target.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.click(box.x, box.y)
  // composedPath()[0] is the shadow child itself, so the picked node stays inside the
  // shadow tree instead of being retargeted up to the host.
  expect(await picked).toBe('BUTTON:open')
})

test('runs under a strict CSP with Trusted Types enforced', async ({ page }) => {
  // `page.addScriptTag` injects an inline <script>, which this fixture's
  // `script-src 'self'` blocks outright — using it here would prove nothing. The
  // fixture instead carries `<script src="/ui-selector.test.js">` in its own markup,
  // served same-origin by tests/server.mjs, so the bundle loads the way an allowed
  // script does.
  const errors: string[] = []
  const violations: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    ;(window as never as Record<string, string[]>).__csp = []
    document.addEventListener('securitypolicyviolation', e =>
      ((window as never as Record<string, string[]>).__csp).push(
        `${(e as SecurityPolicyViolationEvent).violatedDirective}:${(e as SecurityPolicyViolationEvent).blockedURI}`))
  })
  await page.goto('http://localhost:8081/strict-csp.html')
  // Deliberately NOT awaited: pick() settles on the click below, so awaiting the
  // evaluate here would deadlock the test rather than exercise the picker.
  const picked = page.evaluate(() => window.__uiSelectorTest.pick().then(e => e && e.id))
  await page.hover('#t')
  await page.click('#t')
  expect(await picked).toBe('t')
  violations.push(...await page.evaluate(() => (window as never as Record<string, string[]>).__csp))
  expect(errors).toEqual([])
  expect(violations).toEqual([])          // our own code must trigger zero violations
})
