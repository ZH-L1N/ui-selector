// src/types.ts — CaptureV1 and all sub-types (single source of truth).

export type CaptureMode = 'standard' | 'deep'
export type TrustLevel = 'trusted' | 'restricted'

// The SINGLE source of truth. Every reason emitted anywhere in src/ must appear
// here, and the tables in spec §6.5 and docs/data-contract.md are transcribed
// from it — not maintained in parallel.
export type OmissionReason =
  | 'restricted-mode'
  | 'cross-origin-stylesheet'
  | 'clipped-screenshot'
  | 'unsupported-browser'
  // A transient failure, NOT a capability statement: the browser supports capture, this
  // attempt just did not deliver a frame in time. Reusing 'unsupported-browser' for it
  // told a consuming agent the browser cannot screenshot at all, which is a different
  // and wrong claim. Found by a real click; no synthetic stream is slow enough to hit it.
  | 'no-frame-delivered'
  | 'budget-exceeded'
  | 'user-declined'
  | 'blocked-scheme'
  | 'unsupported-selector'
  | 'unsupported-at-rule'
  | 'shadow-boundary'
  | 'indeterminate-definition'

export interface Omission {
  field: string
  reason: OmissionReason
  detail?: string
}

export interface CaptureContext {
  mode: CaptureMode
  trust: TrustLevel
  omit(field: string, reason: OmissionReason, detail?: string): void
  // Drops every omission already recorded for `field`. A retryable action (the screenshot
  // control can be clicked again) must not leave a stale failure record behind: a panel
  // showing an image while its JSON says "not captured" hands a consuming agent two
  // contradictory facts, and it will believe the wrong one.
  supersede(field: string): void
  omissions: Omission[]
}

// The only way a context is constructed, in production and in tests.
export function makeContext(mode: CaptureMode = 'standard', trust: TrustLevel = 'trusted'): CaptureContext {
  const omissions: Omission[] = []
  return {
    mode,
    trust,
    omissions,
    omit(field, reason, detail) {
      omissions.push(detail === undefined ? { field, reason } : { field, reason, detail })
    },
    supersede(field) {
      for (let i = omissions.length - 1; i >= 0; i--) {
        if (omissions[i].field === field) omissions.splice(i, 1)
      }
    },
  }
}

// --- Locator (Task 3) ---

export interface Locator {
  selector: string
  strategy: 'testid' | 'id' | 'aria' | 'structural'
  confidence: 'exact' | 'ambiguous' | 'unverified'
  matchCount: number
}

// --- Environment and layout (Task 4) ---

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Box {
  top: number
  right: number
  bottom: number
  left: number
}

export interface EnvContext {
  viewport: { width: number; height: number }
  devicePixelRatio: number
  prefersColorScheme: 'light' | 'dark' | 'no-preference'
  colorScheme: string
  themeAttributes: Record<string, string>
}

export interface LayoutContext {
  rect: Rect
  boxModel: { content: Rect; padding: Box; border: Box; margin: Box }
  // Required by spec §6.1: without scroll offsets a viewport-relative rect
  // cannot be reproduced.
  scroll: {
    pageX: number
    pageY: number
    elementScrollTop: number
    elementScrollLeft: number
    scrollParentSelector: string | null
  }
  parent: { display: string; flexFlow?: string; gridTemplate?: string; gap?: string }
  item: { flex?: string; gridArea?: string; alignSelf?: string; order?: string }
  stacking: Array<{ selector: string; position: string; zIndex: string }>
  // A STACKING CONTEXT, deliberately not called a containing block: the
  // containing block of a statically positioned element is generally not the
  // transform ancestor, and the rules differ again for absolute and fixed.
  // What a design brief needs is "what paints above what" — the stacking
  // context — so that is what is captured, under its correct name (spec §6.1).
  nearestStackingContextSelector: string | null
  ancestry: Array<{ tagName: string; role: string | null; display: string }>
}

// --- Matched rules and pseudo-elements (Task 5) ---

export type InteractionState = 'hover' | 'focus-visible' | 'active' | 'disabled'

export interface AppliedRule {
  selector: string
  sheet: string
  // A STACK, not a single string: a rule inside
  // `@media (max-width:600px) { @supports (display:grid) { … } }` carries both
  // conditions, in nesting order, each labeled with its at-rule.
  conditions: string[]
  specificity: [number, number, number]
  declarations: Record<string, string>
  important: string[]
}

export interface StateRule {
  state: InteractionState
  selector: string
  declarations: Record<string, string>
}

// One observed custom-property definition site. `ancestorDepth` is 0 for the
// element itself and increases toward the root: the cascade for an INHERITED
// custom property is nearest-ancestor-first, so a low-specificity `--brand` on
// the immediate parent beats a high-specificity one on `html`. Without owner
// depth, the definition site reported would be wrong on any real themed page.
export interface CustomPropertySite {
  name: string
  value: string
  selector: string
  specificity: [number, number, number]
  ancestorDepth: number
  important: boolean
  sheetIndex: number
  ruleIndex: number
}

export interface MatchedRules {
  applied: AppliedRule[]
  states: StateRule[]
  mediaConditions: string[]
  customProperties: CustomPropertySite[]
}

export interface PseudoBundle {
  content: string
  computed: Record<string, string>
}

// --- Computed styles, variables, typography (Task 6) ---

export interface Typography {
  declaredFamilies: string[]
  webfontStatus: Record<string, 'loaded' | 'loading' | 'unloaded' | 'not-a-webfont'>
  size: string
  lineHeight: string
  letterSpacing: string
  weight: string
  featureSettings: string
}

export interface CssVariable {
  name: string
  resolved: string
  // The OBSERVED definition site: a selector from the matched rules,
  // '[inline]' for a style="--x:…" definition, or null (with an
  // indeterminate-definition omission) when the site cannot be established.
  definedIn: string | null
  usedBy: string[]
}

export interface StyleBundle {
  computed: Record<string, string>
  variables: CssVariable[]
  typography: Typography
}

// --- Element identity and the assembled capture (Task 10) ---

export interface ElementIdentity {
  tagName: string
  // Best-effort computed ARIA role: the explicit role attribute, else a small
  // implicit-role table for common tags. Null when neither applies.
  role: string | null
  accessibleName: string | null
  attributes: Record<string, string>
  text: string | null
}

export interface CaptureV1 {
  schemaVersion: '1.0'
  capturedAt: string
  // Page identity is origin + pathname, always. Never query string, never hash.
  page: { origin: string; pathname: string }
  trust: TrustLevel
  mode: CaptureMode
  env: EnvContext
  element: ElementIdentity
  locator: Locator
  layout: LayoutContext
  styles: StyleBundle
  pseudo: { before?: PseudoBundle; after?: PseudoBundle }
  states: StateRule[]
  // The @media conditions of rules that actually applied (spec §6.1 responsive
  // context). Optional so a hand-written CaptureV1 fixture without responsive
  // context still typechecks; capture() always emits it.
  mediaConditions?: string[]
  omissions: Omission[]
  deep?: DeepBundle
}

// --- Deep mode (Task 11) ---

export interface SanitizedNode {
  tagName: string
  attributes: Record<string, string>
  text: string | null
}

export interface Asset {
  kind: 'img' | 'source' | 'poster' | 'background-image'
  url: string
  naturalWidth: number | null
  naturalHeight: number | null
  objectFit: string | null
  selector: string
}

export interface DeepBundle {
  subtree: SanitizedNode[]
  rules: AppliedRule[]
  keyframes: Array<{ name: string; text: string }>
  assets: Asset[]
}
