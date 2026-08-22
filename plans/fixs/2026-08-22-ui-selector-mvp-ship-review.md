# /ship review log — ui-selector MVP

Plan: `plans/2026-08-22-ui-selector-mvp.md`
Pipeline: spec + plan + 3 adversarial rounds (codex pane) → Workflow implementation
(5 sequential agents) → multi-lens review + fixes → gate → commit.

## Implementation

5 agents, 0 errors, 41 deviations, **0 scope-changing**. 21 source files / 2,534 LOC,
1,387 test LOC. Encoded bookmarklet 49,302 bytes against a 60,000 budget.

Four defects in the *reviewed plan* were found only by running the code:

- `reducedUrl`'s literal code failed the plan's own test — `new URL('not a url ?token=SECRET', base)`
  does not throw, it parses as a relative reference and would have echoed the junk back.
- `firstFrame()` hung 30s on a trackless stream until the metadata wait was bounded.
- The `specificity.html` fixture spec was self-contradictory: `#id .btn` cannot match the
  element that *is* `#id`.
- Playwright rejects `test.use({ launchOptions })` inside a `describe`.

Reported honestly rather than papered over: `shot-live.spec.ts` self-skips here (a
provisioned Chromium grants the display-capture track then throws `NotReadableError`), and
the clipboard buttons have no automated coverage (`navigator.clipboard` needs granted
permissions). Both moved to `docs/phase-0-manual-checks.md`.

## ship-review round 1

`ship-review round 1: 9 confirmed / 9 fixed / 0 left, per lens: privacy 2, correctness 3,
test-integrity 2, plan-conformance 2, simplification 0`

21 findings across 5 lenses; top 9 by severity verified by independent skeptics prompted to
refute. **9 confirmed, 0 refuted** — every verifier reproduced its finding in real Chromium
rather than reasoning about it.

The two that matter most:

1. **Stylesheet hrefs bypassed `reducedUrl`** (high, privacy). A signed CSS URL
   (`?X-Amz-Signature=…`) was emitted verbatim in `cross-origin-stylesheet` omission
   details and in Deep's `sheet` provenance — and rendered into the Markdown a user pastes
   to a third-party agent. Every other URL emission in the tool goes through reduction;
   this one path did not. Missed by all three plan-review rounds *and* by the standing
   redaction gate, because no fixture seeded a stylesheet href. Fixed with `sheetLabel()`,
   and the gate now seeds `?sig=SEEDED-SHEET-QUERY`.

2. **`:hover` was never reported as an interaction state in the real flow** (high,
   correctness). The pointer rests on the picked element at capture time, so
   `el.matches('.btn:hover')` is true — and state rules were classified by whether they
   *currently* match, so hover fell into `applied` instead of `states`. It then won the
   declared-value map, so the brief reported `--bg-hover` as the element's background
   token. Invisible to every headless test, because `page.evaluate` never moves a mouse.
   State classification now runs first, independent of whether the state holds.

Two more were the same class as the earlier privacy holes — **wildcards in a codebase whose
discipline is closed lists**: `captureEnv` shipped every `data-*` on `<html>`
(`data-csrf-token`, `data-user-email`), and a bare `aria-*` prefix emitted `aria-checked` /
`aria-valuenow` / `aria-valuetext`, which *are* the user's form values on custom widgets —
the ARIA mirror of the `value`/`checked` prohibition. Both replaced with closed lists
carrying recorded exclusion rationales.

Two test-integrity findings were proven by mutation, and both had been passing vacuously:
`drawImage(video, 0, 0, …)` survived all 8 screenshot tests because the crop's *source
offset* was never asserted, and `collectAssets → []` survived the whole suite because the
only Deep-asset test ran on a fixture yielding zero assets.

Gate after round 1: lint clean, format unchanged, typecheck clean, 79 unit tests, 50 e2e
passed + 1 skipped, bundle 50,658 bytes.

## ship-review round 2

`ship-review round 2: 5 confirmed / 5 fixed / 0 left, per lens: privacy 1 high,
trust-model 1 low, correctness 2 (medium + low), test-integrity 1 low`

Every finding survived an independent skeptic who reproduced it in real Chromium
before it reached the fix pass. All five fixed, each red-first where a test could
express it.

1. **url() in captured STYLE VALUES bypassed reduction** (high, privacy). The
   allowlists.ts comment "No URL-bearing property appears here" was false: `cursor`,
   `filter`, and `backdrop-filter` accept `url()`, and the computed value resolves it
   to an absolute URL with query string and fragment intact. Five verbatim sinks
   (styles.computed, pseudo computed, pseudo `content`, variables `resolved`, rule
   declarations) plus Deep keyframes `cssText` — the same class as round 1's
   stylesheet-href leak, again missed by the redaction gate because no fixture seeded
   url()-bearing CSS. Fixed with `reduceCssUrls` in sanitize.ts routed through every
   style value (non-http(s) schemes drop as `url()` + `blocked-scheme`);
   `seeded-secrets.html` now seeds the class (cursor/filter/backdrop-filter/pseudo
   content/custom property/keyframes), run red first.

