// tests/e2e/deep.spec.ts — Deep mode: sanitized subtree, keyframes, asset metadata.
import { expect, test } from '@playwright/test'

test('sanitizes the subtree, respects budgets, and never carries form values', async ({ page }) => {
  await page.setContent(`<div id="c"><input value="SEEDED-INPUT"><span>ok</span>
    ${'<b>x</b>'.repeat(500)}</div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const { deep, omissions } = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx('deep', 'trusted')
    return { deep: window.__uiSelectorTest.captureDeep(document.getElementById('c')!, ctx), omissions: ctx.omissions }
  })
  expect(JSON.stringify(deep)).not.toContain('SEEDED-INPUT')
  expect(deep.subtree.some(n => n.tagName === 'INPUT')).toBe(false)   // pruned, not just emptied
  expect(deep.subtree.length).toBeLessThanOrEqual(200)
  expect(omissions.some(o => o.reason === 'budget-exceeded')).toBe(true)
})

test('collects assets with reduced URLs and drops data-URL sources', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const { deep, omissions } = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx('deep', 'trusted')
    return { deep: window.__uiSelectorTest.captureDeep(document.getElementById('card')!, ctx),
             omissions: ctx.omissions }
  })
  expect(JSON.stringify(deep.assets)).not.toContain('SEEDED-DATA')
  // Scoped to the collector's own omission — pickAttributes emits blocked-scheme
  // for the same fixture's javascript:/data: attributes, which must not satisfy
  // this assertion on the collector's behalf.
  expect(omissions.some(o => o.field === 'deep.assets' && o.reason === 'blocked-scheme')).toBe(true)
  for (const a of deep.assets) expect(a.url).toMatch(/^https?:\/\/[^?#]*$/)
})

test('collects img, picture>source, video[poster], and background-image assets', async ({ page }) => {
  // The positive collection path (spec §6.2): every kind, reduced URLs stripped
  // of the query string, natural dimensions and object-fit populated, and the
  // data: img dropped by the collector itself.
  await page.goto('http://localhost:8081/assets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  await page.evaluate(() => Promise.all(
    Array.from(document.images).filter(i => i.src.startsWith('http')).map(i => i.decode())))
  const { deep, omissions } = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx('deep', 'trusted')
    return { deep: window.__uiSelectorTest.captureDeep(document.getElementById('card')!, ctx),
             omissions: ctx.omissions }
  })
  expect(deep.assets.map(a => a.kind)).toEqual(['img', 'img', 'source', 'poster', 'background-image'])
  for (const a of deep.assets) expect(a.url).toBe('http://localhost:8081/pixel.png')
  expect(JSON.stringify(deep)).not.toContain('SEEDED-ASSET')
  const hero = deep.assets[0]
  expect(hero.naturalWidth).toBe(1)
  expect(hero.naturalHeight).toBe(1)
  expect(hero.objectFit).toBe('cover')
  expect(omissions.some(o => o.field === 'deep.assets' && o.reason === 'blocked-scheme'
    && o.detail === 'img with data: URL dropped')).toBe(true)
})

test('collects only the keyframes the element actually animates', async ({ page }) => {
  await page.setContent(`<style>@keyframes spin{to{transform:rotate(360deg)}}
    @keyframes unused{to{opacity:0}} .s{animation:spin 1s linear infinite}</style><div class="s">x</div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const deep = await page.evaluate(() =>
    window.__uiSelectorTest.captureDeep(document.querySelector('.s')!, window.__uiSelectorTest.ctx('deep', 'trusted')))
  expect(deep.keyframes.map(k => k.name)).toEqual(['spin'])
})

test('selecting a frame says its contents are unreachable', async ({ page }) => {
  // This is exactly how a Claude artifact behaves: it renders in a cross-origin iframe on
  // the claude.ai shell, so the only selectable thing is the frame box. Without the
  // omission the JSON reads as a successful capture of a component and the user cannot
  // tell why the brief is useless.
  await page.goto('http://localhost:8081/frames.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const read = (sel: string) => {
      const json = window.__uiSelectorTest.runHeadless(sel)
      return json.omissions.filter(o => o.reason === 'frame-content-unreachable')
    }
    return { cross: read('#cross'), same: read('#same'), plain: read('#plain') }
  })
  expect(out.cross).toHaveLength(1)
  expect(out.cross[0].detail).toContain('cross-origin')
  expect(out.same).toHaveLength(1)          // v1 traverses no frame, same-origin included
  expect(out.plain).toHaveLength(0)         // and no false positives on ordinary elements
})
