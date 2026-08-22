// src/capture/rules.ts — matched rules, interaction states, media conditions,
// custom-property definition sites.
//
// `getMatchedCSSRules` no longer exists, so this walks `document.styleSheets`
// and tests `el.matches(selectorText)` per selector-list part.
//
// Stated non-guarantee, mirrored in spec §6.2: matchedRules reports rules
// OBSERVED to match, each with its own specificity, source order and important
// list. It does NOT resolve the cascade — layer precedence, !important across
// layers, and @scope proximity are not computed. Reimplementing the CSS cascade
// inside a bookmarklet is not an MVP, and reporting a resolved winner we cannot
// actually compute would be worse than reporting the evidence.
import { STYLE_PROPERTIES } from '../allowlists'
import { reduceCssUrls, reducedUrl } from '../sanitize'
import type { CaptureContext, InteractionState, MatchedRules } from '../types'
import { splitSelectorList, specificity, stripStatePseudo } from './selector'

// Sheet provenance and omission details carry the REDUCED href only (origin +
// pathname): a stylesheet URL's query string can hold signed-URL credentials
// (?X-Amz-Signature=…, ?token=…), and spec §6.4 bans query parameters from the
// output in any mode. `fallback` is 'unknown' or the inline#N provenance id.
export function sheetLabel(href: string | null, fallback: string): string {
  return href ? reducedUrl(href, document.baseURI) || 'unknown' : fallback
}

interface RuleSite { sheet: string; sheetIndex: number; ruleIndex: number }
interface Conditions { media: string[]; supports: string[] }

const STATES: readonly InteractionState[] = ['hover', 'focus-visible', 'active', 'disabled']

function eachStyleRule(ctx: CaptureContext,
                       visit: (rule: CSSStyleRule, conditions: Conditions, site: RuleSite) => void): void {
  const seen = new WeakSet<CSSStyleSheet>()      // @import graphs can be cyclic
  // ruleIndex is a DOCUMENT-ORDER counter across all sheets and nested rule
  // lists, not the index within the current CSSRuleList: a nested list restarts
  // its own indices at 0, which breaks "later source order wins" tie-breaks
  // between a top-level rule and one inside an @media block.
  let order = 0
  // Every rule type is feature-detected through globalThis: a bare
  // `rule instanceof CSSLayerBlockRule` throws ReferenceError in any engine that
  // lacks the constructor, which would take down the whole walk on a
  // best-effort browser.
  const isType = (rule: CSSRule, name: string): boolean => {
    const ctor = (globalThis as unknown as Record<string, unknown>)[name]
    return typeof ctor === 'function' && rule instanceof (ctor as new () => CSSRule)
  }

  // `conditions` is rebuilt at each level, never mutated: a nested @supports
  // inside an @media must CARRY its parent condition, not replace it. Media and
  // supports are kept in SEPARATE lists — feeding a supports condition to
  // matchMedia would silently misclassify the responsive field.
  function walkSheet(target: CSSStyleSheet, sIdx: number, conditions: Conditions): void {
    if (seen.has(target)) return                 // cyclic @import: stop, do not hang
    seen.add(target)
    let list: CSSRuleList
    try {
      list = target.cssRules                     // throws on cross-origin
    } catch {
      ctx.omit('styles.matchedRules', 'cross-origin-stylesheet', sheetLabel(target.href, 'unknown'))
      return
    }
    // Two inline <style> sheets both have a null href; index the fallback id so
    // provenance still distinguishes them.
    walk(list, conditions, sheetLabel(target.href, `inline#${sIdx}`), sIdx)
  }

  function walk(list: CSSRuleList, conditions: Conditions, sheetId: string, sIdx: number): void {
    Array.from(list).forEach(rule => {
      if (isType(rule, 'CSSMediaRule'))
        walk((rule as CSSMediaRule).cssRules,
             { ...conditions, media: [...conditions.media, (rule as CSSMediaRule).conditionText] },
             sheetId, sIdx)
      else if (isType(rule, 'CSSSupportsRule'))
        walk((rule as CSSGroupingRule).cssRules,
             { ...conditions, supports: [...conditions.supports, (rule as CSSSupportsRule).conditionText] },
             sheetId, sIdx)
      else if (isType(rule, 'CSSLayerBlockRule'))
        walk((rule as CSSGroupingRule).cssRules, conditions, sheetId, sIdx)   // layer ORDER not modelled
      else if (isType(rule, 'CSSImportRule')) {
        const imp = rule as CSSImportRule
        // An @import carries its own media condition, and the imported sheet's
        // rules belong to THAT sheet's provenance, not the importing one.
        const mediaText = imp.media?.mediaText
        if (imp.styleSheet) {
          walkSheet(imp.styleSheet,
                    sIdx,
                    mediaText ? { ...conditions, media: [...conditions.media, mediaText] } : conditions)
        }
      }
      else if (isType(rule, 'CSSContainerRule') || isType(rule, 'CSSScopeRule'))
        ctx.omit('styles.matchedRules', 'unsupported-at-rule', rule.constructor.name)
      else if (isType(rule, 'CSSStyleRule'))
        visit(rule as CSSStyleRule, conditions, { sheet: sheetId, sheetIndex: sIdx, ruleIndex: order++ })
    })
  }

  Array.from(document.styleSheets).forEach((sheet, sheetIndex) => {
    walkSheet(sheet, sheetIndex, { media: [], supports: [] })
  })
}

