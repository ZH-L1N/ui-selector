const FRAME_TAGS = new Set(['IFRAME', 'FRAME', 'OBJECT', 'EMBED'])

// src/capture/index.ts — capture(el, ctx) orchestrator: ONE capture path.
//
// Assembles env, element identity, locator, layout, styles, pseudo-elements,
// interaction states, and (deep + trusted only) the deep bundle. Everything
// here delegates to the policy-bearing modules; nothing in this file reads a
// value the allowlists have not already blessed.
import { locate } from '../locate'
import { pickAttributes, visibleText } from '../sanitize'
import type { CaptureContext, CaptureV1, ElementIdentity } from '../types'
import { captureDeep } from './deep'
import { captureEnv } from './env'
import { captureLayout } from './layout'
import { capturePseudo } from './pseudo'
import { matchedRules } from './rules'
import { captureStyles } from './styles'

// Best-effort implicit ARIA roles for common tags — the explicit role attribute
// always wins. Deliberately small: an exhaustive ARIA-in-HTML mapping is not an
// MVP, and a wrong guess is worse than null.
const IMPLICIT_ROLES: Record<string, string> = {
  BUTTON: 'button',
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  IMG: 'img',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  TABLE: 'table',
  TEXTAREA: 'textbox',
  SELECT: 'listbox',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
}

function computedRole(el: Element): string | null {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName
  if (tag === 'A' || tag === 'AREA') return el.hasAttribute('href') ? 'link' : null
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    return INPUT_ROLES[type] ?? 'textbox'
  }
  return IMPLICIT_ROLES[tag] ?? null
}

// Best-effort accessible name from per-element sources only: aria-label, alt,
// the (already sanitized, capped) visible text, then title. aria-labelledby is
// deliberately NOT followed in v1 — it dereferences arbitrary other elements,
// and the design brief already carries the element's own text.
function accessibleName(el: Element, text: string | null): string | null {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const alt = el.getAttribute('alt')
  if (alt) return alt
  if (text) return text
  return el.getAttribute('title')
}

function elementIdentity(el: Element, ctx: CaptureContext): ElementIdentity {
  const text = visibleText(el, ctx.trust, ctx)
  return {
    tagName: el.tagName,
    role: computedRole(el),
    accessibleName: accessibleName(el, text),
    attributes: pickAttributes(el, ctx),
    text,
  }
}

export function capture(el: Element, ctx: CaptureContext): CaptureV1 {
  if (FRAME_TAGS.has(el.tagName)) {
    // A bookmarklet runs only in the top document, so we describe the frame's box and
    // nothing inside it. Without this the output reads as a successful component capture.
    let cross = true
    try {
      cross = (el as HTMLIFrameElement).contentDocument == null
    } catch {
      cross = true                     // a throw is itself a cross-origin signal
    }
    ctx.omit(
      'element.frameContent',
      'frame-content-unreachable',
      cross
        ? 'cross-origin frame: open the frame URL as a top-level page and capture there'
        : 'frames are not traversed in v1; open the frame URL as a top-level page',
    )
  }
  const rules = matchedRules(el, ctx)
  const result: CaptureV1 = {
    schemaVersion: '1.0',
    capturedAt: new Date().toISOString(),
    // origin + pathname, always. location.search and location.hash are never read.
    page: { origin: window.location.origin, pathname: window.location.pathname },
    trust: ctx.trust,
    mode: ctx.mode,
    env: captureEnv(),
    element: elementIdentity(el, ctx),
    locator: locate(el),
    layout: captureLayout(el, ctx),
    styles: captureStyles(el, rules, ctx),
    pseudo: capturePseudo(el, ctx),
    states: rules.states,
    mediaConditions: rules.mediaConditions,
    // The LIVE omissions array, not a snapshot: an omission recorded after
    // assembly (a declined screenshot, say) still shows up in the output the
    // panel serializes.
    omissions: ctx.omissions,
  }
  if (ctx.mode === 'deep') {
    // A Deep request under restricted records the omission rather than
    // throwing; only deep AND trusted produces the bundle.
    if (ctx.trust === 'trusted') result.deep = captureDeep(el, ctx, rules)
    else ctx.omit('deep', 'restricted-mode')
  }
  return result
}
