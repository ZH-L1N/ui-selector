// src/locate.ts — the locator ladder with self-verification.
//
// Ladder order: data-testid -> id -> aria-label (+ tag) -> structural nth-child
// path anchored at the nearest ancestor bearing a stable attribute, else body.
//
// The invariant Spike 3 tests: locate NEVER reports confidence 'exact' without a
// verified single match resolving to the original element. Every candidate is
// re-queried through document.querySelectorAll before any confidence is claimed.
import type { Locator } from './types'

// CSS.escape with a fallback: jsdom (the unit-test environment) does not provide
// CSS.escape, so a spec-shaped serialize-an-identifier fallback keeps the ladder
// working there. Browsers always take the native path.
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(value)
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    const code = value.charCodeAt(i)
    if (code === 0) { out += '�'; continue }
    const digit = code >= 0x30 && code <= 0x39
    if (digit && (i === 0 || (i === 1 && value[0] === '-'))) { out += `\\${code.toString(16)} `; continue }
    if (i === 0 && c === '-' && value.length === 1) { out += `\\${c}`; continue }
    const safe = digit || code >= 0x80 || c === '-' || c === '_' ||
      (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
    out += safe ? c : `\\${c}`
  }
  return out
}

// Attribute values sit inside double quotes, where only the quote and the
// backslash need escaping — CSS.escape would over-escape (e.g. spaces).
function quoteAttr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function verify(selector: string, el: Element): Pick<Locator, 'confidence' | 'matchCount'> {
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(selector)
  } catch {
    return { confidence: 'unverified', matchCount: 0 }
  }
  if (matches.length === 1 && matches[0] === el) return { confidence: 'exact', matchCount: 1 }
  return { confidence: 'ambiguous', matchCount: matches.length }
}

// Structural nth-child path, anchored at the nearest ANCESTOR carrying a stable
// attribute (data-testid or id) so the path stays short and survives sibling
// churn above the anchor; falls back to a full path from body.
function structuralSelector(el: Element): string {
  const path: string[] = []
  let n: Element | null = el
  while (n && n.tagName !== 'BODY' && n.tagName !== 'HTML') {
    if (n !== el) {
      const testid = n.getAttribute('data-testid')
      if (testid) { path.unshift(`[data-testid=${quoteAttr(testid)}]`); return path.join(' > ') }
      if (n.id) { path.unshift(`#${cssEscape(n.id)}`); return path.join(' > ') }
    }
    const parent: Element | null = n.parentElement
    if (!parent) { path.unshift(n.tagName.toLowerCase()); break }
    const index = Array.prototype.indexOf.call(parent.children, n) + 1
    path.unshift(`${n.tagName.toLowerCase()}:nth-child(${index})`)
    n = parent
  }
  return path.length ? path.join(' > ') : el.tagName.toLowerCase()
}

export function locate(el: Element): Locator {
  // Attribute rungs first. Each candidate is verified; the first exact one wins.
  // When an attribute rung exists but is ambiguous (a duplicated data-testid, say)
  // and no lower attribute rung is exact, that ambiguous SEMANTIC candidate is
  // returned rather than falling through to a positional nth-child path: after any
  // dynamic re-render, a structural selector that happened to verify once cannot
  // be trusted more than the duplicated attribute, and reporting it as 'exact'
  // is exactly the confident false positive the spike gate forbids.
  const candidates: Locator[] = []

  const testid = el.getAttribute('data-testid')
  if (testid) {
    const selector = `[data-testid=${quoteAttr(testid)}]`
    candidates.push({ selector, strategy: 'testid', ...verify(selector, el) })
  }
  if (el.id) {
    const selector = `#${cssEscape(el.id)}`
    candidates.push({ selector, strategy: 'id', ...verify(selector, el) })
  }
  const aria = el.getAttribute('aria-label')
  if (aria) {
    const selector = `${el.tagName.toLowerCase()}[aria-label=${quoteAttr(aria)}]`
    candidates.push({ selector, strategy: 'aria', ...verify(selector, el) })
  }

  const exact = candidates.find(c => c.confidence === 'exact')
  if (exact) return exact
  if (candidates.length > 0) return candidates[0]

  const selector = structuralSelector(el)
  return { selector, strategy: 'structural', ...verify(selector, el) }
}
