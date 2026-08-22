// src/capture/deep.ts — Deep mode: sanitized subtree DOM, keyframes, asset
// metadata. Trusted origins only; capture() enforces that gate.
//
// The subtree walk shares isForbiddenSubtree from Task 2 — including the
// ancestor-chain visibility check — and refuses to DESCEND into a forbidden
// subtree at all: a <textarea> must not appear as a node, let alone as text.
// It does not cross shadow roots (children never contains a shadow tree, and
// node.shadowRoot is never walked), matching the Standard-mode boundary
// exactly rather than defining a second one.
import { CAPS } from '../allowlists'
import { locate } from '../locate'
import { isForbiddenSubtree, noteShadowBoundary, pickAttributes, reduceCssUrls, reducedUrl, visibleText } from '../sanitize'
import type { Asset, CaptureContext, DeepBundle, MatchedRules, SanitizedNode } from '../types'
import { matchedRules, sheetLabel } from './rules'

function walkSubtree(el: Element, ctx: CaptureContext): { subtree: SanitizedNode[]; kept: Element[] } {
  const subtree: SanitizedNode[] = []
  const kept: Element[] = []
  // The selected root itself is subject to the same predicate as everything
  // below it: a forbidden root yields an empty subtree, not a leaked node.
  if (isForbiddenSubtree(el)) return { subtree, kept }
  const queue: Element[] = [el]
  let chars = 0
  while (queue.length > 0) {
    const node = queue.shift()!
    // Pruned means the whole branch: children of a forbidden node are never
    // enqueued, so nothing below an <input> or a hidden container is visited.
    if (node !== el && isForbiddenSubtree(node)) continue
    if (subtree.length >= CAPS.deepNodes) {
      ctx.omit('deep.subtree', 'budget-exceeded', `more than ${CAPS.deepNodes} nodes`)
      break
    }
    const text = visibleText(node, ctx.trust, ctx)
    chars += text?.length ?? 0
    if (chars > CAPS.deepChars) {
      ctx.omit('deep.subtree', 'budget-exceeded', `more than ${CAPS.deepChars} characters`)
      break
    }
    subtree.push({ tagName: node.tagName, attributes: pickAttributes(node, ctx), text })
    kept.push(node)
    // Light-DOM children only: this walk never crosses a shadow boundary.
    for (const child of Array.from(node.children)) queue.push(child)
  }
  return { subtree, kept }
}

// Comma-separated computed animation-name list; 'none' means no animation.
function animationNames(el: Element): string[] {
  const raw = getComputedStyle(el).animationName || ''
  return raw.split(',').map(s => s.trim()).filter(name => name && name !== 'none')
}

// Keyframes are matched BY NAME against the element's computed animation-name.
// Later definitions of the same name overwrite earlier ones, as the cascade does.
function collectKeyframes(el: Element, ctx: CaptureContext): DeepBundle['keyframes'] {
  const names = animationNames(el)
  if (names.length === 0) return []

  // Same feature-detection pattern as rules.ts: a bare instanceof on a
  // constructor the engine lacks is a ReferenceError.
  const isType = (rule: CSSRule, name: string): boolean => {
    const ctor = (globalThis as unknown as Record<string, unknown>)[name]
    return typeof ctor === 'function' && rule instanceof (ctor as new () => CSSRule)
  }

  const byName = new Map<string, string>()
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (isType(rule, 'CSSKeyframesRule')) {
        const kf = rule as CSSKeyframesRule
        // cssText is author CSS verbatim and can carry url() (an animated
        // background-image, say) — reduce like every other style value.
        if (names.includes(kf.name)) byName.set(kf.name, reduceCssUrls(kf.cssText, 'deep.keyframes', ctx))
      } else if (
        isType(rule, 'CSSMediaRule') || isType(rule, 'CSSSupportsRule') ||
        isType(rule, 'CSSLayerBlockRule')
      ) {
        walk((rule as CSSGroupingRule).cssRules)
      } else if (isType(rule, 'CSSImportRule')) {
        const imported = (rule as CSSImportRule).styleSheet
        if (imported) {
          try {
            walk(imported.cssRules)
          } catch {
            // sheetLabel reduces the href: a stylesheet URL's query string can
            // hold signed-URL credentials and must not reach the detail.
            ctx.omit('deep.keyframes', 'cross-origin-stylesheet', sheetLabel(imported.href, 'unknown'))
          }
        }
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules)
    } catch {
      ctx.omit('deep.keyframes', 'cross-origin-stylesheet', sheetLabel(sheet.href, 'unknown'))
    }
  }
  // Output in animation-name order, only names that were actually defined.
  return names.filter(name => byName.has(name)).map(name => ({ name, text: byName.get(name)! }))
}

