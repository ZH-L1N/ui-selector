// tests/e2e/shot-live.spec.ts — the one test that goes through the REAL
// getDisplayMedia path. It lives in its own file because
// `test.use({ launchOptions })` forces a new worker and Playwright rejects it inside
// a describe group.
//
// If Chromium's auto-select-by-title flag ever stops matching, ONLY this test is
// affected: the crop arithmetic is covered by the deterministic streamFactory seam in
// shot.spec.ts, which is the entire point of that seam.
import { expect, test } from '@playwright/test'

test.use({ launchOptions: { args: [
  '--use-fake-ui-for-media-stream',
  '--auto-select-tab-capture-source-by-title=shot-fixture',
] } })

test('a real user click reaches a PNG', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  await page.click('#shoot')                      // supplies transient activation
  // The fixture sets __shotOmissions last, so its presence means the handler finished
  // — success or refusal.
  await expect
    .poll(() => page.evaluate(() => Array.isArray(window.__shotOmissions)))
    .toBe(true)
  const omissions = await page.evaluate(() => window.__shotOmissions ?? [])

  // Provisioned browsers cannot actually read a capture surface: the auto-select flag
  // picks this tab, then the track fails with NotReadableError — verified on macOS in
  // headless shell, new headless, AND headed Chromium. Skip loudly instead of
  // asserting a capability the environment does not have; on a machine where display
  // capture works this test runs for real and the assertions below apply.
  //
  // The skip matches ONLY the environmental signature (exactly one omission, the
  // surface itself unavailable). A reason-blind `omissions.length > 0` guard would
  // also swallow real defects — e.g. 'no frame delivered' with a working surface —
  // as a green skip labelled "environment", which is how a code bug hides.
  const envUnavailable =
    omissions.length === 1 &&
    omissions[0].reason === 'unsupported-browser' &&
    (omissions[0].detail === 'NotReadableError' || omissions[0].detail === 'getDisplayMedia unavailable')
  test.skip(envUnavailable, `display capture unavailable here: ${JSON.stringify(omissions)}`)
  // Any other omission on this path is a real defect, not this machine.
  expect(omissions).toEqual([])

  const ok = await page.evaluate(() => {
    const s = window.__shotResult!
    return s.canvas.width > 0 && s.canvas.toDataURL('image/png').startsWith('data:image/png')
  })
  expect(ok).toBe(true)
})
