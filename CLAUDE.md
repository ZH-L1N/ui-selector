# CLAUDE.md

`ui-selector` — a locally built bookmarklet that captures a frontend-design brief
for one selected element as JSON (and prompt-ready Markdown) an AI coding agent can
act on.

This file is the single source of truth for agent guidance in this repository.
`AGENTS.md` is a pointer to it.

## Workflow

- Design specs (the what/why) live in `docs/superpowers/specs/`.
- Implementation plans (the how) live in `plans/`. Keep that folder for
  implementation plans only.
- Adversarial-review fix logs live in `plans/fixs/`.
- Before non-trivial work: write a short MVP-focused plan under `plans/`, get review,
  then implement. Don't over-plan; smallest thing that works.
- When behaviour of a browser API is load-bearing, verify it against documentation or
  a spike — never from memory.
- Before committing: run lint, format, typecheck, and tests. Never commit on failure.
- Never commit or push without explicit user authorization.

Current spec: `docs/superpowers/specs/ui-selector-mvp.md`
Current plan: `plans/2026-08-22-ui-selector-mvp.md`

User-facing docs, kept in step with the code:

- `README.md` — what it captures, what it never captures, trust model, install/rebuild,
  browser support, the Claude-artifact caveat, threat model.
- `docs/data-contract.md` — the `CaptureV1` schema, an annotated example per mode, and
  the omission-reason table. Transcribed from `src/types.ts`; the types win on conflict.
- `docs/phase-0-manual-checks.md` — the three claims no test can make. Record results
  there, including failures.

## Commands

