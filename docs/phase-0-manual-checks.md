# Phase 0 manual checks

Three things no test in this repository can establish. They are listed here rather than
silently assumed, and no automated test claims any of them.

Budget: about 10 minutes. Do them in order, on the machine you actually use the
bookmarklet from, and write the result into the **Result** block under each check —
including the date and browser versions, because "it worked" without a version is not a
record.

Prerequisite for all three:

```sh
npm ci
npm run build          # note the encoded payload size it prints
open dist/install.html # drag the "ui-selector" link to your bookmarks bar
```

For check 1 you also need the fixture server (the same one Playwright uses):

```sh
node tests/server.mjs tests/fixtures 8081
```

---

## Check 1 — A real bookmarklet click under a strict CSP

**Why this is manual.** The Task 7 automated test loads the bundle as a same-origin
`<script>` on `strict-csp.html`, because Playwright cannot click a `javascript:`
bookmark. So it proves the _UI builder_ survives the CSP; it explicitly cannot prove that
a `javascript:` URL invoked from the bookmarks bar runs at all under that policy. This
check is the only evidence for that claim.

**Steps** (~4 min)

Two things that are easy to misread as failures — both cost a real debugging detour the
first time this check was run, so they are stated before the steps rather than after:

- **No trust dialog appears on a loopback origin, and that is correct.** `classify()` in
  `src/trust.ts` ignores the port for loopback hosts, and the release build bakes in
  `http://localhost`, so `localhost:8081` is _trusted_ — the tool goes straight to
  selection. To exercise the unknown-origin dialog by hand you need a **non-loopback**
  origin (`https://skill-shelf.pages.dev`, or this machine's LAN IP): with the committed
  example config, nothing served locally is untrusted, ports included.
- **A clean teardown clears the guard, so you can re-run on the same page immediately.**
  `src/boot.ts` sets `window.__uiSelectorActive__` on entry and clears it on teardown, so
  Close/Escape leaves the page re-runnable. A reload is only needed when a previous
  activation never tore down — which is exactly what the pre-loaded-bundle fixture does,
  and is why `strict-csp-manual.html` exists. (An earlier version of this note claimed a
  reload was always required. Wrong, and worth stating: the guard clearing itself is the
  evidence that teardown actually runs.)

1. Open `http://localhost:8081/strict-csp.html` (fresh load).
2. Open DevTools → Console, clear it, and arm a violation collector — more reliable than
   reading the console, since a violation that does not break the flow is easy to miss:

   ```js
   window.__csp = []
   document.addEventListener('securitypolicyviolation', e =>
     window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
   )
   ```

3. Click the **ui-selector** bookmark on the bar.
4. Hover — the highlight overlay should track the element under the cursor — then click one
   element (the page has a `#t` button).
5. Confirm the preview panel renders with JSON in it, click **Copy JSON**, and paste
   somewhere to confirm the clipboard write worked.
6. Press Escape, then read the result:

   ```js
   console.log(
     JSON.stringify(
       {
         ran: window.__uiSelectorActive__ ?? 'never ran',
         csp: window.__csp,
         leftover: [...document.body.children].some(n => n.shadowRoot),
         bodyLastChild: document.body.lastElementChild?.tagName,
       },
       null,
       2,
     ),
   )
   ```

   `ran: 'never ran'` would mean Chrome refused to execute the `javascript:` URL at all —
   the one outcome that would invalidate self-contained delivery. `ran: true` with an empty
   `csp` array is the pass.

**Expected.** Overlay appears, selection works, panel renders, clipboard write succeeds,
and the console shows **zero** `Content-Security-Policy` violations.

**Result** — PASS

```
Date:                        2026-08-22 19:39
Browser + version:           Chrome 151.0.7922.172 (macOS)
Page:                        http://localhost:8081/strict-csp-manual.html
Encoded payload in bookmark: 52,129 chars (byte-identical to dist/bookmarklet.txt)
Guard before the click:      undefined  <- proves the bookmarklet itself ran
Overlay appeared:            yes
Selection + panel worked:    yes — captured <button> #t, "Nothing was omitted"
CSP violations in console:   none (securitypolicyviolation collector returned [])
Clipboard write worked:      yes — Copy JSON produced the full object on paste
Clean teardown:              yes — guard cleared, bodyChildren "H1,P,BUTTON", strayDivs 0
```

Notes: this is the one claim no automated test in the repo can make, and it holds — a real
`javascript:` URL invoked from the bookmarks bar executes and completes a full capture under
`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
require-trusted-types-for 'script'`, with zero violations. The CSP-motivated rules
(no `innerHTML`, no injected `<style>`, `<canvas>` instead of `<img src="blob:">`, no runtime
network) are what bought this; none of them was speculative.

**Three defects in this document and its fixtures were found by running it**, all mine, and
all worse than a code bug because a checklist is the only source of truth for the person
following it:

1. The original step 4 said to expect a trust dialog and called the origin unknown. Wrong
   twice over: `classify()` ignores the port for loopback, so `localhost:8081` is _trusted_
   — and a trusted origin still shows a dialog, just the Standard/Deep mode chooser rather
   than a run-once prompt. "No dialog" was read as failure when the real problem was
   elsewhere entirely.
2. The check pointed at `strict-csp.html`, which ends with
   `<script src="/ui-selector.test.js">` because Task 7's automated test cannot inject under
   `script-src 'self'`. That script runs `main()` at load and sets the single-instance guard,
   so **a bookmarklet click on that page is always a silent no-op** — the fixture is
   structurally hostile to the manual check it was named in. Fixed by adding
   `strict-csp-manual.html`: identical policy, no pre-loaded bundle, with
   `tests/unit/fixtures.test.ts` asserting the two policies never drift apart.
3. Nothing in the pipeline ever verified this document. 82 findings across three adversarial
   plan rounds and five code-review lenses, all aimed at code; the checklist responsible for
   the claims automation _cannot_ reach had zero coverage. It now has two tests behind its
   central fixture, which is not the same as coverage but is no longer zero.

---

## Check 2 — Cross-browser behaviour, and bookmark sync survival

**Why this is manual.** Two separate reasons.

Provisioned browsers cannot actually read a capture surface: with
`--use-fake-ui-for-media-stream --auto-select-tab-capture-source-by-title`, the track is
granted and then fails with `NotReadableError` — verified on macOS in headless shell, new
headless, _and_ headed Chromium. `tests/e2e/shot-live.spec.ts` therefore skips loudly on
such a machine instead of asserting a capability the environment does not have, and the
crop arithmetic is covered instead by the deterministic `streamFactory` seam in
`shot.spec.ts`. What that leaves unproven anywhere in CI is the whole real chain: a click
on the panel's **Screenshot** control → transient user activation → a live
`getDisplayMedia` stream → a frame → the cropped canvas in the panel. This check is the
only evidence for it.

And no harness can export, re-import, or sync a bookmark.

**Steps** (~4 min)

1. Install the same bookmarklet in **Firefox** and **Safari** (drag from
   `dist/install.html` in each, or paste `dist/bookmarklet.txt` into a manually created
   bookmark).
2. In each browser, open a page you trust (a localhost dev server), click the bookmark,
   select an element, and confirm the JSON and Markdown outputs are produced.
3. In each browser, click the panel's **Screenshot** control. Note whether the control was
   enabled, what the surface picker offered, and — after picking this tab — whether the
   cropped image in the panel actually frames the selected element.
4. Restart Chrome and click the bookmark again (a bookmark that only works before a
   restart is not delivered).
5. Export bookmarks to HTML, re-import the file, and click the re-imported bookmark.
6. If a second signed-in device is available, wait for sync and click the bookmark there.
7. Record the **largest encoded payload length that survived** every step above — that
   number is the delivery envelope, and `tests/unit/build.test.ts` enforces a budget
   against it.

**Expected.** Selection, capture, and both outputs work in all three engines. The
Screenshot control is **enabled wherever `navigator.mediaDevices.getDisplayMedia`
exists** — including Firefox and Safari — because support is decided by that one fact.
What differs is the picker: `preferCurrentTab` is a Chromium-only hint, so Chromium offers
this tab directly while Firefox and Safari show their own system surface picker and you
choose the tab manually. Either way the crop should still land on the element, because the
crop scale is derived from `videoWidth / window.innerWidth` and never from
`devicePixelRatio`. Bookmark export/import and sync should carry the payload intact.

**Result**

```
Date:                                 2026-08-22 19:50
Chrome version / worked:              151.0.7922.172 / yes
Firefox version / worked:             NOT INSTALLED on this machine — untested, not assumed
Safari version / worked:              26.3 / capture yes, screenshot NO (by design, see below)
Screenshot control enabled in:        Chrome (yes). Safari: enabled but always refuses — Chromium-only
Picker offered this tab directly in:  Chrome only. Safari offers window/screen and NO tab option
Crop landed correctly in:             Chrome (exact, DPR 2). Safari: wrong before the fix, now refused
Survived Chrome restart:              yes
Survived export + re-import:          yes
Survived sync to a second device:     n/a — no second device available
Largest encoded length that survived: 52,882 bytes (install, click, restart, export + re-import)
```

**The crop scale is now evidenced on a real stream.** At DPR 2 the cropped image framed the
target exactly. Had the code used `devicePixelRatio` instead of
`videoWidth / window.innerWidth` — which the plan's first draft did — the result would have
been visibly offset or doubled. Every automated test drives a synthetic
`canvas.captureStream`, so this scale relationship on a genuine `getDisplayMedia` frame had
no evidence anywhere until this click.

**Three real defects surfaced here, all on the path CI cannot reach.** The trigger was
mundane: the first Screenshot click timed out, the user clicked again, it worked — and the
panel then showed the image _and_ `screenshot — unsupported-browser (no frame delivered)`
side by side.

1. **A retry did not supersede the previous attempt's failure.** `takeScreenshot` closes over
   the capture's single `ctx`, and `omit()` only appends. Copying the JSON at that moment
   would have handed an agent a screenshot together with a record saying no screenshot was
   captured — and an agent that believes the omission discards a perfectly good image.
   Fixed with `ctx.supersede(field)`, called at the top of every attempt.
2. **A frame timeout was labelled `unsupported-browser`** — a capability claim, and false.
   The browser was entirely capable; that one attempt did not deliver in time. Now
   `no-frame-delivered`, a distinct reason whose detail says a retry may work.
3. **`video: { frameRate: 1 }` with a 3 s deadline was too tight in practice.** The cap
   saved nothing (exactly one frame is taken) and could delay the first frame by a second.
   Removed, and the deadline raised to 8 s.

Only the third needed a human to find. The first two were reachable by a test that nobody
had thought to write, because nobody had clicked the button twice — and clicking twice is
what a real person does when the first click appears to do nothing. Three new e2e tests now
cover all three, including that superseding one field leaves other fields' omissions intact.

---

## Check 3 — Claude artifact frame topology — RESOLVED: artifacts cut from v1

**Ran 2026-08-22 20:18. Outcome: the documented workaround does not exist, and artifact support was
removed from v1 as a result.**

Measured on a real published artifact:

```
iframe on claude.ai:  src  = https://<uuid>.frame.claudeusercontent.com/...
                      sandbox = "allow-scripts allow-same-origin allow-forms"
that document:        bodyChildren = HEADER#hdr, DIV#hdr-degraded, MAIN, DIV#err, DIV
                      elementFromPoint(centre) = IFRAME.ready     <- nested AGAIN
innermost iframe:     has a real src; opened top-level; still only one selectable box
```

So an artifact is **three frames deep**, not one. Every hop was tried by hand: the claude.ai
shell, the middle `frame.claudeusercontent.com` document, and the innermost URL. All three
yield the same thing — the next frame's box — because a bookmarklet only ever executes in
the top document.

`allow-same-origin` in the sandbox attribute is a red herring: it stops the frame being
forced into an opaque origin, and grants a parent document nothing.

**Why this is a cut and not a bug.** Two independent walls:

1. Reaching inside frames requires an extension with all-frames injection. Different
   product.
2. Even granted access, artifacts could never be _trusted_: each lives on its own random
   subdomain, and `classify()` matches hostnames exactly on purpose — suffix matching is
   precisely how a lookalike host gets trusted. One config entry would cover one artifact.
   Artifacts would run permanently restricted (80-char cap, no Deep).

**This invalidated an earlier decision, which is the part worth keeping.** Artifact support
was put to the user as a choice between accepting a one-hop workaround and building an
extension, and the workaround was chosen. That choice rested on the workaround existing.
It did not. The premise came from reading the spec's own §3, which asserted the topology
from inference and never verified it — the plan had even scheduled a spike to check exactly
this, and the manual check inherited the unverified claim instead of testing it first.

**What shipped instead of silence.** Selecting a frame now records
`frame-content-unreachable` with the boundary named. Before that, selecting an artifact
returned a brief that looked entirely successful — box model, computed styles, no omissions —
describing an empty rectangle. That is the failure mode this whole checklist exists to catch:
not a crash, a confident wrong answer.

```
Date:                                      2026-08-22 20:18
iframe on claude.ai (origin):              <uuid>.frame.claudeusercontent.com — cross-origin, confirmed
sandbox:                                   allow-scripts allow-same-origin allow-forms
Artifact document cross-origin:            yes
Nested deeper still:                       yes — IFRAME.ready inside the middle document
Bookmarklet on the claude.ai shell:        selects shell chrome only; artifact area is one frame box
Bookmarklet on the middle document:        selects IFRAME.ready, nothing inside it
Bookmarklet on the innermost URL:          still a single box
Documented workaround:                     FAILED — does not exist at any depth
Resolution:                                artifacts cut from v1 (user decision, 2026-08-22 20:18)
```

## If a check fails

- **Check 1 or 2 fails** — the delivery mechanism is the problem, not the capture core.
  Delivery switches to the fallback already scoped in the plan: a ~1 KB `javascript:`
  loader plus an SRI-pinned payload, which means Task 1 (build pipeline and install page)
  is revised. Everything from Task 2 onward is unaffected **by design** — the capture core
  never depends on how the payload arrived.
- **Check 3 fails** in the direction of "the artifact document is same-origin after all" —
  that would be good news, not a defect: re-read spec §3, because the v1 caveat could then
  be narrowed. If instead the top-level-page workaround fails, the README's artifact
  section is wrong and must be corrected before anyone relies on it.

Record failures here as well as fixing them. A check that failed once and passed after a
change is more useful to the next person than a checklist with only green in it.

---

## Check 2b addendum — Safari, 2026-08-22 20:02

**Result: screenshots are Chromium-only. Decided on evidence, not preference.**

Safari 26.3 ran the tool correctly — selection, JSON, prompt Markdown, `Nothing was
omitted`, and the Screenshot control was enabled exactly as spec §7 predicted. Then the
screenshot came back as a near-empty sliver, **with no omission recorded**: the code believed
it had succeeded.

Cause. The crop assumes the frame _is_ the viewport — frame pixel (0,0) is viewport CSS
(0,0), and `videoWidth / innerWidth` is the CSS-to-frame scale. That holds only for tab
capture. Safari's picker offers **only window and screen, no tab at all**, so the frame
carries browser chrome and desktop at an offset that cannot be determined from inside the
page, and `videoWidth` is the screen's width rather than the viewport's. Both the scale and
the origin were wrong, and nothing checked.

This falsified the spec clause written two commits earlier — "a missing `preferCurrentTab`
hint merely degrades the experience" — on its first contact with a non-Chromium browser. It
does not degrade the experience. It produces a confidently wrong image, silently, which for
a design brief is worse than no image at all: a misaligned screenshot misleads and nothing
downstream can detect it.

Fixed by verifying the surface before cropping — `displaySurface === 'browser'` where
reported, else a 2% aspect-ratio match against the viewport — and recording
`wrong-capture-surface` with no image when it fails. Two e2e tests cover both directions,
because a guard with only the refusal tested is indistinguishable from "screenshots never
work".

**That spec clause has now been wrong three times**, which is worth more than the fix:

1. Draft: gated on `getSupportedConstraints()` — a track-constraint probe that does not list
   `preferCurrentTab`, so it reported the hint absent even on Chromium. Broken detector.
2. Round-3 review: "works wherever `getDisplayMedia` exists, the hint only degrades UX."
   Plausible, reviewed by three rounds, and false.
3. Now: works only where the frame can be established to be this viewport.

Each version was more defensible than the last, and only the third survived contact with a
second browser. The right gate turned out to be neither a capability probe nor a browser
name, but a property of the frame in hand — and no amount of review found that, because
review had no second browser to run.

**Safari status: supported for capture, not for screenshots.** Firefox: not installed on
this machine, untested, and recorded as untested rather than assumed either way.

---

## Check 3 partial — 2026-08-22 20:08

**The §3 caveat is confirmed on a real artifact.** On the claude.ai shell the only selectable
thing over an artifact is one large box — the `<iframe>` element itself. Individual text,
components, and images inside it are unreachable, exactly as predicted: a bookmarklet runs
only in the top document.

**And the code said nothing about it.** Selecting the frame returned a JSON brief that looks
successful — a box model, computed styles, no omissions — describing an empty rectangle.
Same failure shape as the Safari screenshot: not a crash, not an error, just a confident
answer to a question the tool cannot actually answer. A user with no knowledge of frame
boundaries would read that output as "this component has no styles".

Fixed: selecting an `IFRAME` / `FRAME` / `OBJECT` / `EMBED` now records
`frame-content-unreachable`, and the detail names the way out — open the frame URL as a
top-level page. Cross-origin is distinguished from same-origin (v1 traverses neither, but
the reason differs, and so does whether traversal could ever be added). Tested against
`frames.html` with a genuinely cross-origin frame, a same-origin frame, and an ordinary
element as a no-false-positive control.

Still outstanding: the workaround itself — step 5 — has not been exercised. If opening the
artifact document as a top-level page does not work, the README's artifact section is wrong
and must be corrected before anyone relies on it.

```
Date:                                      2026-08-22 20:08
iframe list (paste):                       pending
Artifact document cross-origin:            yes (confirmed by behaviour: only the frame box is selectable)
Bookmarklet on the claude.ai shell:        runs in the top document; selects the iframe box only,
                                           and now says frame-content-unreachable
Bookmarklet on the artifact as top-level:  PENDING — the documented workaround, still unverified
```
