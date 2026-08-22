// tests/e2e/rules.spec.ts
import { expect, test } from '@playwright/test'

test('captures ::before content and computed styles', async ({ page }) => {
  await page.goto('http://localhost:8081/pseudo.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const p = await page.evaluate(() => window.__uiSelectorTest.capturePseudo(document.querySelector('.i')!, window.__uiSelectorTest.ctx()))
  expect(p.before!.content).toBe('"→"')
  expect(p.before!.computed['margin-right']).toBe('4px')
})

test('collects declarative interaction-state rules without forcing state', async ({ page }) => {
  await page.goto('http://localhost:8081/states.html')   // .b has :hover, :focus-visible, :disabled
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.b')!, window.__uiSelectorTest.ctx()))
  expect(new Set(r.states.map(s => s.state))).toEqual(new Set(['hover', 'focus-visible', 'disabled']))
  expect(r.states.find(s => s.state === 'hover')!.declarations['background-color']).toBeTruthy()
})

test('classifies :hover as a state even while the pointer rests on the element', async ({ page }) => {
  // In the real flow the pointer is by definition over the picked element (the
  // click that selected it), so `.b:hover` MATCHES at capture time. It must
  // still be filed under `states`, never under `applied` — otherwise hover is
  // systematically absent from every real capture.
  await page.goto('http://localhost:8081/states.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  await page.hover('.b')
  const out = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const r = window.__uiSelectorTest.matchedRules(el, window.__uiSelectorTest.ctx())
    return { hoverNow: el.matches(':hover'), states: r.states, applied: r.applied }
  })
  expect(out.hoverNow).toBe(true)                 // guard: the pointer really is on the element
  expect(out.states.map(s => s.state)).toContain('hover')
  expect(out.applied.every(a => !a.selector.includes(':hover'))).toBe(true)
})

test('classifies :disabled as a state when the element is disabled', async ({ page }) => {
  // Selecting a disabled button is the most common reason to ask about
  // disabled styling — the state must not vanish exactly when it holds.
  await page.goto('http://localhost:8081/states.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const el = document.querySelector('.b') as HTMLButtonElement
    el.disabled = true
    const r = window.__uiSelectorTest.matchedRules(el, window.__uiSelectorTest.ctx())
    return { states: r.states, applied: r.applied }
  })
  expect(out.states.map(s => s.state)).toContain('disabled')
  expect(out.applied.every(a => !a.selector.includes(':disabled'))).toBe(true)
})

test('does not attribute another element\'s state rule to this element', async ({ page }) => {
  await page.goto('http://localhost:8081/states.html')   // page also defines .other:hover
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.b')!, window.__uiSelectorTest.ctx()))
  expect(r.states.every(s => !s.selector.includes('.other'))).toBe(true)
})

test('records media conditions of rules that applied', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 })
  await page.goto('http://localhost:8081/responsive.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.x')!, window.__uiSelectorTest.ctx()))
  expect(r.mediaConditions.some(c => c.includes('600px'))).toBe(true)
})

test('degrades to an omission on a cross-origin stylesheet instead of throwing', async ({ page }) => {
  // The fixture links http://127.0.0.1:8082/cross-origin.css WITHOUT crossorigin,
  // so cssRules access throws exactly as a CDN stylesheet does. Fully offline.
  await page.goto('http://localhost:8081/cross-origin.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const omissions = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx()
    window.__uiSelectorTest.matchedRules(document.querySelector('p')!, ctx)
    return ctx.omissions
  })
  // The detail is the REDUCED href: the fixture link carries ?sig=SEEDED-SHEET-QUERY,
  // which stands in for a signed CSS URL and must never reach the output.
  const o = omissions.find(o => o.reason === 'cross-origin-stylesheet')
  expect(o?.detail).toBe('http://127.0.0.1:8082/cross-origin.css')
  expect(JSON.stringify(omissions)).not.toContain('SEEDED-SHEET-QUERY')
})

test('sheet provenance on applied rules carries the reduced href only', async ({ page }) => {
  // A CORS-readable stylesheet whose URL carries a query string: the query must
  // not reach the deep `sheet` provenance field either.
  await page.goto('http://localhost:8081/cross-origin.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  await page.addStyleTag({ url: '/cross-origin.css?sig=SEEDED-SHEET-QUERY' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('p')!, window.__uiSelectorTest.ctx()))
  const sheets = r.applied.map(a => a.sheet)
  expect(sheets).toContain('http://localhost:8081/cross-origin.css')
  for (const s of sheets) expect(s).not.toContain('?')
  expect(JSON.stringify(r)).not.toContain('SEEDED-SHEET-QUERY')
})

test('reports specificity for competing rules from different sheets', async ({ page }) => {
  await page.goto('http://localhost:8081/specificity.html')  // #id .btn vs .btn, two sheets
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.btn')!, window.__uiSelectorTest.ctx()))
  const sorted = [...r.applied].sort((a, b) =>
    b.specificity[0] - a.specificity[0] || b.specificity[1] - a.specificity[1])
  expect(sorted[0].specificity[0]).toBe(1)
  expect(new Set(r.applied.map(a => a.sheet)).size).toBeGreaterThan(1)
})
