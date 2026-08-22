// tests/e2e/styles.spec.ts
import { expect, test } from '@playwright/test'

test('names a token definition site from matched rules, not by value comparison', async ({ page }) => {
  // fixture: :root{--brand:#0a7}  .b{color:var(--brand)}
  await page.goto('http://localhost:8081/tokens.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const brand = s.variables.find(v => v.name === '--brand')!
  expect(brand.resolved).toBe('#0a7')
  expect(brand.definedIn).toBe(':root')       // impossible to get right by comparing computed values
  expect(brand.usedBy).toContain('color')
  expect(s.computed.color).toBe('rgb(0, 170, 119)')
})

test('resolves the winning definition when a token is redefined on an ancestor', async ({ page }) => {
  // fixture: :root{--brand:#0a7}  .theme-dark{--brand:#fff}  .b inside .theme-dark
  await page.goto('http://localhost:8081/tokens-override.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const brand = s.variables.find(v => v.name === '--brand')!
  expect(brand.definedIn).toBe('.theme-dark')
  expect(brand.resolved).toBe('#fff')
})

test('attributes the base-state token while the pointer rests on the element', async ({ page }) => {
  // A matching `.btn:hover` rule is a STATE, not an applied rule: its
  // declaration must not win the declared-value map and swap the base token
  // (--bg) for the hover token (--bg-hover) in every real, pointer-on capture.
  await page.setContent(`<style>
    :root { --bg: #0a7; --bg-hover: #095 }
    .btn { background-color: var(--bg) }
    .btn:hover { background-color: var(--bg-hover) }
  </style><button class="btn">x</button>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  await page.hover('.btn')
  const s = await page.evaluate(() => {
    const el = document.querySelector('.btn')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const names = s.variables.map(v => v.name)
  expect(names).toContain('--bg')
  expect(names).not.toContain('--bg-hover')
})

test('the token table ignores declarations whose @media condition does not hold', async ({ page }) => {
  // Both .btn rules are observed (rules.applied carries the evidence), but the
  // one inside a non-matching @media contributes no declared value, so it must
  // not win the declared-value map and report --text-wide as the token.
  await page.setContent(`<style>
    :root { --text: #111; --text-wide: #222 }
    .btn { color: var(--text) }
    @media (min-width: 5000px) { .btn { color: var(--text-wide) } }
  </style><button class="btn">x</button>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.btn')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const names = s.variables.map(v => v.name)
  expect(names).toContain('--text')
  expect(names).not.toContain('--text-wide')
})

test('an !important declaration beats a higher-specificity one in the token table', async ({ page }) => {
  // Same sheet, same origin, no layers — plain cascade: .btn's !important color
  // wins over #id .btn, so --a is the element's token, not --b.
  await page.setContent(`<style>
    :root { --a: #111; --b: #222 }
    .btn { color: var(--a) !important }
    #id .btn { color: var(--b) }
  </style><div id="id"><button class="btn">x</button></div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.btn')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const names = s.variables.map(v => v.name)
  expect(names).toContain('--a')
  expect(names).not.toContain('--b')
})

test('never names a definition site from a non-matching @media block', async ({ page }) => {
  // html:root inside @media (max-width:500px) declares 4px and is NOT in
  // effect at this viewport; naming it would contradict the resolved value.
  await page.setContent(`<style>
    :root { --gap: 8px }
    @media (max-width: 500px) { html:root { --gap: 4px } }
    .b { padding: var(--gap) }
  </style><button class="b">x</button>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const gap = s.variables.find(v => v.name === '--gap')!
  expect(gap.resolved).toBe('8px')
  expect(gap.definedIn).toBe(':root')
})

test('a nested rule later in source order wins a full definition-site tie', async ({ page }) => {
  // .card and .box tie on depth, importance, specificity, and sheet; .box is
  // later in DOCUMENT order (inside a matching @media), so it defines the
  // resolved 24px. A per-rule-list index restarts at 0 inside the @media and
  // would keep .card — whose declared 8px contradicts the resolved value.
  await page.setContent(`<style>
    .card { --gap: 8px; padding: var(--gap) }
    @media (min-width: 300px) { .box { --gap: 24px } }
  </style><div class="card box">x</div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.card')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const gap = s.variables.find(v => v.name === '--gap')!
  expect(gap.resolved).toBe('24px')
  expect(gap.definedIn).toBe('.box')
})

test('distinguishes a webfont from a family no @font-face declares', async ({ page }) => {
  await page.goto('http://localhost:8081/fonts.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(async () => {
    await document.fonts.ready
    const read = (sel: string) => {
      const el = document.querySelector(sel)!
      const ctx = window.__uiSelectorTest.ctx()
      return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
    }
    return { absent: read('p.absent').typography, web: read('p.web').typography }
  })
  expect(out.absent.declaredFamilies[0]).toBe('NotInstalled Sans')
  expect(out.absent.webfontStatus['NotInstalled Sans']).toBe('not-a-webfont')
  expect(out.web.webfontStatus['TestWeb']).toBe('loaded')
  // No field claims the absent family is or is not rendered — see Step 4.
  expect(out.absent).not.toHaveProperty('firstFamilyRendered')
})
