# ui-selector

A locally built bookmarklet that captures a **frontend-design brief** for one selected
element on a page, as JSON an AI coding agent can act on directly — plus a prompt-ready
Markdown rendering of the same object.

It exists because describing a UI element to an agent by hand loses exactly the details
that matter: resolved token values, the layout context that explains the position, the
webfont load status, the interaction states.

- No extension, no server, no telemetry, **no runtime network requests of any kind**.
- Zero runtime dependencies. The whole tool is one `javascript:` URL on your bookmarks
  bar, built on your machine from this repository.
- Deny by default: a field reaches the output only if an allowlist table in
  [`src/allowlists.ts`](./src/allowlists.ts) names it.

## What it captures

Standard mode — available on every origin you let it run on:

| Group               | Contents                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Page identity       | `origin` + `pathname` only                                                                                                       |
| Element identity    | tag name, computed ARIA role, accessible name, allowlisted attributes, capped visible text                                       |
| Locator             | a stable selector with its strategy (`testid` / `id` / `aria` / `structural`), verified match count, and a confidence value      |
| Geometry            | `getBoundingClientRect`, content/padding/border/margin boxes, page and element scroll offsets                                    |
| Layout context      | the parent's `display` and flex/grid container properties, the element's own item properties, the ancestor **stacking contexts** |
| Ancestry            | a bounded chain (depth 5) of tag name + role + display                                                                           |
| Computed styles     | a fixed ~60-property design table: box, typography, color, border, shadow, transform, transition, overflow                       |
| Design tokens       | every CSS custom property the allowlisted declarations reference — name, resolved value, and the selector that defines it        |
| Typography          | declared family list, size, line-height, letter-spacing, weight, feature settings, and per-family `webfontStatus`                |
| Capture environment | viewport, `devicePixelRatio`, `prefers-color-scheme`, resolved `color-scheme`, the theme class/attribute on `<html>`             |
| Responsive context  | the `@media` conditions of the rules that actually applied                                                                       |
| Pseudo-elements     | `::before` / `::after` `content` and computed styles                                                                             |
| Interaction states  | matched rules whose selectors mention `:hover`, `:focus-visible`, `:active`, `:disabled` — declaratively, no forced states       |
| Omissions           | every field that was _not_ captured, with a reason. Absence must never read as "unstyled"                                        |

Deep mode — trusted origins only, opted into per run:

- A bounded sanitized DOM of the selected subtree (200 nodes / 20,000 characters).
- Matched CSS rules with specificity, origin sheet, per-declaration `!important` flags,
  and the at-rule condition stack.
- The `@keyframes` the element's animations actually reference.
- Asset metadata for `img`, `picture > source`, `video[poster]`, and CSS
  `background-image`: reduced URL (origin + pathname, `http`/`https` only), natural
  dimensions, `object-fit`. Never asset bytes.

Deep mode reports the rules **observed to match**, each with its own specificity and
source sheet. It does not resolve the cascade: layer order, `!important` precedence
across layers, and `@scope` proximity are not computed, and `@container` / `@scope`
blocks are skipped with an `unsupported-at-rule` omission. You get the evidence, not a
verdict — reimplementing the CSS cascade inside a bookmarklet is out of scope, and
claiming to have done it would be worse than saying this.

Optionally, a screenshot of the element: one `getDisplayMedia` frame cropped to the
element's rect, painted into a canvas the tool owns. Always behind an explicit click on
the panel's Screenshot control.

## What it never captures

Verbatim from the spec (§6.4), in any mode:

> Cookies, any storage API, form values (`value`, `checked`, `selectedIndex`),
> React/Vue/Svelte runtime state or props, URL query parameters or hash,
> `contenteditable` text, `password`-type anything.

Nothing is ever _written_, either: no `localStorage`, no `sessionStorage`, no cookies,
no IndexedDB, no Cache Storage, on any code path. Trust state lives in a local variable
for the lifetime of one invocation.

Two more boundaries worth stating plainly:

- **Text from suppressed and inert subtrees is dropped**, judged against the whole
  ancestor chain — `display:none` or `[hidden]` anywhere above the element counts, and so
  do `<script>`, `<style>`, `<template>`, `<noscript>`, `<iframe>`, `<object>`,
  `<embed>`, `<canvas>`, and every form control.
- **Capture does not cross a shadow boundary** in either direction. Selection resolves
  through open shadow roots via `composedPath`, so a shadow-DOM child can be picked, but
  text and subtree walks stop at the host and a `shadow-boundary` omission is recorded.
  A _closed_ shadow host is indistinguishable from an element with no shadow root and is
  therefore silent — the contract says so rather than implying otherwise.

