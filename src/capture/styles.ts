// src/capture/styles.ts — computed allowlist, CSS variables, typography.
//
// captureStyles takes the ALREADY-COMPUTED MatchedRules. It does not re-walk
// the CSSOM, and it does not guess: an earlier draft tried to name a token's
// definition site by comparing an ancestor's computed value to its parent's,
// which cannot work — custom properties inherit, so `html`, `body`, and the
// element all compute the same value and no comparison distinguishes the
// definition site. The declaration read out of the matched rules is the only
// correct route, and it is why the rules task runs first.
import { STYLE_PROPERTIES } from '../allowlists'
import { reduceCssUrls } from '../sanitize'
import type { CaptureContext, CustomPropertySite, MatchedRules, StyleBundle, Typography } from '../types'
import { splitSelectorList } from './selector'

const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g

const compareSpecificity = (
  x: [number, number, number],
  y: [number, number, number],
): number => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]

// Ordering for the observed definition site: smallest ancestorDepth first,
// then important, then specificity, then sheetIndex/ruleIndex (later source
// order wins a full tie, as the cascade does — ruleIndex is the rules walk's
// DOCUMENT-ORDER counter, so it compares correctly across nested rule lists).
//
// Depth must dominate specificity, not the reverse: an inherited custom
// property resolves per element, nearest ancestor first, so on a themed page
// `html body .deep { --brand:#111 }` outranks `.theme-dark { --brand:#fff }`
// on specificity yet still loses when `.theme-dark` is the nearer ancestor —
// precisely the shape tokens-override.html is built to catch.
function betterSite(cand: CustomPropertySite, cur: CustomPropertySite): boolean {
  if (cand.ancestorDepth !== cur.ancestorDepth) return cand.ancestorDepth < cur.ancestorDepth
  if (cand.important !== cur.important) return cand.important
  const s = compareSpecificity(cand.specificity, cur.specificity)
  if (s !== 0) return s > 0
  if (cand.sheetIndex !== cur.sheetIndex) return cand.sheetIndex > cur.sheetIndex
  return cand.ruleIndex > cur.ruleIndex
}

// Do a rule's recorded @media/@supports conditions currently hold? A rule
// inside a non-matching @media contributes NO declared value to the element,
// so it must not win the declared-value map — otherwise the dark-mode or
// wide-viewport token is reported as the element's token. This is a
// currently-holds check on a derived Standard-mode field, not cascade
// resolution: rules.applied still carries every observed rule, conditions and
// all. Unevaluable conditions count as holding rather than dropping evidence.
function conditionsHold(conditions: string[]): boolean {
  for (const c of conditions) {
    try {
      if (c.startsWith('@media ') && !window.matchMedia(c.slice(7)).matches) return false
      if (c.startsWith('@supports ') && !CSS.supports(c.slice(10))) return false
    } catch {
      // keep the rule
    }
  }
  return true
}

