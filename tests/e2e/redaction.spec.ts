// tests/e2e/redaction.spec.ts — the standing privacy gate.
//
// A failure here is a real defect, never a test bug: it means a seeded secret
// reached the output of the one capture path.
import { expect, test } from '@playwright/test'

const FIXTURE = 'http://localhost:8081/seeded-secrets.html'

// Every seed the fixture plants, plus the three this test plants itself (cookie,
// storage, query string). An incomplete list is the exact failure mode this gate
// exists to prevent, so the first test below re-derives the fixture's seeds from
// the served HTML and fails on drift rather than trusting this literal.
const SEEDS = [
  'SEEDED-COOKIE', 'SEEDED-INPUT', 'SEEDED-AREA', 'SEEDED-EDITABLE',
  'SEEDED-EDITABLE-EMPTY', 'SEEDED-EDITABLE-PLAIN', 'SEEDED-SCRIPT', 'SEEDED-STYLE',
  'SEEDED-HIDDEN', 'SEEDED-NONE', 'SEEDED-TPL', 'SEEDED-QUERY', 'SEEDED-JS',
  'SEEDED-DATA', 'SEEDED-STORAGE',
  // Live ARIA state on custom widgets IS the user's form value (spec §6.4):
  // a role=checkbox's aria-checked and a role=slider's aria-valuenow/valuetext.
  'SEEDED-ARIA-CHECKED', 'SEEDED-ARIA-VALUENOW', 'SEEDED-ARIA-VALUETEXT',
  // url() tokens inside CSS VALUES (spec §6.4 bans query params in any mode):
  // computed cursor/filter/backdrop-filter, pseudo content, a custom property
  // referenced by an allowlisted property, declared rule values, keyframes text.
  'SEEDED-CURSOR', 'SEEDED-FILTER', 'SEEDED-BACKDROP', 'SEEDED-CONTENT',
  'SEEDED-VAR', 'SEEDED-KEYFRAME',
]

test('the SEEDS list is exhaustive against the fixture', async ({ request }) => {
  const html = await (await request.get(FIXTURE)).text()
  const planted = [...new Set(html.match(/SEEDED-[A-Z-]+/g) ?? [])].sort()
  expect(planted.length).toBeGreaterThan(0)
  // Adding a seed to the fixture without adding it here would silently shrink the
  // gate, so that is what this asserts.
  expect(SEEDS).toEqual(expect.arrayContaining(planted))
})

test('no seeded secret ever appears in any captured output', async ({ page, context }) => {
  await context.addCookies([{ name: 'sid', value: 'SEEDED-COOKIE', url: 'http://localhost:8081' }])
  await page.goto(`${FIXTURE}?q=SEEDED-QUERY`)
  await page.evaluate(() => localStorage.setItem('k', 'SEEDED-STORAGE'))
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  // Every element in the seeded card, in both modes, as JSON *and* as Markdown —
  // not an arbitrary first-40 slice, which could miss the very element that leaks.
  const { blob, count } = await page.evaluate(() => {
    const els = [document.getElementById('card')!, ...document.querySelectorAll('#card *')]
    // runHeadless is THE capture path — the same composition the real flow
    // assembles — and it addresses its target by selector, so each element gets a
    // marker to be addressed by. `data-redaction-idx` is deliberately not
    // `data-testid`: the attribute allowlist admits no other `data-*`, so the
    // marker cannot appear in the output and cannot alter what is asserted.
    els.forEach((el, i) => el.setAttribute('data-redaction-idx', String(i)))
    const out: string[] = []
    for (let i = 0; i < els.length; i++) {
      for (const [mode, trust] of [['standard', 'restricted'], ['deep', 'trusted']] as const) {
        const json = window.__uiSelectorTest.runHeadless(`[data-redaction-idx="${i}"]`, mode, trust)
        out.push(JSON.stringify(json), window.__uiSelectorTest.toMarkdown(json))
      }
    }
    return { blob: out.join('\n'), count: els.length }
  })
  // A loop that captured nothing would pass every assertion below.
  expect(count).toBeGreaterThanOrEqual(14)
  expect(blob).toContain('"schemaVersion":"1.0"')
  for (const seed of SEEDS) expect(blob).not.toContain(seed)
})
