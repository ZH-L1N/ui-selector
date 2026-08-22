// src/capture/pseudo.ts — ::before / ::after capture. These carry icons,
// carets, rules, and focus decoration, so they ship in Standard mode.
import { STYLE_PROPERTIES } from '../allowlists'
import { reduceCssUrls } from '../sanitize'
import type { CaptureContext, PseudoBundle } from '../types'

// The allowlist keeps `margin` / `padding` as shorthands, but a pseudo-element
// is described by its computed longhands (a shorthand like `0px 4px 0px 0px`
// hides which edge carries the offset), so the four sides are captured too.
const PSEUDO_PROPERTIES: readonly string[] = [
  ...STYLE_PROPERTIES,
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
]

function bundle(el: Element, which: '::before' | '::after', ctx: CaptureContext): PseudoBundle | undefined {
  const cs = getComputedStyle(el, which)
  const content = cs.getPropertyValue('content')
  // `content: none` (or empty) means the pseudo-element does not exist.
  if (!content || content === 'none') return undefined
  const computed: Record<string, string> = {}
  for (const prop of PSEUDO_PROPERTIES) {
    const value = cs.getPropertyValue(prop)
    if (value) computed[prop] = reduceCssUrls(value, 'pseudo', ctx)
  }
  // `content: url(...)` is a first-class form and reaches the Markdown verbatim;
  // it goes through the same reduction as every other style value.
  return { content: reduceCssUrls(content, 'pseudo', ctx), computed }
}

export function capturePseudo(el: Element, ctx: CaptureContext): { before?: PseudoBundle; after?: PseudoBundle } {
  const out: { before?: PseudoBundle; after?: PseudoBundle } = {}
  const before = bundle(el, '::before', ctx)
  if (before) out.before = before
  const after = bundle(el, '::after', ctx)
  if (after) out.after = after
  return out
}
