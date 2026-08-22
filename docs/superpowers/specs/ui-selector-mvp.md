# ui-selector — MVP Spec (what and why)

Status: proposed, awaiting Phase 0 spike results
Date: 2026-08-22

## 1. Purpose

A locally built bookmarklet that captures a **frontend-design brief** for one
selected element on a page, as JSON an AI coding agent can act on directly:
where the element is, what it is semantically, how it is styled, what tokens it
uses, how it behaves on hover/focus, and optionally what it looks like.

It exists because describing a UI element to an agent by hand loses exactly the
details that matter — resolved token values, the layout context that explains the
position, the webfont load status, the interaction states.

## 2. Non-goals

- Not a browser extension (v1) and not a Codex/Claude skill.
- Not a general page scraper. It captures **design** facts, never user data.
- Not a design-to-code generator. It produces input for one, nothing more.
- No hosted service, no telemetry, no runtime network requests of any kind.

## 3. Target page classes

1. **localhost dev servers** — the primary loop.
2. **User-controlled deployed sites**, e.g. `https://skill-shelf.pages.dev/`.
3. **Claude artifact pages** — a first-class target, with one structural caveat:
   a published artifact at `https://claude.ai/code/artifact/<id>` renders the
   artifact document inside a **cross-origin iframe**. A bookmarklet executes in
   the top document only and cannot reach a cross-origin iframe's DOM. So:
   - Supported: loading the artifact's own document as the top-level page.
   - Not supported in v1: selecting inside the artifact while it is embedded in
     the claude.ai shell.
   This is a property of the bookmarklet form, not a bug to fix later; only an
   extension with all-frames injection could change it. Phase 0 Spike 1 verifies
   the exact frame topology before we design around it.

   **Decision:** v1 accepts the workaround. The README documents "open the artifact
   document as the top-level page" as the supported artifact flow. An extension is
   explicitly **not** planned for v1 and does not shape any v1 design choice.

   Because the claude.ai shell page also contains conversation text, `claude.ai`
   is a **sensitive host, enforced in code**: `classify()` forces it (and any subdomain)
   to `unknown` even when the baked config lists it, so it can never reach trusted state
   and Deep mode stays locked there. Belt and braces — the config is the user's own, but a
   trusted claude.ai would unlock a Deep subtree walk over conversation text, which is a
   footgun worth removing rather than documenting. Text
   capture there is subject to the restricted-mode cap (§6).

## 4. Trust model

Three states, no hard allowlist:

| State | How reached | Capabilities |
|---|---|---|
| **Trusted** | Origin present in the local (gitignored) config baked into the bookmarklet at build time | Standard mode; may opt into Deep mode |
| **Restricted** | Explicit run-once confirmation dialog on an unknown origin | Standard mode with tighter caps; screenshot still allowed after explicit action; Deep mode unavailable |
| **Refused** | User dismisses the dialog | Nothing runs; the tool tears down |

- The run-once dialog **cannot** promote an origin to trusted. Promotion happens
  only by editing the local config and rebuilding.
- Nothing is ever written to page `localStorage`, `sessionStorage`, cookies, or
  IndexedDB. Trust state lives for the lifetime of one invocation.
- The install page displays the exact trusted-origin list baked into the
  bookmarklet it generates, so a stale origin cannot hide inside an old bookmark.

## 5. Modes

- **Standard** — available in both trusted and restricted states. Everything in
  §6.1.
- **Deep** — trusted origins only. Adds §6.2.

## 6. Data contract

Deny-by-default: a field reaches the output only if an allowlist table names it.
`schemaVersion: "1.0"`.

### 6.1 Standard

- **Page identity** — `origin` + `pathname` only. Never query string, never hash.
- **Element identity** — tagName, computed ARIA role, accessible name,
  allowlisted attributes, visible text (capped: 200 chars trusted / 80 restricted;
  **never** for `input`/`textarea`/`select`, whose text is user data).
- **Locator** — stable locator plus strategy, verified match count, and a
  confidence value. A locator that resolves to the wrong element is a hard defect,
  not a low-confidence result.
- **Ancestry** — bounded chain (default depth 5) of tagName + role + a small
  layout summary per ancestor.
- **Geometry / box model** — `getBoundingClientRect`, content/padding/border/margin
  boxes, scroll offsets.
- **Layout context** — the parent's `display` and flex/grid container properties,
  the element's own item properties (`flex`, `grid-area`, `align-self`, `order`,
  `gap`), scroll offsets, and the chain of ancestor **stacking contexts** with their
  `position` / `z-index`.

  Stacking context, not containing block: the two coincide often enough to be
  confused, but the containing block of a statically positioned element is not the
  transform ancestor, and the rules differ again for `absolute` and `fixed`. What a
  design brief actually needs is "what paints above what", so that is what is
  captured, under a name that says so.
- **Allowlisted computed styles** — a fixed table (~60 properties) covering box,
  typography, color, border, shadow, transform, transition, overflow.