[`tests/e2e/redaction.spec.ts`](./tests/e2e/redaction.spec.ts) is the standing gate on
all of this: a page seeded with a cookie, input and textarea values, `contenteditable`
text, script and style text, hidden subtrees, a `<template>`, a `javascript:` URL, a
`data:` URL, `localStorage`, and a URL query string. Every element of the seeded card is
captured in both modes, as JSON _and_ as Markdown, and no seed may appear in any of it.
A failure there is a real defect, never a test bug.

## Output formats

Two formats, one capture path:

- **JSON** — the canonical `CaptureV1` object. Copy to clipboard or download as
  `ui-selector-capture.json`. Schema and worked examples:
  [`docs/data-contract.md`](./docs/data-contract.md).
- **Markdown** — a prompt-ready rendering to paste straight into an agent conversation:
  identity and locator, a layout summary, a token table, typography with per-family
  webfont status, interaction states, responsive context, a deep-capture summary, and
  the omissions.

`toMarkdown(result: CaptureV1): string` is a **pure function of the already-sanitized
object** — it never reads the DOM and imports nothing from `src/capture/**`, a property
pinned by a Proxy-based purity test. So the Markdown inherits every redaction guarantee
above by construction, and no privacy test has to be written twice.

## Trust model

Three states, no hard allowlist:

| State          | How reached                                                                              | Capabilities                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Trusted**    | Origin present in the local (gitignored) config baked into the bookmarklet at build time | Standard mode; may opt into Deep mode                                                             |
| **Restricted** | Explicit run-once confirmation dialog on an unknown origin                               | Standard mode with tighter caps; screenshot still allowed after explicit action; Deep unavailable |
| **Refused**    | User dismisses the dialog (Cancel or Escape)                                             | Nothing runs; the tool tears down                                                                 |

- The run-once dialog **cannot** promote an origin to trusted. Promotion happens only by
  editing the local config and rebuilding.
- Restricted mode caps visible text at 80 characters instead of 200, and a Deep request
  under restricted trust records a `restricted-mode` omission instead of a bundle.
