// tests/unit/dom.test.ts
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { el } from '../../src/ui/dom'

describe('el', () => {
  it('sets text via textContent so markup in the input is inert', () => {
    globalThis.document = new JSDOM('<body></body>').window.document
    const node = el('div', { text: '<img src=x onerror=alert(1)>' })
    expect(node.childElementCount).toBe(0)
    expect(node.textContent).toContain('<img')
  })

  it('applies inline styles rather than emitting a style element', () => {
    globalThis.document = new JSDOM('<body></body>').window.document
    const node = el('span', { style: { color: 'red' } })
    expect(node.style.color).toBe('red')
    expect(document.querySelectorAll('style')).toHaveLength(0)
  })

  it('sets allowlisted attributes with setAttribute and nests children', () => {
    globalThis.document = new JSDOM('<body></body>').window.document
    const child = el('b', { text: 'inner' })
    const node = el('div', { attrs: { role: 'dialog', 'aria-modal': 'true' } }, [child])
    expect(node.getAttribute('role')).toBe('dialog')
    expect(node.getAttribute('aria-modal')).toBe('true')
    expect(node.firstElementChild).toBe(child)
  })

  it('refuses a style attribute: only CSSOM assignment is CSP-safe', () => {
    globalThis.document = new JSDOM('<body></body>').window.document
    expect(() => el('div', { attrs: { style: 'color:red' } })).toThrow(/style/i)
  })
})