function pickDeclarations(style: CSSStyleDeclaration, ctx: CaptureContext): { declarations: Record<string, string>; important: string[] } {
  const declarations: Record<string, string> = {}
  const important: string[] = []
  for (const prop of STYLE_PROPERTIES) {
    const value = style.getPropertyValue(prop)
    if (!value) continue
    // Author-declared values are copied verbatim otherwise, and cursor /
    // filter / backdrop-filter carry url() — reduce like every style value.
    declarations[prop] = reduceCssUrls(value, 'styles.matchedRules', ctx)
    if (style.getPropertyPriority(prop) === 'important') important.push(prop)
  }
  return { declarations, important }
}

export function matchedRules(el: Element, ctx: CaptureContext): MatchedRules {
  const out: MatchedRules = { applied: [], states: [], mediaConditions: [], customProperties: [] }
  const mediaSeen = new Set<string>()

  // Does every condition on a rule currently hold? Memoized per condition text.
  // Unevaluable conditions (an engine without matchMedia/CSS.supports for the
  // form) count as holding: dropping evidence would be worse than keeping it.
  const conditionCache = new Map<string, boolean>()
  const holds = (kind: 'media' | 'supports', text: string): boolean => {
    const key = `${kind} ${text}`
    let v = conditionCache.get(key)
    if (v === undefined) {
      try {
        v = kind === 'media' ? matchMedia(text).matches : CSS.supports(text)
      } catch {
        v = true
      }
      conditionCache.set(key, v)
    }
    return v
  }
  const conditionsActive = (c: Conditions): boolean =>
    c.media.every(m => holds('media', m)) && c.supports.every(s => holds('supports', s))

  // [el, ...ancestors]: index = ancestorDepth for custom-property owners.
  const chain: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n)

  eachStyleRule(ctx, (rule, conditions, site) => {
    for (const part of splitSelectorList(rule.selectorText)) {
      // CSS nesting (&): relative selectors are not resolved.
      if (part.includes('&')) {
        ctx.omit('styles.matchedRules', 'unsupported-selector', part)
        continue
      }

      let applies = false
      try {
        applies = el.matches(part)
      } catch {
        ctx.omit('styles.matchedRules', 'unsupported-selector', part)
        continue
      }

      // Interaction-state classification runs FIRST, independent of whether the
      // part currently matches: in the real flow the pointer is resting on the
      // element it just clicked, so a `.btn:hover` rule DOES match at capture
      // time — and a selected disabled control matches its own `:disabled`
      // rule. Filing those as ordinary applied rules would make `states`
      // pointer-dependent (hover would never appear in a real capture) and
      // attribute state-only declarations, and their tokens, to the base state.
      let isStateRule = false
      for (const state of STATES) {
        if (!part.includes(`:${state}`)) continue
        const base = stripStatePseudo(part, state)
        if (base === null) {
          // Present only inside a functional pseudo (`:not(:hover)`): decline
          // to classify rather than mis-classify. A part that currently
          // matches is still an ordinary applied rule below.
          if (!applies) ctx.omit('styles.matchedRules', 'unsupported-selector', part)
          continue
        }
        let baseMatches = false
        try {
          baseMatches = el.matches(base)
        } catch {
          ctx.omit('styles.matchedRules', 'unsupported-selector', part)
          continue
        }
        if (baseMatches) {
          isStateRule = true
          out.states.push({ state, selector: part, declarations: pickDeclarations(rule.style, ctx).declarations })
        }
      }

      if (applies && !isStateRule) {
        // Specificity of :is()/:not()/:where() is approximated by the outer
        // form (see selector.ts); say so instead of claiming precision.
        if (/:(is|not|where)\(/.test(part)) {
          ctx.omit('styles.matchedRules', 'unsupported-selector', `specificity approximated: ${part}`)
        }
        const { declarations, important } = pickDeclarations(rule.style, ctx)
        out.applied.push({
          selector: part,
          sheet: site.sheet,
          conditions: [
            ...conditions.media.map(m => `@media ${m}`),
            ...conditions.supports.map(s => `@supports ${s}`),
          ],
          specificity: specificity(part),
          declarations,
          important,
        })
        // mediaConditions draws from conditions.media ONLY — never supports —
        // and only for applied rules whose condition currently matches.
        for (const m of conditions.media) {
          if (!mediaSeen.has(m) && matchMedia(m).matches) {
            mediaSeen.add(m)
            out.mediaConditions.push(m)
          }
        }
      }

      // Custom properties are collected from any rule matching the element OR
      // an ancestor: an inherited token is defined upstream, and Task 6 names
      // its definition site from exactly this record.
      let depth = -1
      for (let d = 0; d < chain.length; d++) {
        try {
          if (chain[d].matches(part)) { depth = d; break }
        } catch {
          break
        }
      }
      if (depth < 0) continue
      // A definition site inside a non-matching @media/@supports is not in
      // effect. The resolved value read from computed style honours the active
      // conditions, so the recorded sites must too — CustomPropertySite carries
      // no conditions field, and betterSite would otherwise name a selector
      // whose declared value contradicts the resolved one.
      if (!conditionsActive(conditions)) continue
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style.item(i)
        if (!name.startsWith('--')) continue
        out.customProperties.push({
          name,
          value: rule.style.getPropertyValue(name).trim(),
          selector: part,
          specificity: specificity(part),
          ancestorDepth: depth,
          important: rule.style.getPropertyPriority(name) === 'important',
          sheetIndex: site.sheetIndex,
          ruleIndex: site.ruleIndex,
        })
      }
    }
  })

  return out
}
