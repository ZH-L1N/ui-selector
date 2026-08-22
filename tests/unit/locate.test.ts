// tests/unit/locate.test.ts
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { locate } from '../../src/locate'

const dom = (html: string) => {
  const w = new JSDOM(html).window
  globalThis.document = w.document
  globalThis.CSS = w.CSS
  return w.document
}

describe('locate', () => {
  it('prefers data-testid and reports an exact match', () => {
    const d = dom('<div><button data-testid="save">S</button></div>')
    expect(locate(d.querySelector('button')!)).toEqual({
      selector: '[data-testid="save"]', strategy: 'testid', confidence: 'exact', matchCount: 1,
    })
  })

  it('falls back to id, escaping CSS-unsafe characters', () => {
    const d = dom('<button id="a.b">S</button>')
    const r = locate(d.querySelector('button')!)
    expect(r.strategy).toBe('id')
    expect(d.querySelectorAll(r.selector)).toHaveLength(1)
  })

  it('uses aria-label plus role when no testid or id exists', () => {
    const d = dom('<button aria-label="Close dialog">x</button>')
    expect(locate(d.querySelector('button')!).strategy).toBe('aria')
  })

  it('marks a duplicated attribute selector ambiguous instead of claiming exact', () => {
    const d = dom('<button data-testid="dup">a</button><button data-testid="dup">b</button>')
    const r = locate(d.querySelectorAll('button')[1]!)
    expect(r.confidence).toBe('ambiguous')
    expect(r.matchCount).toBe(2)
  })

  it('builds a structural path that resolves to exactly the target', () => {
    const d = dom('<main><section><p>a</p><p>b</p></section></main>')
    const target = d.querySelectorAll('p')[1]!
    const r = locate(target)
    expect(r.strategy).toBe('structural')
    expect(d.querySelectorAll(r.selector)).toHaveLength(1)
    expect(d.querySelector(r.selector)).toBe(target)
  })
})