2. **Spec §3's sensitive-host rule was documentation, not code** (low, trust model).
   Nothing prevented a user config listing `claude.ai` from unlocking the trusted cap
   AND Deep mode (~20,000 chars of conversation text, not 200). `classify()` now
   forces `claude.ai` and subdomains to unknown before consulting the config; the
   run-once dialog explains the downgrade instead of claiming "not in your list";
   README/CLAUDE.md tightened from "should" to the enforced guarantee. Red-first unit
   tests pin the configured case.

3. **`isStackingContext` missed seven real triggers** (medium, correctness):
   `opacity<1`, `isolation:isolate`, `mix-blend-mode`, `backdrop-filter`,
   `contain:layout`, and z-index-less `fixed`/`sticky`. The walk ran past genuine
   paint boundaries and confidently reported non-participating ancestors — verified
   against Chromium's actual paint order, not spec-reading. Predicate completed;
   red-first e2e tests cover every added trigger.

4. **Selector scanners mis-read a quoted string ending in a literal backslash**
   (low, correctness). `text[i-1] !== '\\'` does not count the backslash run, so
   `[data-x="a\\"], .b` merged into one part, a `:hover` variant was silently filed
   as an applied rule (the exact CLAUDE.md hard rule, through a different door), and
   specificity was wrong. Shared `closesQuote` (even-run check) at all three sites;
   red-first unit tests.

5. **shot-live's skip guard swallowed every failure mode** (low, test-integrity).
   `test.skip(omissions.length > 0)` would report a real defect (e.g. 'no frame
   delivered' with a working surface) as an environmental skip. Guard now matches
   only the environmental signature (exactly one `unsupported-browser` omission with
   `NotReadableError` / `getDisplayMedia unavailable`) and asserts `omissions` empty
   otherwise. Still skips on this macOS machine, as documented.

Gate after round 2: lint clean, format clean, typecheck clean, 85 unit tests, 52 e2e
passed + 1 skipped (shot-live, environmental), bundle 52,129 bytes of 60,000.

## Deferred — carried into v1.1, not silently dropped

`review-loop: budget-spent (2 rounds, 6 non-HIGH deferred)`

TEMP(2026-08-22, until: v1.1): the items below are known and deliberately unfixed.

**Unverified, not refuted** — its skeptic died on an API error mid-run, so nobody checked it:

- `src/capture/styles.ts:103` (medium) — custom properties are extracted only from
  declarations found in `rules.applied`. A `var()` reference reaching an allowlisted
  property from another source may be silently absent from `styles.variables` with no
  `indeterminate-definition` omission. Verify this first in v1.1; it is the only finding in
  the whole run with no verdict either way.

**Refuted, recorded for the trail:**

- `tests/e2e/locate.spec.ts:15` — the survival test checks match count and tagName but not
  element identity. The skeptic refuted the load-bearing half: other tests in the suite *do*
  catch a wrong-element `exact` locator, so the stated hard-defect condition is covered.

**Confirmed-by-lens but never verified (below the round-1 severity cut), all
simplification-class:**

- `src/capture/deep.ts:33` — `visibleText` does two unrelated jobs: extract capped text and
  emit shadow-boundary omissions, so a Deep capture can double-report the boundary.
- `src/boot.ts:48` — `displayCaptureSupported()` and its omission string are written twice.
- `src/ui/panel.ts:59` — the `button()` helper is byte-identical in `trust.ts:76`.
- `src/capture/deep.ts:61` — the `isType` CSSOM feature-detector is byte-identical in
  `rules.ts:29`.
- `src/ui/panel.ts:89` — `showPanel`'s `shot` parameter is dead; every call site passes
  `null`.

None is a correctness or privacy defect. Each is cheap to fix and none was worth spending
the last review round on while a HIGH `url()` leak was open.

## What no test covers

Recorded plainly because a green suite should not be read as more than it is:

- **The real `getDisplayMedia` path.** `tests/e2e/shot-live.spec.ts` skips on this machine —
  a provisioned Chromium grants the capture track then throws `NotReadableError`. Round 2
  narrowed the skip guard so it now matches only that environmental signature and asserts
  no omissions otherwise, but the path is still unexercised here.
- **The clipboard buttons.** `navigator.clipboard.writeText` needs granted permissions; only
  the download button is covered.
- **A real `javascript:` bookmarklet click under a strict CSP.** Playwright cannot click a
  browser-chrome bookmark, so no automated test can make this claim. It is the first item in
  `docs/phase-0-manual-checks.md`.
