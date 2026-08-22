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

1. Open `http://localhost:8081/strict-csp.html`.
2. Open DevTools → Console, and clear it.
3. Click the **ui-selector** bookmark on the bar.
4. Confirm the trust dialog appears (this origin is unknown unless you added it), choose
   **Run once**, then hover — the highlight overlay should track the element under the
   cursor — and click one element.
5. Confirm the preview panel appears with JSON in it, click **Copy JSON**, and paste
   somewhere to confirm the clipboard write worked.
6. Read the console. Record **every** CSP violation, including ones that do not stop the
   flow.
7. Press Escape to close the panel and confirm the page is left as it was: no leftover
   overlay, no leftover host element (`document.body.lastElementChild` should be the
   page's own node).

**Expected.** Overlay appears, selection works, panel renders, clipboard write succeeds,
and the console shows **zero** `Content-Security-Policy` violations.

**Result**

```
Date:
Browser + version:
Overlay appeared:            yes / no
Selection + panel worked:    yes / no
Clipboard write worked:      yes / no
CSP violations in console:   none / (paste them)
Clean teardown:              yes / no
Notes:
```

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
Date:
Chrome version / worked:
Firefox version / worked:
Safari version / worked:
Screenshot control enabled in:        Chrome / Firefox / Safari
Picker offered this tab directly in:  Chrome / Firefox / Safari
Crop landed correctly in:             Chrome / Firefox / Safari
Survived Chrome restart:              yes / no
Survived export + re-import:          yes / no
Survived sync to a second device:     yes / no / n/a
Largest encoded length that survived: ______ bytes
Notes:
```

---

## Check 3 — Claude artifact frame topology

**Why this is manual.** It must run in your own logged-in claude.ai session. Nothing in
CI can log in, and nothing should try.

**Steps** (~2 min)

1. Open one of your **own** published artifacts in claude.ai.
2. In DevTools on the claude.ai page, run:

   ```js
   const frames = [...document.querySelectorAll('iframe')].map(f => ({
     src: f.src,
     sandbox: f.getAttribute('sandbox'),
   }))
   console.table(frames)
   ```

3. Record the result, and specifically whether the artifact document's origin differs from
   `https://claude.ai` (i.e. whether it is cross-origin).
4. Click the bookmark on the claude.ai page and record what happens: the tool should run
   in the top document and be unable to select anything inside the artifact frame.
5. Open the artifact document's own URL as the **top-level** page (paste the frame `src`
   into a new tab) and click the bookmark there. Select an element and confirm the capture
   is of the artifact's own DOM.

**Expected.** The artifact document is a cross-origin iframe, unreachable from a
bookmarklet, and the top-level-page workaround documented in the README works. Keep
`claude.ai` out of your trusted origins either way — the shell page carries conversation
text, so it should always run under the restricted cap.

**Result**

```
Date:
iframe list (paste):
Artifact document cross-origin:            yes / no
Bookmarklet on the claude.ai shell:        (what happened)
Bookmarklet on the artifact as top-level:  worked / failed
Notes:
```

---

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