- **CSS custom properties** — for each allowlisted property whose declared value
  references a variable: the variable name, the resolved value, and the selector
  where the variable is defined. The name is the design-system link; the value is
  the fidelity.
- **Typography** — declared family list, size, line-height, letter-spacing, weight,
  and feature settings, plus `webfontStatus`: for each declared family, the `status`
  of a matching `FontFace` in `document.fonts`, or `not-a-webfont` when no
  `@font-face` declares it.

  Note what is deliberately absent. `document.fonts.check()` does not answer "is this
  family installed" — it can return `true` for a family the engine will never render —
  so no field claims to. Whether a *system* family actually resolved is not
  determinable without a rendering heuristic, and v1 does not ship one.
- **Capture environment** — viewport width/height, devicePixelRatio,
  `prefers-color-scheme`, resolved `color-scheme`, and the theme class/attribute
  on `<html>`.
- **Responsive context** — the `@media` conditions of the rules that actually
  applied.
- **Pseudo-elements** — `::before` and `::after` computed styles and `content`,
  in Standard (not deferred): they carry icons, carets, rules, focus decoration.
- **Interaction states, declaratively** — matched rules whose selectors mention
  `:hover`, `:focus-visible`, `:active`, `:disabled`. No forced states in v1.

**Shadow DOM boundary.** Selection resolves through shadow roots via `composedPath`,
so a shadow-DOM child can be picked. Capture, however, does **not** cross a shadow
boundary in either direction: text and subtree walks stop at the host, and styles come
from the picked element's own tree. When the picked element hosts a shadow root, or
sits inside one, or is slotted, that is recorded as a `shadow-boundary` omission.

One boundary is **not** detectable, and the contract says so rather than implying
otherwise: a host whose shadow root is closed looks identical to an element with no
shadow root — `el.shadowRoot` is `null`, no other accessor exists, and instrumenting
`attachShadow` cannot help because a bookmarklet runs long after the page built its
trees. Open hosts, elements inside any shadow tree, and slotted content are reported; a
closed host is silent. Traversing open roots is v1.1 work.

Relatedly, **visual suppression is judged against the whole ancestor chain**, not the
element alone: `getComputedStyle(child).display` inside a `display:none` parent returns
the child's own value, so a directly selected descendant of a hidden container is only
refused by walking upward. `visibility: collapse` counts as suppression. `opacity: 0`
does not — it is a real design state, still in layout. `aria-hidden` does not either —
it is an accessibility hint, and such content is frequently on screen.

### 6.2 Deep (trusted only)

- Bounded sanitized DOM of the selected subtree (node and character budgets), not
  crossing shadow boundaries.
- Matched CSS rules with specificity, origin sheet, and an `important` flag per
  declaration.
- `@keyframes` referenced by the element's animations.
- Asset metadata for `img`, `picture > source`, `video[poster]`, and CSS
  `background-image` URLs: reduced URL (origin + pathname, http/https only), natural
  dimensions where available, and `object-fit`. Never asset bytes; capped at
  `CAPS.deepAssets`.

**What "matched rules" guarantees, and what it does not.** Deep mode reports the rules
*observed to match* the element, each with its own specificity and source sheet. It
does **not** resolve the cascade: cascade-layer order, `!important` precedence across
layers, and `@scope` proximity are not computed, and `@container` / `@scope` blocks are
skipped with an `unsupported-at-rule` omission. Consumers get the evidence, not a
verdict. Reimplementing the CSS cascade is out of scope for a bookmarklet, and
claiming to have done it would be worse than saying this.

### 6.3 Output formats

Two formats, one capture path:

- **JSON** — the canonical `CaptureV1` object. Clipboard or file download.
- **Markdown** — a prompt-ready rendering for pasting straight into an agent
  conversation: element identity and locator, a layout summary, a token table
  (variable name → resolved value), typography with per-family `webfontStatus`, an
  interaction-state list, and the omissions.

The Markdown renderer is a **pure function of the already-sanitized `CaptureV1`
object** — `toMarkdown(result: CaptureV1): string` — never a second capture path
over the DOM. This is deliberate: it means Markdown output inherits every redaction
guarantee in §6.4 by construction, and no privacy test needs to be written twice.

### 6.3b URL reduction applies to CSS values, not just attributes

Every URL emitted anywhere in the output is reduced to `origin + pathname`, http/https
only. That includes URLs inside **CSS values**, which is easy to overlook because they do
not look like links: `cursor: url(...)`, `filter` / `backdrop-filter: url(...)`,
pseudo-element `content: url(...)`, a custom property whose resolved value is a `url()`,
an author declaration in Deep's matched rules, `@keyframes` `cssText`, and stylesheet
`href`s in provenance fields and omission details.

This is stated separately because it was a real leak found in review, not a hypothetical:
signed asset URLs (`?X-Amz-Signature=…`, `?token=…`) are common on exactly the
authenticated internal apps this tool is pointed at, and two of those sinks feed the
prompt-ready Markdown a user pastes into a third-party agent. A non-http(s) scheme inside a
CSS value is dropped with a `blocked-scheme` omission, same as an attribute.

