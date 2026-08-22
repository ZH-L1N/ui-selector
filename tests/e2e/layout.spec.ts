// tests/e2e/layout.spec.ts
import { expect, test } from '@playwright/test'

test('captures parent container and item properties for a grid child', async ({ page }) => {
  await page.setContent(`<div style="display:grid;grid-template-columns:1fr 2fr;gap:12px">
    <span id="a" style="grid-area:1/2;align-self:end">x</span></div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.parent.display).toBe('grid')
  expect(layout.parent.gap).toBe('12px')
  expect(layout.item.gridArea).toContain('2')
  expect(layout.item.alignSelf).toBe('end')
  // This fixture has no positioned or z-indexed ancestor, so an EMPTY stack is the
  // correct result. The earlier draft asserted length > 0 here, which would have
  // forced an implementation to invent an entry the DOM does not justify.
  expect(layout.stacking).toEqual([])
  expect(layout.nearestStackingContextSelector).toBeNull()
})

test('stops the walk at the nearest ancestor stacking context', async ({ page }) => {
  await page.setContent(`<div id="outer" style="position:relative;z-index:9">
    <div id="sc" style="transform:translateZ(0)">
      <div style="position:relative;z-index:5"><span id="a">x</span></div></div></div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.nearestStackingContextSelector).toContain('sc')
  // #outer is beyond the boundary and must NOT appear.
  expect(layout.stacking.some(s => s.selector.includes('outer'))).toBe(false)
})

test('records scroll offsets so a viewport-relative rect is reproducible', async ({ page }) => {
  await page.setContent(`<div style="height:3000px"></div><span id="a">x</span>`)
  await page.evaluate(() => window.scrollTo(0, 500))
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.scroll.pageY).toBe(500)
})

test('recognizes non-transform stacking-context triggers', async ({ page }) => {
  // Each of these really is a paint boundary in Chromium (an elementFromPoint
  // probe traps a z-index:999 child inside #sc for every one). Walking past it
  // reports the wrong nearest context and pads stacking[] with ancestors that
  // do not participate in the element's stacking order.
  const cases = [
    'opacity:0.99',
    'isolation:isolate',
    'mix-blend-mode:multiply',
    'backdrop-filter:blur(2px)',
    'contain:layout',
  ]
  for (const style of cases) {
    await page.setContent(`<div id="outer" style="position:relative;z-index:9">
      <div id="sc" style="${style}"><span id="a">x</span></div></div>`)
    await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
    const layout = await page.evaluate(() =>
      window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
    expect(layout.nearestStackingContextSelector, style).toContain('sc')
    expect(layout.stacking, style).toEqual([])
  }
})

test('position fixed and sticky establish a stacking context even with z-index auto', async ({ page }) => {
  for (const pos of ['fixed', 'sticky'] as const) {
    await page.setContent(`<div id="outer" style="position:relative;z-index:9">
      <div id="sc" style="position:${pos}"><span id="a">x</span></div></div>`)
    await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
    const layout = await page.evaluate(() =>
      window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
    expect(layout.nearestStackingContextSelector, pos).toContain('sc')
    // #sc is itself positioned, so it belongs in the chain; #outer is beyond
    // the boundary and must not appear as a peer entry.
    expect(layout.stacking.some(s => s.selector.includes('sc')), pos).toBe(true)
    expect(layout.stacking.some(s => s.selector.includes('outer')), pos).toBe(false)
  }
})