const BG_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g

// Detail carries the SCHEME only, never the payload: a data: URL's body is
// exactly the asset bytes this collector exists to keep out of the output.
function schemeOf(raw: string): string {
  const m = /^\s*([a-zA-Z][\w+.-]*):/.exec(raw)
  return m ? `${m[1].toLowerCase()}:` : 'unparseable'
}

function collectAssets(kept: Element[], ctx: CaptureContext): Asset[] {
  const assets: Asset[] = []
  let over = false
  const push = (asset: Asset): void => {
    if (assets.length >= CAPS.deepAssets) {
      if (!over) ctx.omit('deep.assets', 'budget-exceeded', `more than ${CAPS.deepAssets} assets`)
      over = true
      return
    }
    assets.push(asset)
  }
  const reduce = (raw: string, kind: Asset['kind']): string | null => {
    const url = reducedUrl(raw, document.baseURI)
    if (!url) {
      ctx.omit('deep.assets', 'blocked-scheme', `${kind} with ${schemeOf(raw)} URL dropped`)
      return null
    }
    return url
  }

  // Sources in the contract's order: img[src], picture > source[srcset] (first
  // candidate URL only), video[poster], then computed background-image url()s.
  for (const node of kept) {
    const src = node.tagName === 'IMG' ? node.getAttribute('src') : null
    if (!src) continue
    const url = reduce(src, 'img')
    if (!url) continue
    const img = node as HTMLImageElement
    push({
      kind: 'img',
      url,
      // Natural dimensions from the live element where available; 0 means not
      // loaded, which reports as null. Cross-origin images still report their
      // natural dimensions — that is not tainted information.
      naturalWidth: img.naturalWidth || null,
      naturalHeight: img.naturalHeight || null,
      objectFit: getComputedStyle(node).objectFit || null,
      selector: locate(node).selector,
    })
  }
  for (const node of kept) {
    if (node.tagName !== 'SOURCE' || node.parentElement?.tagName !== 'PICTURE') continue
    const srcset = node.getAttribute('srcset')
    if (!srcset) continue
    const first = srcset.split(',')[0].trim().split(/\s+/)[0]
    if (!first) continue
    const url = reduce(first, 'source')
    if (!url) continue
    push({ kind: 'source', url, naturalWidth: null, naturalHeight: null, objectFit: null,
           selector: locate(node).selector })
  }
  for (const node of kept) {
    const poster = node.tagName === 'VIDEO' ? node.getAttribute('poster') : null
    if (!poster) continue
    const url = reduce(poster, 'poster')
    if (!url) continue
    push({ kind: 'poster', url, naturalWidth: null, naturalHeight: null,
           objectFit: getComputedStyle(node).objectFit || null, selector: locate(node).selector })
  }
  for (const node of kept) {
    const bg = getComputedStyle(node).backgroundImage
    if (!bg || bg === 'none') continue
    for (const m of bg.matchAll(BG_URL)) {
      const url = reduce(m[2], 'background-image')
      if (!url) continue
      push({ kind: 'background-image', url, naturalWidth: null, naturalHeight: null,
             objectFit: null, selector: locate(node).selector })
    }
  }
  return assets
}

// `rules` is optional so capture() can hand over the MatchedRules it already
// computed (avoiding a second CSSOM walk and duplicated omissions), while the
// contract signature captureDeep(el, ctx) still stands alone for tests.
export function captureDeep(el: Element, ctx: CaptureContext, rules?: MatchedRules): DeepBundle {
  noteShadowBoundary(el, ctx)
  const applied = (rules ?? matchedRules(el, ctx)).applied
  const { subtree, kept } = walkSubtree(el, ctx)
  return {
    subtree,
    rules: applied,
    keyframes: collectKeyframes(el, ctx),
    assets: collectAssets(kept, ctx),
  }
}
