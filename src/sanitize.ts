// src/sanitize.ts — URL reduction, bounded text capture, attribute picking.
// This is the privacy core: every path here is deny-by-default.
import { ARIA_ATTRIBUTE_ALLOWLIST, ATTRIBUTE_ALLOWLIST, CAPS, REDUCED_URL_ATTRIBUTES, TEXT_FORBIDDEN_TAGS } from './allowlists'
import type { CaptureContext, TrustLevel } from './types'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export function reducedUrl(raw: string, base: string): string {
  // Internal whitespace marks input that was never a URL. Relative-reference
  // resolution would otherwise "repair" it (percent-encoding the spaces) and echo
  // the junk into the output path — the opposite of refusing to launder it.
  const trimmed = raw.trim()
  if (/\s/.test(trimmed)) return ''
  let u: URL
  try {
    u = new URL(trimmed, base)
  } catch {
    return ''
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return ''     // javascript:, data:, blob:, mailto:, file:
  return `${u.origin}${u.pathname}`
}

// CSS VALUES carry URLs too: cursor, filter, backdrop-filter, pseudo content,
// and any custom property a rule feeds into them accept url(), and the engine
// resolves it in the computed value to an ABSOLUTE URL with query string and
// fragment intact — the exact material spec §6.4 bans in any mode. Every style
// value that reaches the output goes through here: each url() token is reduced
// to origin + pathname, and a non-http(s) scheme is dropped as url() with a
// blocked-scheme omission. Over-matching (a literal "url(" inside a quoted
// content string) errs toward reduction, never toward leaking.
const CSS_URL = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)"']*))\s*\)/g

export function reduceCssUrls(value: string, field: string, ctx: CaptureContext): string {
  if (!value.includes('url(')) return value
  return value.replace(CSS_URL, (_m, dq: string, sq: string, bare: string) => {
    const raw = (dq ?? sq ?? bare ?? '').trim()
    const reduced = reducedUrl(raw, document.baseURI)
    if (!reduced) {
      ctx.omit(field, 'blocked-scheme', 'url() value dropped')
      return 'url()'
    }
    return `url("${reduced}")`
  })
}

function isEditable(el: Element): boolean {
  // `contenteditable=""` and `contenteditable="plaintext-only"` are BOTH editable.
  // Only `false` turns it off, and it inherits — so use the property, not the string.
  return (el as HTMLElement).isContentEditable === true ||
    (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
}

// Visual suppression must be judged against the ANCESTOR CHAIN, not the element
// alone: `getComputedStyle(child).display` inside a `display:none` parent returns the
// child's own specified display, not `none`. Selecting such a child directly would
// therefore have leaked its text.
function isVisuallySuppressed(el: Element): boolean {
  if ((el as HTMLElement).checkVisibility) {
    // Handles display:none anywhere above, visibility hidden/collapse, and
    // content-visibility. opacity is deliberately NOT treated as suppression: opacity:0
    // text is still in the layout and is often a real design state.
    if (!(el as HTMLElement).checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return true
  }
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return true
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true
  }
  return false
}

// Shared with Deep mode's subtree walk (Task 11): ONE boundary definition,
// including the ancestor-chain visibility check, not two drifting copies.
export function isForbiddenSubtree(el: Element): boolean {
  if (TEXT_FORBIDDEN_TAGS.has(el.tagName)) return true
  if (isEditable(el)) return true
  return isVisuallySuppressed(el)
}

// A TreeWalker does not cross a shadow root in either direction, so silence there
// must be reported rather than inferred. The honest limit, stated in spec §6.1: a
// host whose shadow root is CLOSED is not detectable after the fact — el.shadowRoot
// is null for it and there is no other accessor.
export function noteShadowBoundary(el: Element, ctx: CaptureContext): void {
  if (el.shadowRoot) ctx.omit('element.text', 'shadow-boundary', 'open shadow root not traversed')
  const root = el.getRootNode()
  if (root instanceof ShadowRoot) {
    ctx.omit('element.text', 'shadow-boundary', `element lives inside a ${root.mode} shadow tree`)
  }
  if ((el as HTMLElement).assignedSlot) {
    ctx.omit('element.text', 'shadow-boundary', 'slotted content; light and shadow trees differ')
  }
}

export function visibleText(el: Element, trust: TrustLevel, ctx: CaptureContext): string | null {
  // The walker never applies its filter to its own root, so the root is checked here
  // with the SAME predicate. Without this, selecting a `[hidden]` or `display:none`
  // container — or an editable one — emits exactly the text the filter exists to hide.
  if (isForbiddenSubtree(el)) return null
  noteShadowBoundary(el, ctx)
  const cap = trust === 'trusted' ? CAPS.textTrusted : CAPS.textRestricted
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return isForbiddenSubtree(node as Element)
          ? NodeFilter.FILTER_REJECT              // REJECT skips the whole subtree
          : NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const parts: string[] = []
  let chars = 0, visits = 0
  while (walker.nextNode()) {
    if (++visits > CAPS.textNodeVisits) { ctx.omit('element.text', 'budget-exceeded', 'node visits'); break }
    const raw = walker.currentNode.nodeValue ?? ''
    const room = cap - chars - (parts.length ? 1 : 0)
    if (room <= 0) { ctx.omit('element.text', 'budget-exceeded', 'character cap'); break }
    // Slice before normalizing so one multi-megabyte text node is never materialized in
    // full — but with headroom, because collapsing runs of whitespace shrinks the
    // string. Without headroom, "   " + 500 chars returns fewer than `room` characters.
    // Exact character utilization is explicitly NOT part of the contract; staying at or
    // under the cap is.
    const t = raw.slice(0, room * 4 + 8).replace(/\s+/g, ' ').trim().slice(0, room)
    if (!t) continue
    parts.push(t)
    chars += t.length + (parts.length > 1 ? 1 : 0)
  }
  return parts.join(' ')
}

export function pickAttributes(el: Element, ctx: CaptureContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name
    // ARIA is a closed per-attribute list, NOT a prefix: aria-checked and
    // aria-valuenow/-valuetext on custom widgets carry the user's form value.
    if (!((ATTRIBUTE_ALLOWLIST as readonly string[]).includes(name) ||
          (ARIA_ATTRIBUTE_ALLOWLIST as readonly string[]).includes(name) ||
          name === 'data-testid')) continue
    if ((REDUCED_URL_ATTRIBUTES as readonly string[]).includes(name)) {
      const reduced = reducedUrl(attr.value, document.baseURI)
      if (!reduced) { ctx.omit(`attributes.${name}`, 'blocked-scheme'); continue }
      out[name] = reduced
    } else {
      out[name] = attr.value
    }
  }
  return out
}