- Origins are compared as **parsed URLs**, never as substrings: protocol and hostname
  must match exactly, and the port must match too for everything except loopback (where
  a dev server's port changes run to run). `https://skill-shelf.pages.dev.evil.tld` and
  `https://x.skill-shelf.pages.dev` are both _unknown_ to a `https://skill-shelf.pages.dev`
  entry, and there are unit tests for exactly those two strings.
- `claude.ai` is a **sensitive host**: it is never trusted, and this is enforced in
  code, not just advice — `classify()` forces `claude.ai` (and its subdomains) to
  _unknown_ even when your own config lists it, so text capture there always runs
  under the restricted cap and Deep mode stays unavailable.
- The generated install page prints the exact trusted-origin list baked into the
  bookmarklet it generated, so a stale origin cannot hide inside an old bookmark.

## Install

```sh
npm ci
cp selector.config.example.json selector.config.json   # gitignored; your real origins
$EDITOR selector.config.json                           # add the origins you trust
npm run build                                          # prints the encoded payload size
open dist/install.html                                 # then drag the link to your bookmarks bar
```

`selector.config.json` looks like the committed example:

```json
{ "trustedOrigins": ["http://localhost", "http://127.0.0.1"] }
```

Only `selector.config.example.json` (loopback only) is committed. Never put a
non-personal hostname in the committed example.

To use it: open the page you want to capture, click the bookmark, answer the trust
dialog, then hover and click the element. Escape cancels at every stage.

### Rebuild

The bookmarklet is fully self-contained, so there is **no runtime update path**:

```sh
npm run build          # after any source change, or any edit to selector.config.json
```

then **delete the old bookmark and re-drag the link** from the freshly generated
`dist/install.html`. A bookmark on your bar is whatever it was built with — including its
trusted-origin list. `dist/install.html` prints the build timestamp and the origin list
so you can tell whether the bookmark you are holding is stale.

## Browser support

- **Chrome / Chromium** is the supported target for v1.
- **Firefox and Safari** are best-effort: selection, capture, and both output formats
  work. Screenshots work wherever `navigator.mediaDevices.getDisplayMedia` exists, but
  the `preferCurrentTab` hint is Chromium-only, so those browsers show their own surface
  picker and you choose the tab manually. Support is decided by that one fact — if
  `getDisplayMedia` is absent, the Screenshot control is disabled and an
  `unsupported-browser` omission is recorded.
- Screenshots additionally require a **secure context**, so they are unavailable on
  non-loopback `http://`.
- The tool is built for strict-CSP and Trusted-Types pages: no `eval`, no `new Function`,
  no `innerHTML` / `outerHTML` / `insertAdjacentHTML`, no injected `<script>` or
  `<style>` tag, no `<img src="blob:">`, no network. The UI is built with `createElement`
  - `textContent` inside a **closed shadow root**.

## Claude artifacts

Artifact documents are a first-class target, with one structural caveat. A published
artifact at `https://claude.ai/code/artifact/<id>` renders the artifact document inside a
**cross-origin iframe**, and a bookmarklet only ever executes in the top document — it
cannot reach a cross-origin iframe's DOM. This is a property of the bookmarklet form, not
a bug awaiting a fix; only an extension with all-frames injection could change it, and an
extension is explicitly not planned for v1.

So capture the artifact document as a **top-level page**:

1. Open the artifact in claude.ai as you normally would.
2. Find the artifact document's own URL. Either open the artifact's "open in new tab" /
   full-screen control, or in DevTools run
   `[...document.querySelectorAll('iframe')].map(f => f.src)` on the claude.ai page and
   take the artifact frame's `src`.
3. Paste that URL into the address bar of a new tab, so the artifact document is now the
   **top-level** document (the address bar shows the artifact's own origin, not
   `claude.ai`).
4. Click the ui-selector bookmark there and pick your element as usual.

Selecting inside the artifact while it is embedded in the claude.ai shell is **not
supported in v1**. And because the claude.ai shell page also contains conversation text,
`claude.ai` is a sensitive host: it always runs restricted — a `claude.ai` entry in
your trusted origins is ignored by construction.

## Threat model

What this tool is, in security terms: **your** code, running in the page's JavaScript
context with the page's full privileges, producing text you will paste somewhere else.

What it protects:

- **The output.** The thing you paste into an agent conversation is the asset. The
  allowlists, the URL reducer (`http`/`https` only, origin + pathname, nothing else), the
  text-node walk's forbidden subtrees, and the standing redaction gate exist to keep user
  data, secrets in query strings, and page state out of that text.
- **Your machine.** Nothing is written to disk, storage, or cookies. Nothing is sent
  anywhere: `src/` contains no network call of any kind — no `fetch`, no
  `XMLHttpRequest`, no image beacon — and an ESLint `no-restricted-syntax` rule fails the
  build if a `fetch` (or an `eval`, `new Function`, or `innerHTML`) is added to it. Output
  leaves the browser only when you click Copy or Download.
- **Your trusted origins.** They live in a gitignored config and are baked in at build
  time. An unknown origin cannot be promoted from inside a page — only by editing the
  config and rebuilding — so a page cannot talk you into granting it Deep mode.

What it does **not** protect against, stated so you can decide accordingly:

- **A hostile page.** A bookmarklet runs after the page has had full control of its own
  realm. A malicious page can redefine `getComputedStyle`, `Element.prototype.matches`,
  `document.styleSheets`, or `JSON.stringify` and feed the capture whatever it likes, or
  observe that the tool ran and intercept what a Copy button writes to the clipboard. The
  closed shadow root keeps the page's own CSS and `querySelector` out of our UI; it is not
  a security boundary against script that already owns the realm. ui-selector does not
  harden built-ins and cannot. Do not run it on a page you believe is actively hostile;
  the run-once dialog is a speed bump, not a sandbox.
- **The screenshot surface.** `getDisplayMedia` shows an OS/browser-level picker, and on
  non-Chromium engines the picker may offer windows other than this tab. Whatever you
  pick is what the frame contains before it is cropped. The frame is never uploaded — it
  is drawn into a canvas in the page and discarded when the panel closes — but choose the
  surface deliberately.
- **The bookmarklet's payload.** `dist/bookmarklet.txt` and `dist/install.html` embed
  your trusted-origin list in plain text. That list is the only configuration inside the
  payload; there are no credentials in it, and there is nowhere for one to go, but treat
  the list itself as private if your hostnames are.
- **What you do with the output afterwards.** A design brief still describes your UI. The
  tool's job ends when the JSON is on your clipboard.

## Repository

- Spec (what and why): [`docs/superpowers/specs/ui-selector-mvp.md`](./docs/superpowers/specs/ui-selector-mvp.md)
- Data contract: [`docs/data-contract.md`](./docs/data-contract.md)
- Manual checks no test can perform: [`docs/phase-0-manual-checks.md`](./docs/phase-0-manual-checks.md)
- Agent and contributor guidance: [`CLAUDE.md`](./CLAUDE.md)

| Task          | Command             |
| ------------- | ------------------- |
| Install deps  | `npm ci`            |
| Build         | `npm run build`     |
| Unit tests    | `npm run test`      |
| Browser tests | `npm run test:e2e`  |
| Lint          | `npm run lint`      |
| Format        | `npm run format`    |
| Typecheck     | `npm run typecheck` |

MIT licensed ([`LICENSE`](./LICENSE)). See [`NOTICE`](./NOTICE) for prior-art credit.