| Task                         | Command                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| Install deps                 | `npm ci`                                                    |
| Build bookmarklet            | `npm run build`                                             |
| Build test bundle            | `npm run build:test` (Playwright's `globalSetup` does this) |
| Unit tests                   | `npm run test`                                              |
| Browser tests                | `npm run test:e2e`                                          |
| Browser tests (release only) | `npm run test:e2e -- --grep @live`                          |
| Lint                         | `npm run lint`                                              |
| Format                       | `npm run format`                                            |
| Typecheck                    | `npm run typecheck`                                         |

`npm run build` prints the encoded bookmarklet size. That number is a budget, not
trivia — see the payload gotcha below.

## Architecture

TypeScript compiled by esbuild into a single dependency-free IIFE, percent-encoded
into a `javascript:` bookmarklet with trusted origins baked in at build time.

- `src/boot.ts` — entry, single-instance guard, trust gate, teardown
- `src/trust.ts` — origin classification, run-once confirmation
- `src/pick.ts` — overlay, hover highlight, click-to-select
- `src/locate.ts` — locator ladder with self-verification
- `src/capture/` — the policy-bearing core: `capture(el, ctx) => CaptureV1`
- `src/shot.ts` — `getDisplayMedia` screenshot, explicit user action only
- `src/ui/` — CSP-safe DOM builder, Markdown renderer, preview panel
- `build/bundle.mjs` — bundle, minify, encode, generate the install page

Two design invariants:

1. **Deny by default.** A field reaches the output only if an allowlist table in
   `src/allowlists.ts` names it. This is what makes the privacy contract testable
   without a browser.
2. **One capture path.** `toMarkdown(result: CaptureV1)` is a pure function of the
   already-sanitized object and must never read the DOM, so Markdown inherits every
   redaction guarantee for free.

## Testing Patterns

- Pure functions (`sanitize`, `locate`, `capture`, `markdown`) → vitest + jsdom under
  `tests/unit/`.
- Anything needing a real engine (picker, matched rules, screenshot, CSP behaviour) →
  Playwright under `tests/e2e/`.
- Fixtures in `tests/fixtures/`, all committed. `tests/fixtures/site/` is a committed
  synthetic "realistic page", served on `:8080`; the single-purpose fixtures are served
  on `:8081`, and `:8082` is the same directory bound to `127.0.0.1` so a second origin
  exists without reaching a CDN. The one gitignored file there is
  `tests/fixtures/ui-selector.test.js` — `globalSetup` stages the built test bundle into
  the fixture root so a strict-CSP page can load it same-origin.
- `window.__uiSelectorTest.runHeadless(selector, mode?, trust?)` is THE capture path for
  tests — the same composition the real flow assembles. Address an arbitrary element by
  setting a non-allowlisted marker attribute and selecting on it; there is deliberately
  no `runHeadlessOn(el, …)`.
- `tests/e2e/redaction.spec.ts` is the standing privacy gate: a page seeded with a
  cookie, form values, `contenteditable` text, script/style text, hidden subtrees, a
  `<template>`, `javascript:`/`data:` URLs, `localStorage`, and a URL query string. It
  captures the seeded card **and every descendant, in both modes, as JSON and as
  Markdown**, and asserts no seed appears anywhere. Its first test re-derives the seed
  list from the served fixture, so adding a seed without extending `SEEDS` fails instead
  of silently shrinking the gate. A failure there is a real defect, never a test bug.
- `tests/e2e/shot-live.spec.ts` is the only test on the real `getDisplayMedia` path and
  it **skips** on machines where a provisioned browser cannot read a capture surface
  (macOS: granted, then `NotReadableError`). The panel-button-to-canvas chain is
  therefore covered by `docs/phase-0-manual-checks.md`, not by CI.
- CI runs offline. Tests that need the deployed site are tagged `@live` in their title
  and excluded with `--grep-invert @live`.

## Gotchas

- The bookmarklet must be re-dragged to the bookmarks bar after every `npm run build`
  — self-contained delivery has no runtime update path.
- Screenshot crop scale is `videoWidth / window.innerWidth`, **never**
  `devicePixelRatio`. The captured frame is not guaranteed to equal viewport × DPR.
- `preferCurrentTab` is Chromium-only, and `getDisplayMedia` needs a secure context
  plus live user activation — so the capture must originate from the click on the
  screenshot control itself.
- `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `eval` / `new Function` / `fetch`
  are lint-banned in `src/`. Pages with `require-trusted-types-for 'script'` or a
  strict CSP are real targets, including Claude artifact documents.
- Never inject a `<style>` tag and never use `<img src="blob:">` — `style-src` and
  `img-src` can block both. UI styling goes inline or via a constructed stylesheet
  inside a closed shadow root; the screenshot preview paints into our own `<canvas>`.
- `sheet.cssRules` throws `SecurityError` on cross-origin stylesheets (any CDN or
  Google Fonts link). Wrap it and degrade to a `cross-origin-stylesheet` omission.
- `getMatchedCSSRules` no longer exists; matched rules are hand-rolled by walking
  `document.styleSheets` and testing `el.matches(selectorText)`.
- A Claude artifact embedded in the claude.ai shell is a **cross-origin iframe** and
  is out of reach — a bookmarklet only ever runs in the top document. Open the
  artifact document as the top-level page instead. `claude.ai` is also a sensitive
  host: `classify()` forces it (and subdomains) to unknown even when the baked
  config lists it, so it always runs restricted — never re-route this through the
  config path.
- A locator that reports `confidence: 'exact'` while resolving to a different element
  is a hard defect, not a low-confidence result.
- In the real flow the pointer is resting on the picked element at capture time, so
  `el.matches('.x:hover')` is TRUE — never classify state rules by whether they
  currently match (headless tests have no pointer and will not catch it).
- `CSSRuleList` indices restart at 0 inside every nested rule list (`@media` etc.);
  source-order tie-breaks need the document-order counter from the rules walk.
- Stylesheet hrefs are URLs like any other: every emission (omission details, `sheet`
  provenance) goes through `reducedUrl` — signed CSS URLs carry credentials in the query.
- CSS VALUES are URL surface too: `cursor`/`filter`/`backdrop-filter`, pseudo `content`,
  custom properties, and keyframes text resolve `url()` to absolute **with the query
  string** — every captured style value goes through `reduceCssUrls`, and
  `seeded-secrets.html` seeds the class, not just one property.
- `isStackingContext` must stay COMPLETE: `opacity<1`, `isolation:isolate`,
  `mix-blend-mode`, `backdrop-filter`, `contain:layout`, and z-index-less
  `fixed`/`sticky` were all missed once. Verify a trigger against real paint order
  (elementFromPoint), never from memory.
- Prettier owns prose and data files only; `.prettierignore` excludes `*.ts`/`*.mjs`
  because the code is hand-formatted (compact allowlist tables, aligned WHY comments,
  blocks that match the plan verbatim) and ESLint owns the code. Don't widen it casually.
- Every omission reason must exist in the `OmissionReason` union in `src/types.ts` first;
  spec §6.5 and `docs/data-contract.md` are transcribed from it, never maintained in
  parallel.
- The encoded payload is a budget enforced by `tests/unit/build.test.ts` (< 60,000
  bytes; currently 52,129). Check the number `npm run build` prints before adding a
  feature, not after.
- `selector.config.json` is gitignored and holds your real trusted origins. Only
  `selector.config.example.json` (loopback only) is committed. Never put a
  non-personal hostname in the committed example, and never commit capture output,
  fixtures, or screenshots taken from any non-public site.