### 6.4 Never captured, in any mode

Cookies, any storage API, form values (`value`, `checked`, `selectedIndex`),
React/Vue/Svelte runtime state or props, URL query parameters or hash,
`contenteditable` text, `password`-type anything.

### 6.5 Omissions

Every output carries an `omissions` array. Each entry names the field and a
reason: `restricted-mode`, `cross-origin-stylesheet`, `clipped-screenshot`,
`unsupported-browser`, `budget-exceeded`, `user-declined`, `blocked-scheme`,
`unsupported-selector`, `unsupported-at-rule`, `shadow-boundary`,
`indeterminate-definition`, `no-frame-delivered`. This list is transcribed from the `OmissionReason` union in
`src/types.ts`, which is the single source of truth. Absence must never read as
"unstyled".

## 7. Screenshot

- Always an explicit user action; the capture originates from the click on the
  screenshot control itself, so transient user activation is live.
- `navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true, video: { frameRate: 1 } })`
  → one frame → crop to `getBoundingClientRect()`.
- Crop scale is **`videoWidth / window.innerWidth`**, not `devicePixelRatio`: the
  captured frame is not guaranteed to equal viewport × DPR.
- Element scrolled into view and clamped to the viewport; anything larger is
  captured partially and marked `clipped: true`.
- Requires a secure context, so unavailable on non-localhost `http://`.
- Support is decided by one fact only: whether
  `navigator.mediaDevices.getDisplayMedia` exists. If it does not, the screenshot
  control is disabled and an `unsupported-browser` omission is emitted.
- `preferCurrentTab: true` is passed **unconditionally**. It is a Chromium-only hint
  and a dictionary member, so an engine that does not implement it ignores it — there
  is nothing to detect and no branch to get wrong. Chromium offers this tab; Firefox
  and Safari show their own surface picker. Either way capture proceeds, and no omission
  is produced.
- `getSupportedConstraints()` is **not** used. It enumerates *track* constraints and the
  Screen Capture specification's supported-constraint list does not include
  `preferCurrentTab`, so probing it there reports the hint absent even on Chromium: a
  detector that is systematically wrong rather than merely unreliable.
- A frame that never arrives records **`no-frame-delivered`**, not
  `unsupported-browser`, and returns nothing rather than emitting a blank canvas. The
  distinction is load-bearing: the browser is capable, this attempt simply did not deliver,
  and retrying may well succeed. Telling a consuming agent "unsupported browser" makes a
  capability claim that is false.
- **The screenshot control is retryable, and each attempt supersedes the last.** A stale
  failure record must not survive alongside a successful image — a payload containing both
  a screenshot and a "screenshot not captured" omission is self-contradictory, and a
  consuming agent will believe the wrong half.
- No `frameRate` constraint is placed on the video track. Capping it at 1 fps saved nothing
  (exactly one frame is taken) and delayed the first frame by up to a second, which is what
  pushed a real attempt past the deadline during the Phase 0 manual check. The first-frame
  deadline is 8 s, measured from after the user has picked a surface.
- A declined permission records `user-declined`.

## 8. Hard implementation rules (CSP and Trusted Types safety)

These make the tool work on strict-CSP pages, which includes Claude artifact
documents. They are cheap on day one and a painful retrofit later.

- No runtime network requests of any kind (self-contained payload).
- No `eval`, no `new Function`.
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML` — DOM built via
  `createElement` + `textContent` only (survives `require-trusted-types-for 'script'`).
- No injected `<script>` and no injected `<style>` tag; UI lives in a **closed
  shadow root** styled by a constructed stylesheet or element-level inline styles.
- Screenshot preview paints into a `<canvas>` we own, never `<img src="blob:">`
  (which `img-src` can block).
- Cross-origin `sheet.cssRules` access is wrapped in try/catch and degrades to an
  omission, never an exception.

## 9. Browser support

Chrome / Chromium is the supported target for v1. Firefox and Safari are best-effort:
selection and capture work; screenshots work wherever `getDisplayMedia` exists, and
without the `preferCurrentTab` hint the user picks the surface manually.

## 10. v1 cuts

No iframes, no multi-select, no server, no scroll-and-stitch, no forced states,
no multi-viewport re-capture, `@keyframes` Deep-only.

## 11. Scale

~1,500–2,500 production LOC (including ~120 for the Markdown renderer) plus ~800
test LOC. Total encoded bookmarklet payload must stay inside the envelope measured
by Spike 1, with ≥2× headroom.

## 12. Provenance

`ZH-L1N/ui-selector`, public. A new repository, not a fork of `oil-oil/selector`.
MIT `LICENSE` of our own plus a
`NOTICE` crediting `oil-oil/selector` as prior art for the bookmarklet approach,
the locator ladder concept, and the `getDisplayMedia` screenshot sequence — all
reimplemented here from documented Web API behaviour. If any file later adapts
upstream code directly, that file carries upstream's MIT attribution in its header.
