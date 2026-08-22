// tests/e2e/fixtures-ready.setup.ts — runs AFTER the web servers are listening,
// because it is an ordinary test in a setup project that every other project
// depends on. This is the part that must not live in globalSetup.
import { expect, test } from '@playwright/test'

const CASES: Array<[string, string]> = [
  ['http://localhost:8080/', 'data-testid'],
  ['http://localhost:8081/seeded-secrets.html', 'SEEDED-INPUT'],
  ['http://localhost:8081/ui-selector.test.js', '__uiSelectorTest'],
  ['http://127.0.0.1:8082/cross-origin.css', 'rebeccapurple'],
]

test('the servers serve OUR fixtures and OUR test bundle', async ({ request }) => {
  for (const [url, needle] of CASES) {
    const res = await request.get(url)
    expect(res.ok(), `${url} not served`).toBe(true)
    expect(await res.text(), `${url} lacks ${needle}`).toContain(needle)
  }
})