function unquote(value: string): string {
  const t = value.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

// Typography ships only what is exact. `document.fonts.check()` does NOT
// answer "is the first declared family installed" — it can return true for a
// family the engine will never render — so no field claims to. A canvas
// measureText heuristic against monospace/serif sentinels was deliberately CUT:
// it produces silent false negatives whenever a family's metrics coincide with
// a sentinel, and a design brief that says "this font did not render" when it
// did is worse than one that stays silent.
function captureTypography(cs: CSSStyleDeclaration, ctx: CaptureContext): Typography {
  // splitSelectorList is quote-aware, which is exactly what a font-family list
  // needs ('"Foo, Bar", serif' must not split inside the quoted name).
  const declaredFamilies = splitSelectorList(cs.getPropertyValue('font-family')).map(unquote)

  const webfontStatus: Typography['webfontStatus'] = {}
  try {
    const faces: Array<{ family: string; status: FontFaceLoadStatus }> = []
    document.fonts.forEach(face => faces.push({ family: unquote(face.family), status: face.status }))
    for (const family of declaredFamilies) {
      const matching = faces.filter(f => f.family === family)
      if (matching.length === 0) {
        webfontStatus[family] = 'not-a-webfont'
      } else if (matching.some(f => f.status === 'loaded')) {
        webfontStatus[family] = 'loaded'
      } else if (matching.some(f => f.status === 'loading')) {
        webfontStatus[family] = 'loading'
      } else {
        webfontStatus[family] = 'unloaded'       // 'unloaded' and 'error' faces
      }
    }
  } catch {
    ctx.omit('typography.webfontStatus', 'unsupported-browser', 'document.fonts unavailable')
  }

  return {
    declaredFamilies,
    webfontStatus,
    size: cs.getPropertyValue('font-size'),
    lineHeight: cs.getPropertyValue('line-height'),
    letterSpacing: cs.getPropertyValue('letter-spacing'),
    weight: cs.getPropertyValue('font-weight'),
    featureSettings: cs.getPropertyValue('font-feature-settings'),
  }
}

export function captureStyles(el: Element, rules: MatchedRules, ctx: CaptureContext): StyleBundle {
  const cs = getComputedStyle(el)

  const computed: Record<string, string> = {}
  for (const prop of STYLE_PROPERTIES) {
    // cursor / filter / backdrop-filter accept url(); reduce, never verbatim.
    const value = cs.getPropertyValue(prop)
    if (value) computed[prop] = reduceCssUrls(value, 'styles.computed', ctx)
  }

  // The DECLARED value per allowlisted property, from the applied rules whose
  // conditions currently hold: !important outranks specificity (same-origin
  // author rules — the cross-LAYER caveat stays disclaimed in spec §6.2), then
  // highest specificity wins, later source order breaks ties (rules.applied is
  // in walk order, so >= keeps the later declaration on a full tie).
  const declared = new Map<string, { value: string; specificity: [number, number, number]; important: boolean }>()
  for (const rule of rules.applied) {
    if (!conditionsHold(rule.conditions)) continue
    for (const [prop, value] of Object.entries(rule.declarations)) {
      const important = rule.important.includes(prop)
      const current = declared.get(prop)
      const wins = !current
        || (important !== current.important
              ? important
              : compareSpecificity(rule.specificity, current.specificity) >= 0)
      if (wins) declared.set(prop, { value, specificity: rule.specificity, important })
    }
  }

  // Which variables those declared values reference, and where.
  const usedBy = new Map<string, Set<string>>()
  for (const [prop, d] of declared) {
    for (const m of d.value.matchAll(VAR_REFERENCE)) {
      const name = m[1]
      let props = usedBy.get(name)
      if (!props) { props = new Set(); usedBy.set(name, props) }
      props.add(prop)
    }
  }

  // [el, ...ancestors]: index = ancestorDepth, for inline definitions.
  const chain: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n)

  const variables: StyleBundle['variables'] = []
  for (const [name, props] of usedBy) {
    // A token holding url() (e.g. --icon fed into cursor) resolves with the
    // query string intact; reduce it like any other style value.
    const resolved = reduceCssUrls(cs.getPropertyValue(name).trim(), 'styles.variables', ctx)

    // Inline style="--x:…" definitions never appear in document.styleSheets.
    let inlineDepth = -1
    for (let d = 0; d < chain.length; d++) {
      const style = (chain[d] as HTMLElement).style
      if (style && style.getPropertyValue(name)) { inlineDepth = d; break }
    }

    let best: CustomPropertySite | null = null
    for (const site of rules.customProperties) {
      if (site.name !== name) continue
      if (!best || betterSite(site, best)) best = site
    }

    let definedIn: string | null
    if (inlineDepth >= 0 && (best === null || inlineDepth <= best.ancestorDepth)) {
      // Inline beats every stylesheet rule at equal depth.
      definedIn = '[inline]'
    } else if (best) {
      definedIn = best.selector
    } else {
      // A cross-origin sheet, a UA default, or a skipped @container/@scope
      // block. Silence here would read as "no token involved" — the opposite
      // of the truth — so the omission names the variable.
      definedIn = null
      ctx.omit('styles.variables', 'indeterminate-definition', name)
    }

    variables.push({ name, resolved, definedIn, usedBy: [...props] })
  }

  return { computed, variables, typography: captureTypography(cs, ctx) }
}
