// tests/unit/markdown.test.ts
// @vitest-environment node        <- toMarkdown is pure; it must not need a DOM
import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../../src/ui/markdown'
import type { CaptureV1 } from '../../src/types'

const fixture: CaptureV1 = {
  schemaVersion: '1.0',
  capturedAt: '2026-08-22T00:00:00.000Z',
  page: { origin: 'https://skill-shelf.pages.dev', pathname: '/' },
  trust: 'trusted',
  mode: 'standard',
  env: { viewport: { width: 1440, height: 900 }, devicePixelRatio: 2,
         prefersColorScheme: 'dark', colorScheme: 'dark light', themeAttributes: { 'data-theme': 'dark' } },
  element: { tagName: 'BUTTON', role: 'button', accessibleName: 'Save', attributes: { class: 'btn' }, text: 'Save' },
  locator: { selector: '[data-testid="save"]', strategy: 'testid', confidence: 'exact', matchCount: 1 },
  layout: { rect: { x: 10, y: 20, width: 96, height: 40 },
            boxModel: { content: { x: 10, y: 20, width: 96, height: 40 },
                        padding: { top: 8, right: 16, bottom: 8, left: 16 },
                        border: { top: 1, right: 1, bottom: 1, left: 1 },
                        margin: { top: 0, right: 0, bottom: 0, left: 0 } },
            scroll: { pageX: 0, pageY: 0, elementScrollTop: 0, elementScrollLeft: 0,
                      scrollParentSelector: null },
            parent: { display: 'flex', flexFlow: 'row nowrap', gap: '8px' },
            item: { flex: '0 1 auto', alignSelf: 'center' },
            stacking: [{ selector: 'header', position: 'sticky', zIndex: '10' }],
            nearestStackingContextSelector: 'header',
            ancestry: [{ tagName: 'DIV', role: null, display: 'flex' }] },
  styles: { computed: { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(0, 170, 119)' },
            variables: [{ name: '--brand', resolved: '#0a7', definedIn: ':root', usedBy: ['background-color'] }],
            typography: { declaredFamilies: ['Inter', 'sans-serif'],
                          webfontStatus: { Inter: 'loaded', 'sans-serif': 'not-a-webfont' },
                          size: '14px', lineHeight: '20px', letterSpacing: 'normal',
                          weight: '600', featureSettings: 'normal' } },
  pseudo: {},
  states: [{ state: 'hover', selector: '.btn:hover', declarations: { 'background-color': '#096' } }],
  omissions: [{ field: 'deep', reason: 'restricted-mode' }],
}

describe('toMarkdown', () => {
  it('renders the locator, tokens, typography, and states', () => {
    const md = toMarkdown(fixture)
    expect(md).toContain('[data-testid="save"]')
    expect(md).toContain('--brand')
    expect(md).toContain('#0a7')
    expect(md).toContain('Inter')
    expect(md).toContain(':hover')
  })

  it('renders the computed styles — the section the brief is FOR', () => {
    // Regression guard for a real defect: toMarkdown rendered identity, layout, tokens,
    // typography, states, pseudo, responsive, deep and omissions — every section except
    // the styles. The existing tests all passed, because each asserted a section that WAS
    // rendered. None asked whether the important one was missing.
    const md = toMarkdown(fixture)
    expect(md).toContain('## Styles')
    expect(md).toContain('color: rgb(255, 255, 255)')
    expect(md).toContain('background-color: rgb(0, 170, 119)')
  })

  it('surfaces omissions so absence never reads as unstyled', () => {
    expect(toMarkdown(fixture)).toMatch(/omission|not captured/i)
  })

  it('reports webfont status per declared family', () => {
    const md = toMarkdown({ ...fixture,
      styles: { ...fixture.styles,
        typography: { ...fixture.styles.typography,
          webfontStatus: { Inter: 'unloaded', 'sans-serif': 'not-a-webfont' } } } })
    expect(md).toMatch(/unloaded/i)
    expect(md).toContain('Inter')
  })

  it('is a pure function of its input — it never touches the DOM', () => {
    const spy = { called: false }
    const guard = new Proxy({}, { get() { spy.called = true; return undefined } })
    const saved = globalThis.document
    ;(globalThis as { document?: unknown }).document = guard
    try { toMarkdown(fixture) } finally { globalThis.document = saved }
    expect(spy.called).toBe(false)
  })

  it('cannot reintroduce a secret the JSON never contained', () => {
    expect(toMarkdown(fixture)).not.toContain('SEEDED-')
  })
})
