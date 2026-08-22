# ui-selector data contract — `CaptureV1`

`schemaVersion: "1.0"`. This document describes the JSON one capture produces. It is
transcribed from [`src/types.ts`](../src/types.ts), which is the single source of truth —
if the two ever disagree, the types win and this file is the bug.

The Markdown output is a rendering of exactly this object
([`src/ui/markdown.ts`](../src/ui/markdown.ts)), never a second pass over the DOM, so
everything below is equally true of it.

Two things deliberately absent from the schema:

- **The screenshot.** A captured frame is a `<canvas>` living in the panel
  (`Screenshot { canvas, rect, scale, clipped }` in [`src/shot.ts`](../src/shot.ts)). No
  image bytes ever enter `CaptureV1`; a refusal, a clip, or an unsupported browser shows
  up as an `omissions` entry instead.
- **Anything from §6.4 of the spec.** Cookies, storage, form values, framework state,
  the URL query string or hash, and `contenteditable` text have no field to land in. See
  [the README](../README.md#what-it-never-captures).

## Top level

| Field             | Type                                              | Notes                                                                                                                                                            |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`   | `"1.0"`                                           | Literal.                                                                                                                                                         |
| `capturedAt`      | `string`                                          | ISO 8601, from `new Date().toISOString()`.                                                                                                                       |
| `page`            | `{ origin, pathname }`                            | **Page identity is origin + pathname, always.** `location.search` and `location.hash` are never read.                                                            |
| `trust`           | `"trusted" \| "restricted"`                       | The gate's decision for this run.                                                                                                                                |
| `mode`            | `"standard" \| "deep"`                            | Deep is trusted-only; see `omissions` when it was requested and refused.                                                                                         |
| `env`             | `EnvContext`                                      | Capture environment.                                                                                                                                             |
| `element`         | `ElementIdentity`                                 | What the element is.                                                                                                                                             |
| `locator`         | `Locator`                                         | How to find it again.                                                                                                                                            |
| `layout`          | `LayoutContext`                                   | Where it is and why.                                                                                                                                             |
| `styles`          | `StyleBundle`                                     | Computed styles, tokens, typography.                                                                                                                             |
| `pseudo`          | `{ before?: PseudoBundle, after?: PseudoBundle }` | Absent keys mean no generated content.                                                                                                                           |
| `states`          | `StateRule[]`                                     | Declarative interaction states. No state is ever forced.                                                                                                         |
| `mediaConditions` | `string[]` (optional)                             | `@media` conditions of rules that actually applied. Optional on the type so a hand-written fixture typechecks; `capture()` always emits it.                      |
| `omissions`       | `Omission[]`                                      | Everything not captured, with a reason. The live array — an omission recorded after assembly (a declined screenshot) still appears in what the panel serializes. |
| `deep`            | `DeepBundle` (optional)                           | Present only for mode `deep` **and** trust `trusted`.                                                                                                            |

## Sub-types

```ts
interface EnvContext {
  viewport: { width: number; height: number }
  devicePixelRatio: number
  prefersColorScheme: 'light' | 'dark' | 'no-preference'
  colorScheme: string // the resolved `color-scheme` computed value
  themeAttributes: Record<string, string> // theme class/attribute on <html>
}

interface ElementIdentity {
  tagName: string // uppercase, as the DOM reports it
  role: string | null // explicit role attribute, else a small implicit-role table
  accessibleName: string | null // aria-label -> alt -> visible text -> title
  attributes: Record<string, string> // allowlist only; href/src reduced to origin+pathname
  text: string | null // capped 200 (trusted) / 80 (restricted); null when refused
}

interface Locator {
  selector: string
  strategy: 'testid' | 'id' | 'aria' | 'structural'
  confidence: 'exact' | 'ambiguous' | 'unverified'
  matchCount: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}
interface Box {
  top: number
  right: number
  bottom: number
  left: number
}

interface LayoutContext {
  rect: Rect // getBoundingClientRect, viewport-relative
  boxModel: { content: Rect; padding: Box; border: Box; margin: Box }
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
  nearestStackingContextSelector: string | null
  ancestry: Array<{ tagName: string; role: string | null; display: string }>
}

interface StyleBundle {
  computed: Record<string, string> // the ~60-property allowlist, nothing else
  variables: CssVariable[]
  typography: Typography
}
```

Every STYLE VALUE that reaches the output — `styles.computed`, a variable's
`resolved` value, pseudo-element `content` and `computed`, rule `declarations`,
and Deep keyframes `text` — has each `url()` token reduced to origin + pathname;
a non-`http(s)` scheme becomes `url()` plus a `blocked-scheme` omission. `cursor`,
`filter`, and `backdrop-filter` accept `url()` and the engine resolves it in the
computed value with the query string and fragment intact, which §6.4 bans.

```ts
interface CssVariable {
  name: string
  resolved: string
  definedIn: string | null // a matched selector, '[inline]', or null + an omission
  usedBy: string[] // the allowlisted properties whose declared value referenced it
}

interface Typography {
  declaredFamilies: string[]
  webfontStatus: Record<string, 'loaded' | 'loading' | 'unloaded' | 'not-a-webfont'>
  size: string
  lineHeight: string
  letterSpacing: string
  weight: string
  featureSettings: string
}

interface PseudoBundle {
  content: string
  computed: Record<string, string>
}

interface StateRule {
  state: 'hover' | 'focus-visible' | 'active' | 'disabled'
  selector: string
  declarations: Record<string, string>
}

interface Omission {
  field: string
  reason: OmissionReason
  detail?: string
}
```

`LayoutContext.stacking` and `nearestStackingContextSelector` are **stacking contexts**,
not containing blocks. The two are easy to conflate, but the containing block of a
statically positioned element is not its transform ancestor, and the rules differ again
for `absolute` and `fixed`. What a design brief needs is "what paints above what", so
that is what is captured, under the name that says so.

`webfontStatus` reports the `status` of a matching `FontFace` in `document.fonts`, or
`not-a-webfont` when no `@font-face` declares that family. It deliberately does **not**
claim whether a _system_ family resolved: `document.fonts.check()` can return `true` for
a family the engine will never render, so no field is built on it.

### Deep bundle

```ts
interface DeepBundle {
  subtree: SanitizedNode[] // <= 200 nodes / 20,000 chars; forbidden subtrees pruned
  rules: AppliedRule[]
  keyframes: Array<{ name: string; text: string }> // only those the element animates
  assets: Asset[] // <= 20
}

interface SanitizedNode {
  tagName: string
  attributes: Record<string, string> // same allowlist as ElementIdentity
  text: string | null
}

interface AppliedRule {
  selector: string
  sheet: string // e.g. 'inline#0', or a stylesheet href reduced to origin + pathname
  conditions: string[] // the at-rule condition STACK, outermost first
  specificity: [number, number, number] // [id, class/attribute/pseudo-class, type/pseudo-element]
  declarations: Record<string, string>
  important: string[] // the declaration names carrying !important
}

interface Asset {
  kind: 'img' | 'source' | 'poster' | 'background-image'
  url: string // reduced: origin + pathname, http/https only
  naturalWidth: number | null
  naturalHeight: number | null
  objectFit: string | null
  selector: string
}
```

`rules` is the set of rules **observed to match**, each with its own specificity and
source sheet. The cascade is not resolved: layer order, cross-layer `!important`
precedence, and `@scope` proximity are not computed, and `@container` / `@scope` blocks
are skipped with an `unsupported-at-rule` omission. Consumers get evidence, not a verdict.

`CustomPropertySite` (in `src/types.ts`) is an internal record of where a custom property
was declared; it feeds `CssVariable.definedIn` and is not itself part of the output.

## Example — Standard mode

Captured from `tests/fixtures/site/index.html`, element
`<button class="btn" data-testid="cta">Get started</button>`. Real output, with `computed`
abridged and `//` annotations added — the wire format is plain JSON with no comments.

```jsonc
{
  "schemaVersion": "1.0",
  "capturedAt": "2026-08-22T21:08:21.212Z",
  "page": {
    "origin": "http://localhost:8080",
    "pathname": "/", // the page was loaded with ?q=…; the query never appears
  },
  "trust": "trusted",
  "mode": "standard",
  "env": {
    "viewport": { "width": 1280, "height": 800 },
    "devicePixelRatio": 1,
    "prefersColorScheme": "light",
    "colorScheme": "normal",
    "themeAttributes": {}, // no theme class/attribute on <html> in this fixture
  },
  "element": {
    "tagName": "BUTTON",
    "role": "button", // implicit; an explicit role attribute would win
    "accessibleName": "Get started", // from the visible text, no aria-label present
    "attributes": {
      "class": "btn",
      "data-testid": "cta", // the only data-* on the allowlist
    },
    "text": "Get started",
  },
  "locator": {
    "selector": "[data-testid=\"cta\"]",
    "strategy": "testid", // top of the ladder: testid -> id -> aria -> structural
    "confidence": "exact", // re-queried and verified to resolve to this element
    "matchCount": 1,
  },
  "layout": {
    "rect": { "x": 160, "y": 211.875, "width": 97.953125, "height": 31 },
    "boxModel": {
      "content": { "x": 176, "y": 219.875, "width": 65.953125, "height": 15 },
      "padding": { "top": 8, "right": 16, "bottom": 8, "left": 16 },
      "border": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
      "margin": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
    },
    "scroll": {
      "pageX": 0, // without these, a viewport-relative rect cannot be reproduced
      "pageY": 0,
      "elementScrollTop": 0,
      "elementScrollLeft": 0,
      "scrollParentSelector": null,
    },
    "parent": { "display": "block" }, // flex/grid keys appear only when relevant
    "item": {}, // ditto for the element's own item properties
    "stacking": [], // nothing in the chain establishes a stacking context
    "nearestStackingContextSelector": null,
    "ancestry": [
      { "tagName": "section", "role": null, "display": "block" },
      { "tagName": "main", "role": null, "display": "block" },
      { "tagName": "body", "role": null, "display": "block" },
      { "tagName": "html", "role": null, "display": "block" },
    ],
  },
  "styles": {
    "computed": {
      "display": "inline-block",
      "position": "static",
      "box-sizing": "border-box",
      "padding": "8px 16px",
      "font-family": "Arial",
      "font-size": "13.3333px",
      "font-weight": "400",
      "color": "rgb(255, 255, 255)",
      "background-color": "rgb(0, 170, 119)", // resolved from var(--brand)
      "border-radius": "8px", // resolved from var(--radius)
      "cursor": "pointer",
      "transition": "all",
      // … the rest of the ~60-property allowlist, always present, always in this shape
    },
    "variables": [
      {
        "name": "--brand", // the design-system link
        "resolved": "#0a7", // the fidelity
        "definedIn": ":root", // the observed definition site
        "usedBy": ["background-color"],
      },
      { "name": "--radius", "resolved": "8px", "definedIn": ":root", "usedBy": ["border-radius"] },
    ],
    "typography": {
      "declaredFamilies": ["Arial"],
      "webfontStatus": { "Arial": "not-a-webfont" }, // no @font-face declares it
      "size": "13.3333px",
      "lineHeight": "normal",
      "letterSpacing": "normal",
      "weight": "400",
      "featureSettings": "normal",
    },
  },
  "pseudo": {}, // no ::before / ::after content on this element
  "states": [
    {
      "state": "hover",
      "selector": ".btn:hover",
      "declarations": { "background-color": "rgb(9, 95, 77)" },
    },
    {
      "state": "focus-visible",
      "selector": ".btn:focus-visible",
      // declared values as the CSSOM reports them — colors normalized, var()
      // left unresolved, because the rule did not apply at capture time
      "declarations": { "outline": "2px solid var(--brand)", "outline-offset": "2px" },
    },
    {
      "state": "disabled",
      "selector": ".btn:disabled",
      "declarations": { "background-color": "rgb(153, 153, 153)", "cursor": "not-allowed" },
    },
  ],
  "mediaConditions": [], // no @media rule matched this element at 1280px
  "omissions": [], // nothing was refused: absence here means "complete", not "unstyled"
}
```

## Example — Deep mode

Same page, element `<li class="card" data-testid="card-buttons">`. The envelope is
identical in shape to the Standard example (`mode` is `"deep"`), so only the added `deep`
key is shown.

```jsonc
{
  "mode": "deep",
  "trust": "trusted", // deep + restricted produces no bundle, only an omission
  // … schemaVersion, page, env, element, locator, layout, styles, pseudo, states,
  //   mediaConditions, omissions exactly as in the Standard example …
  "deep": {
    "subtree": [
      {
        "tagName": "LI", // the selected element is the first node
        "attributes": { "class": "card", "data-testid": "card-buttons" },
        "text": "Buttons Primary, secondary, and disabled states. Read more",
      },
      { "tagName": "H2", "attributes": {}, "text": "Buttons" },
      {
        "tagName": "P",
        "attributes": {},
        "text": "Primary, secondary, and disabled states.",
      },
      {
        "tagName": "A",
        // href reduced to origin + pathname; a javascript:/data:/blob: href would be
        // dropped with a blocked-scheme omission instead
        "attributes": { "href": "http://localhost:8080/components/buttons" },
        "text": "Read more",
      },
      // A form control, <script>, <style>, <template>, or hidden subtree in here would
      // be PRUNED — not emptied — so no node for it appears at all.
    ],
    "rules": [
      {
        "selector": ".card",
        "sheet": "inline#0", // the page's first inline <style>
        "conditions": [], // an @media/@supports nest would list its stack here
        "specificity": [0, 1, 0],
        "declarations": {
          "padding": "var(--gap)", // the authored rule: var() is not resolved here
          "border": "1px solid rgb(226, 226, 226)",
          "border-width": "1px",
          "border-style": "solid",
          "border-color": "rgb(226, 226, 226)",
          "border-radius": "var(--radius)",
        },
        "important": [],
      },
    ],
    "keyframes": [], // only @keyframes the element's own animation references
    "assets": [], // img / picture > source / video[poster] / background-image, capped at 20
  },
}
```

## Omissions

Every output carries an `omissions` array; **absence must never read as "unstyled"**.
`field` is a dotted path naming what was refused (`element.text`, `styles.variables`,
`deep.assets`, `attributes.href`, `screenshot`, …) and `detail` is a free-form
clarification. A few paths name a capture _stage_ rather than an output key —
`styles.matchedRules` is the rule walk that feeds `styles`, `states`, and `deep.rules` —
so do not expect every `field` to resolve as a JSON pointer.

This table is transcribed from the `OmissionReason` union in
[`src/types.ts`](../src/types.ts).

| Reason                     | Meaning                                                                                                                                                                                                                          | Emitted for                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restricted-mode`          | The run's trust level does not permit this field.                                                                                                                                                                                | `deep` — Deep requested on an untrusted origin.                                                                                                                                            |
| `cross-origin-stylesheet`  | `sheet.cssRules` threw `SecurityError`, so the sheet could not be read. Any CDN or Google Fonts link does this.                                                                                                                  | `styles.matchedRules`, `deep.keyframes` (detail: the sheet href, reduced to origin + pathname)                                                                                             |
| `clipped-screenshot`       | The element is larger than the viewport, so the frame holds only part of it.                                                                                                                                                     | `screenshot`                                                                                                                                                                               |
| `unsupported-browser`      | A capability this engine does not provide. Also used for a frame that never arrived and for a canvas with no 2D context.                                                                                                         | `screenshot` (`getDisplayMedia unavailable`, `no frame delivered`, `no 2d context`, a DOMException name), `typography.webfontStatus` (`document.fonts unavailable`)                        |
| `no-frame-delivered`       | Capture was attempted and the first frame did not arrive within 8 s. **Not** a capability statement — the browser supports capture and a retry may succeed. Each screenshot attempt supersedes the previous attempt's omissions. |                                                                                                                                                                                            |
| `budget-exceeded`          | A cap in `CAPS` stopped the walk: text characters or node visits, ancestry depth, deep nodes/characters/assets.                                                                                                                  | `element.text`, `layout.ancestry`, `deep.subtree`, `deep.assets`                                                                                                                           |
| `user-declined`            | The user dismissed the screen-capture permission prompt (`NotAllowedError`).                                                                                                                                                     | `screenshot`                                                                                                                                                                               |
| `blocked-scheme`           | A URL was not `http:`/`https:` (a `javascript:`, `data:`, `blob:`, `mailto:`, `file:` URL, or unparseable junk), so it was dropped rather than laundered.                                                                        | `attributes.href`, `attributes.src`, `deep.assets`, and any style value carrying a `url()` token: `styles.computed`, `styles.variables`, `styles.matchedRules`, `pseudo`, `deep.keyframes` |
| `unsupported-selector`     | The hand-rolled selector parser declined a construct rather than guessing at it — including a specificity it could only approximate.                                                                                             | `styles.matchedRules` (detail: the selector part)                                                                                                                                          |
| `unsupported-at-rule`      | An at-rule whose semantics this version does not model (`@container`, `@scope`) was skipped.                                                                                                                                     | `styles.matchedRules` (detail: the rule's interface name)                                                                                                                                  |
| `shadow-boundary`          | Capture stopped at a shadow boundary: an open host was not traversed, the element lives inside a shadow tree, or it is slotted. A **closed** host is undetectable and therefore silent.                                          | `element.text`                                                                                                                                                                             |
| `indeterminate-definition` | A custom property resolved, but no observed declaration could be identified as its definition site, so `definedIn` is `null` rather than a guess.                                                                                | `styles.variables` (detail: the property name)                                                                                                                                             |
