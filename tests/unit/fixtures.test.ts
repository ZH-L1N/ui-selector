import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const policy = (file: string): string => {
  const html = readFileSync(`tests/fixtures/${file}`, 'utf8')
  const m = html.match(/http-equiv="Content-Security-Policy"\s*content="([^"]+)"/s)
  if (!m) throw new Error(`${file} declares no CSP`)
  return m[1].replace(/\s+/g, ' ').trim()
}

describe('strict-CSP fixtures', () => {
  // strict-csp.html pre-loads the bundle (the automated test cannot inject under
  // script-src 'self'); strict-csp-manual.html must not, because that script sets the
  // single-instance guard and makes a real bookmarklet click a silent no-op. If their
  // policies drift, the manual Phase 0 check silently stops testing the real policy.
  it('the manual twin enforces exactly the automated fixture policy', () => {
    expect(policy('strict-csp-manual.html')).toBe(policy('strict-csp.html'))
  })

  it('only the automated fixture pre-loads the bundle', () => {
    // Strip HTML comments BEFORE matching. Two weaker versions of this assertion were
    // wrong: a bare substring check, and a regex over the raw file — both fired on the
    // manual twin's own comment, which quotes a script tag while explaining why it must
    // not have one. A commented-out tag is inert markup; the test has to agree.
    const scriptTags = (file: string): string[] => {
      const markup = readFileSync(`tests/fixtures/${file}`, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      return [...markup.matchAll(/<script\b[^>]*>/g)].map(m => m[0])
    }

    expect(scriptTags('strict-csp.html').join()).toContain('ui-selector.test.js')
    expect(scriptTags('strict-csp-manual.html')).toEqual([])
  })
})
