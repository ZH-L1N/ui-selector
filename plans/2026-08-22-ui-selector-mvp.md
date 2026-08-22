# ui-selector MVP Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan
> task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Stop at the end of
> each task for review before starting the next.

**Status: implemented 2026-08-22 18:07.**

**Goal:** A self-contained, CSP-safe bookmarklet that captures a complete
frontend-design brief for one selected element as JSON an AI coding agent can act on.

**Architecture:** TypeScript compiled by esbuild into a single dependency-free IIFE,
percent-encoded into a `javascript:` bookmarklet with trusted origins baked in at
build time. The capture core is a pure function `capture(el, ctx) => CaptureV1` over
deny-by-default allowlist tables, which makes the privacy contract unit-testable
without a browser. All UI lives in a closed shadow root built without `innerHTML`.

**Tech Stack:** TypeScript 5, esbuild (bundle + minify), vitest + jsdom (unit),
Playwright (browser), Node 20+, npm. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/ui-selector-mvp.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Repository: `ZH-L1N/ui-selector`, public, MIT `LICENSE` + `NOTICE` crediting
  `oil-oil/selector` as prior art. All repository content in English.
- Zero runtime dependencies. Zero runtime network requests.
- Forbidden in `src/`: `eval`, `new Function`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, injected `<script>`, injected `<style>` tag,
  `<img src="blob:">`. Enforced by a lint rule in Task 1.
- UI is built with `createElement` + `textContent` inside a **closed** shadow root.
- Never captured: cookies, any storage API, form values, framework runtime
  state/props, URL query string or hash, `contenteditable` text.
- Page identity is `origin` + `pathname`, always.
- `schemaVersion: "1.0"` on every output; every omission recorded with a reason.
- Browser target: Chrome/Chromium. Firefox/Safari best-effort: selection and capture
  work, and screenshots work wherever `getDisplayMedia` exists — without the
  `preferCurrentTab` hint the user picks the surface manually. Screenshot is disabled,
  with an `unsupported-browser` omission, only when `getDisplayMedia` is absent.
- Screenshot crop scale is `videoWidth / window.innerWidth`, never `devicePixelRatio`.
- Two output formats, **one capture path**: `toMarkdown(result: CaptureV1)` is a pure
  function of the already-sanitized object and must never read the DOM. This is what
  makes Markdown inherit the redaction guarantees for free.
- Claude artifact support is the "open the artifact document as the top-level page"
  flow only. No design choice in v1 may be justified by a future extension.
- **CI must never depend on a live external site, and never on the network.** Browser
  tests run against **committed** fixtures served by the zero-dependency
  `tests/server.mjs` on ports 8080 / 8081 / 8082. Nothing is fetched, and no `npx`
  download happens at test time. Tests that genuinely need the deployed site carry an
  `@live` tag in their title and are excluded from CI; they are run by hand before a
  release.
- **Every Playwright test loads `dist/ui-selector.test.js`** (built by
  `npm run build:test`), which is the only artifact exposing `window.__uiSelectorTest`.
  The release bundle must never contain that hook — Task 1's build test pins it.
- Total encoded payload must stay within the Spike 1 envelope with ≥2× headroom.
- Repo guidance file: `CLAUDE.md` is the real file; `AGENTS.md` is a one-line pointer
  to it.
- No commit or push without explicit user authorization.

---

## Phase 0 — Validation gate (no product code until these pass)

These three spikes are throwaway. Write them under `spikes/`, keep the results in
`docs/superpowers/specs/spike-results.md`, and do not carry the code forward.

### Spike 1: Delivery envelope and frame topology

- [ ] **Step 1: Generate padded payloads**

Write `spikes/s1-payload.mjs` that emits three `javascript:` URLs whose *encoded*
lengths are approximately 20 KB, 60 KB and 120 KB. Pad with a long string constant
so the code still does something observable:

```js
// spikes/s1-payload.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('spikes/out', { recursive: true })          // else ENOENT on a clean checkout
const sizes = { small: 20_000, medium: 60_000, large: 120_000 }
for (const [name, target] of Object.entries(sizes)) {
  let pad = 'x'
  const body = () => `(()=>{const P="${pad}";alert("ui-selector spike "+P.length+" frames="+window.frames.length)})()`
  while (encodeURIComponent(body()).length < target) pad += 'x'.repeat(1000)
  writeFileSync(`spikes/out/${name}.txt`, 'javascript:' + encodeURIComponent(body()))
  pad = 'x'
}
```

- [ ] **Step 2: Install and click each payload**

Install all three as bookmarks in Chrome, then Firefox, then Safari. Click each on:
`http://localhost:4321` (a running skill-shelf dev server), `https://skill-shelf.pages.dev/`,
a local strict-CSP fixture (see Step 3), and `https://claude.ai/code/artifact/<any-id>`.

Record: does it execute, is the alert's reported length correct (no truncation), and
what `window.frames.length` reports on the artifact page.

- [ ] **Step 3: Build the strict-CSP fixture**

```html
<!-- spikes/fixtures/strict-csp.html — serve with: node tests/server.mjs spikes/fixtures 8081 -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; require-trusted-types-for 'script'">
<button id="t" style="padding:8px 16px">Target</button>
```

- [ ] **Step 4: Persistence check**

Restart each browser; export and re-import bookmarks; if a second signed-in device
is available, confirm the bookmark syncs intact.

- [ ] **Step 5: Record the verdict**

**PASS:** the 120 KB payload executes correctly in Chrome on all four pages and
survives restart + export/import with no truncation. Record the largest surviving
encoded length per browser.
**FAIL:** switch the delivery design to a ~1 KB loader plus an SRI-pinned payload on
a user-controlled HTTPS origin, and amend the spec before Task 1.

**Also record (blocking for the artifact target):** on the claude.ai artifact page,
the iframe count and each `iframe.src` origin, obtained from DevTools console:

```js
[...document.querySelectorAll('iframe')].map(f => ({ src: f.src, sandbox: f.getAttribute('sandbox') }))
```

If the artifact document is cross-origin (expected), the spec's §3 caveat stands and
the artifact workflow is "open the artifact document as the top-level page".

### Spike 2: Screenshot fidelity

- [ ] **Step 1: Write the throwaway capture**

```js
// spikes/s2-shot.js — paste into DevTools console, click a target first
async function shot(el) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true, video: { frameRate: 1 } })
  const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true })
  await video.play()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const scale = video.videoWidth / window.innerWidth        // NOT devicePixelRatio
  const r = el.getBoundingClientRect()
  const c = Object.assign(document.createElement('canvas'), {
    width: Math.round(r.width * scale), height: Math.round(r.height * scale),
  })
  c.getContext('2d').drawImage(video, r.left * scale, r.top * scale,
    r.width * scale, r.height * scale, 0, 0, c.width, c.height)
  stream.getTracks().forEach(t => t.stop())
  return { canvas: c, scale, dpr: devicePixelRatio }
}
```

- [ ] **Step 2: Measure edge accuracy**

For 5 elements on `skill-shelf.pages.dev` and 5 on a localhost app, at DPR 1 and
DPR 2 (use Chrome's device-pixel-ratio override), overlay the returned canvas on a
screenshot of the element and measure the offset on all four edges.

- [ ] **Step 3: Measure latency and clipping**

Time from permission grant to canvas ready. Then run against an element taller than
the viewport.

- [ ] **Step 4: Record the verdict**

**PASS:** ≤ ±2 CSS px on all four edges in ≥9 of 10 cases at both DPRs, text legible
at 1:1, under 3 s, and the oversized element yields the visible portion only.
**FAIL:** ship v1 without screenshots and record an `unsupported-browser` /
`user-declined` path instead. Not a reason to reconsider the repository decision.

### Spike 3: Locator durability and capture actionability

- [ ] **Step 1: Minimal locator + capture, run headless**

```js
// spikes/s3-locate.mjs — driven by Playwright, no UI
const locate = el => {
  const t = el.getAttribute('data-testid'); if (t) return `[data-testid="${CSS.escape(t)}"]`
  if (el.id) return `#${CSS.escape(el.id)}`
  const path = []; let n = el
  while (n && n !== document.body) {
    const i = [...n.parentElement.children].indexOf(n) + 1
    path.unshift(`${n.tagName.toLowerCase()}:nth-child(${i})`); n = n.parentElement
  }
  return path.join(' > ')
}
```

- [ ] **Step 2: Durability run**

Sample 20 elements across skill-shelf and one localhost React/Astro app. Record the
locator, reload the page, re-query, and compare to the original element.

- [ ] **Step 3: Actionability run**

Feed each element's Standard-mode JSON (no screenshot) to a fresh Claude session and
ask it to reproduce the component. Judge faithful / not faithful.

- [ ] **Step 4: Redaction run**

Seed a fixture page with a cookie, a filled `<input>`, and a URL query string; capture
10 elements and grep every output for those exact values.

- [ ] **Step 5: Record the verdict**

**PASS:** ≥18/20 locators re-resolve to exactly the original element; **zero**
confident false positives (a locator claiming `exact` that resolves elsewhere fails
the whole spike); ≥16/20 judged actionable; **zero** seeded cookie values, input
values, or query parameters anywhere in output.
**FAIL:** extend the ladder (add `aria-label`, `role`, nearest stable ancestor +
relative path) and re-run.

---

## File structure

```
src/
  boot.ts               entry: single-instance guard, trust gate, mode, teardown
  trust.ts              origin classification + run-once confirmation
  pick.ts               overlay, hover highlight, click-to-select, ESC
  locate.ts             locator ladder + self-verification
  shot.ts               getDisplayMedia -> cropped canvas
  types.ts              CaptureV1 and all sub-types (single source of truth)
  allowlists.ts         style/attribute tables, depth and budget caps
  sanitize.ts           URL reduction, text caps, forbidden-field guards
  capture/
    index.ts            capture(el, ctx) orchestrator
    env.ts              viewport, DPR, theme, color-scheme
    layout.ts           geometry, box model, parent/item context, z-index chain
    styles.ts           computed allowlist, CSS variables, typography
    pseudo.ts           ::before / ::after
    rules.ts            matched rules, interaction states, media conditions, tokens
    selector.ts         depth-aware selector-list splitter, specificity, state strip
    deep.ts             subtree DOM, keyframes, asset metadata
  ui/
    dom.ts              CSP-safe element builder (no innerHTML, ever)
    markdown.ts         toMarkdown(CaptureV1) -> prompt-ready Markdown (pure)
    panel.ts            preview + copy JSON + copy as prompt + download
build/
  bundle.mjs            esbuild -> IIFE -> minify -> encode -> install.html
  install-template.mjs  install page markup generator
tests/
  unit/                 vitest + jsdom
  e2e/                  Playwright
  server.mjs            zero-dependency static server (node:http only)
  global-setup.ts       runs `npm run build:test` before the e2e suite
  fixtures/             COMMITTED pages: strict-csp, seeded-secrets, states, tokens,
                        tokens-override, responsive, pseudo, specificity, cross-origin,
                        fonts, shadow, site-lite
  fixtures/site/        COMMITTED hand-authored realistic page, served on :8080
selector.config.example.json    committed, localhost only
selector.config.json            gitignored
```

---

### Task 1: Repo scaffold, build pipeline, deterministic test harness, smoke bookmarklet

Proves the whole delivery path end to end with a trivial payload, and stands up a test
harness that runs with the machine offline. Every later task depends on this harness,
so it is built once, here, properly.

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `LICENSE`,
  `NOTICE`, `eslint.config.mjs`, `playwright.config.ts`
- Create: `build/bundle.mjs`, `build/install-template.mjs`
- Create: `tests/server.mjs`, `tests/global-setup.ts`
- Create: `tests/fixtures/site/index.html`, `tests/fixtures/strict-csp.html`,
  `tests/fixtures/seeded-secrets.html`, `tests/fixtures/cross-origin.css`
- Create: `src/boot.ts`, `selector.config.example.json`, `selector.config.test.json`
- Test: `tests/unit/build.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `npm run build` → `dist/ui-selector.js`, `dist/bookmarklet.txt`, `dist/install.html`
  - `npm run build:test` → `dist/ui-selector.test.js`, identical except that
    `__EXPOSE_TEST_HOOK__` is true so `window.__uiSelectorTest` exists. **Every
    Playwright test loads this artifact; the release bundle never contains the hook.**
  - `TrustConfig = { trustedOrigins: string[] }` read from `selector.config.json`,
    falling back to `selector.config.example.json`; the test build reads
    `selector.config.test.json`.
  - Three local static servers: `:8080` = `tests/fixtures/site`, `:8081` =
    `tests/fixtures`, `:8082` = `tests/fixtures` bound to `127.0.0.1` so it is a
    **different origin** from `:8081` — that is how the cross-origin-stylesheet path
    is tested offline.

- [ ] **Step 1: Scaffold and generate the lockfile**

`/proj-init` has already written `CLAUDE.md`; `AGENTS.md` points at it. Write
`package.json` (Step 2), then run `npm install` once to generate
`package-lock.json` and **commit the lockfile** — CI runs `npm ci`, which aborts
without it.

- [ ] **Step 2: package.json and the forbidden-API lint**

```json
{
  "name": "ui-selector",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build/bundle.mjs",
    "build:test": "node build/bundle.mjs --test",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "lint": "eslint src build tests",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "esbuild": "^0.24.0",
    "eslint": "^9.15.0",
    "jsdom": "^25.0.0",
    "prettier": "^3.4.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.16.0",
    "vitest": "^2.1.0"
  }
}
```

No static-server dependency: `tests/server.mjs` uses `node:http` only, so nothing is
downloaded at test time.

Add to `eslint.config.mjs` a `no-restricted-syntax` block enforcing the Global
Constraints:

```js
{
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "MemberExpression[property.name='innerHTML']", message: 'CSP: use dom.ts builders' },
      { selector: "MemberExpression[property.name='outerHTML']", message: 'CSP: use dom.ts builders' },
      { selector: "CallExpression[callee.name='eval']", message: 'CSP: no eval' },
      { selector: "NewExpression[callee.name='Function']", message: 'CSP: no new Function' },
      { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'CSP: use dom.ts builders' },
      { selector: "CallExpression[callee.property.name='fetch']", message: 'no runtime network' },
      { selector: "CallExpression[callee.name='fetch']", message: 'no runtime network' },
    ],
  },
}
```

- [ ] **Step 3: Write the failing build test**

```ts
// tests/unit/build.test.ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('build pipeline', () => {
  it('emits a javascript: bookmarklet with the trusted origins baked in', () => {
    execSync('npm run build', { stdio: 'pipe' })
    const url = readFileSync('dist/bookmarklet.txt', 'utf8')
    expect(url.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(url)).toContain('http://localhost')
    expect(url).not.toMatch(/\s/)
  })

  it('reports the encoded size so the Spike 1 envelope can be enforced', () => {
    const url = readFileSync('dist/bookmarklet.txt', 'utf8')
    expect(url.length).toBeLessThan(60_000)      // tighten to (Spike 1 result / 2)
  })

  it('shows the baked trusted origins on the install page', () => {
    expect(readFileSync('dist/install.html', 'utf8')).toContain('http://localhost')
  })

  it('keeps the test hook OUT of the release bundle and IN the test bundle', () => {
    execSync('npm run build:test', { stdio: 'pipe' })
    expect(readFileSync('dist/ui-selector.js', 'utf8')).not.toContain('__uiSelectorTest')
    expect(readFileSync('dist/ui-selector.test.js', 'utf8')).toContain('__uiSelectorTest')
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm run test -- build`
Expected: FAIL — `dist/bookmarklet.txt` does not exist.

- [ ] **Step 5: Implement the bundler with both modes**

```js
// build/bundle.mjs
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { installPage } from './install-template.mjs'

const TEST = process.argv.includes('--test')
const CONFIG = TEST
  ? 'selector.config.test.json'
  : existsSync('selector.config.json') ? 'selector.config.json' : 'selector.config.example.json'
const { trustedOrigins } = JSON.parse(readFileSync(CONFIG, 'utf8'))

const result = await build({
  entryPoints: ['src/boot.ts'],
  bundle: true, minify: !TEST, format: 'iife', target: 'chrome120',
  write: false, legalComments: 'none',
  define: {
    __TRUSTED_ORIGINS__: JSON.stringify(trustedOrigins),
    __EXPOSE_TEST_HOOK__: String(TEST),
  },
})
const code = result.outputFiles[0].text
mkdirSync('dist', { recursive: true })

if (TEST) {
  writeFileSync('dist/ui-selector.test.js', code)
  console.log(`test bundle: ${code.length} bytes; trusted: ${trustedOrigins.join(', ')}`)
} else {
  writeFileSync('dist/ui-selector.js', code)
  const url = 'javascript:' + encodeURIComponent(`(()=>{${code}})()`)
  writeFileSync('dist/bookmarklet.txt', url)
  writeFileSync('dist/install.html', installPage({ url, trustedOrigins, bytes: url.length }))
  console.log(`encoded bookmarklet: ${url.length} bytes; trusted: ${trustedOrigins.join(', ')}`)
}
```

`__EXPOSE_TEST_HOOK__` is a compile-time boolean, so `if (__EXPOSE_TEST_HOOK__) { ... }`
is dead-code-eliminated from the release bundle. The fourth build test above pins that.

- [ ] **Step 6: Zero-dependency test servers**

```js
// tests/server.mjs — usage: node tests/server.mjs <dir> <port> [host]
import { createServer } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'

const [dir, port, host = 'localhost'] = process.argv.slice(2)
const ROOT = resolve(dir)
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.json': 'application/json', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

createServer(async (req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname)
  } catch {
    res.writeHead(400).end('bad path')          // malformed percent-encoding
    return
  }
  try {
    const target = resolve(join(ROOT, normalize(pathname)))
    const s = await stat(target)
    const file = s.isDirectory() ? join(target, 'index.html') : target
    // realpath + relative, not startsWith: a lexical prefix check does not stop a
    // symlink pointing outside the fixture root.
    const real = await realpath(file)
    const rel = relative(await realpath(ROOT), real)
    if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end('forbidden'); return }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',            // lets :8082 serve CSS to :8081
    })
    res.end(await readFile(real))
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(Number(port), host)
```

Every identifier the handler uses is imported in the block above — a previous draft
listed the added imports in prose only, which would have made a literal implementation
throw `ReferenceError` on the first request and take the whole suite with it.

Note on the cross-origin test: `access-control-allow-origin: *` makes the stylesheet
*load*, but a stylesheet is only CORS-clean for `cssRules` access when requested with
`crossorigin`. `tests/fixtures/cross-origin.css` is linked **without** the
`crossorigin` attribute, so `sheet.cssRules` throws `SecurityError` exactly as a CDN
stylesheet does — offline, deterministically.

- [ ] **Step 7: Playwright config and global setup**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/global-setup.ts',      // build + stage ONLY; no fetch
  projects: [
    // Playwright does NOT guarantee webServer processes are listening before
    // globalSetup runs, so the fixture health check cannot live there — it would fail
    // with ECONNREFUSED on a fresh run. A setup project runs as a normal test, after
    // server readiness, and every other project depends on it.
    { name: 'fixtures-ready', testMatch: /fixtures-ready\.setup\.ts/ },
    { name: 'chromium', dependencies: ['fixtures-ready'] },
  ],
  webServer: [
    { command: 'node tests/server.mjs tests/fixtures/site 8080', port: 8080,
      reuseExistingServer: !process.env.CI },
    { command: 'node tests/server.mjs tests/fixtures 8081', port: 8081,
      reuseExistingServer: !process.env.CI },
    { command: 'node tests/server.mjs tests/fixtures 8082 127.0.0.1', port: 8082,
      reuseExistingServer: !process.env.CI },
  ],
  use: { baseURL: 'http://localhost:8080' },
})
```

`reuseExistingServer: true` everywhere is a false-pass generator: a stale process from
another checkout happily serves the wrong fixtures. It is disabled in CI, and
`global-setup.ts` additionally proves the *right* content is being served before any
test runs (next step).

```ts
// tests/global-setup.ts — build and stage only. No network calls here.
import { execSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'

export default function () {
  execSync('npm run build:test', { stdio: 'inherit' })
  // Staged inside the fixture root so a strict-CSP page can load it as a same-origin
  // script. Injection cannot be used there — see Task 7.
  copyFileSync('dist/ui-selector.test.js', 'tests/fixtures/ui-selector.test.js')
}
```

```ts
// tests/e2e/fixtures-ready.setup.ts — runs AFTER the web servers are listening,
// because it is an ordinary test in a setup project that every other project
// depends on. This is the part that must not live in globalSetup.
import { expect, test } from '@playwright/test'

const CASES: Array<[string, string]> = [
  ['http://localhost:8080/', 'data-testid'],
  ['http://localhost:8081/seeded-secrets.html', 'SEEDED-INPUT'],
  ['http://localhost:8081/ui-selector.test.js', '__uiSelectorTest'],
  ['http://127.0.0.1:8082/cross-origin.css', 'rebeccapurple'],
]

test('the servers serve OUR fixtures and OUR test bundle', async ({ request }) => {
  for (const [url, needle] of CASES) {
    const res = await request.get(url)
    expect(res.ok(), `${url} not served`).toBe(true)
    expect(await res.text(), `${url} lacks ${needle}`).toContain(needle)
  }
})
```

Without this gate a stale reused server silently produces false results; with it in
`globalSetup` the run would instead fail at setup on every fresh checkout. The setup
project is the only placement that is both ordered correctly and enforced.

Every e2e test therefore loads `dist/ui-selector.test.js`, never `dist/ui-selector.js`.
`.gitignore` also carries `tests/fixtures/ui-selector.test.js` — it is a build output
staged into a committed directory.

- [ ] **Step 8: Committed fixtures — the complete set**

Every fixture any later task references is created here. A missing fixture is a 404
that fails the test before it exercises anything, so the list is exhaustive and each
entry names the content the dependent test depends on.

| File | Served at | Load-bearing content |
|---|---|---|
| `site/index.html` | `:8080/` | Realistic page: `:root` token block, flex header, grid card list, buttons with `:hover`/`:focus-visible`/`:disabled`, `::before` icons, `@media (max-width:600px)`, an `<img>`, and ≥20 selectable elements for the Task 3 durability run. Some elements carry `data-testid`, some only classes, some nothing — the locator ladder needs all three. |
| `site-lite.html` | `:8082/site-lite.html` | Minimal page with one `<button class="b">` — the **unknown-origin** target for Task 8. Served from `127.0.0.1`, which the test trust config does not list. |
| `strict-csp.html` | `:8081/strict-csp.html` | CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; require-trusted-types-for 'script'`; `<script src="/ui-selector.test.js">` in its own markup; a `<button id="t">`. |
| `seeded-secrets.html` | `:8081/seeded-secrets.html` | One `<div id="card">` containing **all** seeds: `<input value="SEEDED-INPUT">`, `<textarea>SEEDED-AREA</textarea>`, `<div contenteditable="true">SEEDED-EDITABLE</div>`, `<div contenteditable="">SEEDED-EDITABLE-EMPTY</div>`, `<div contenteditable="plaintext-only">SEEDED-EDITABLE-PLAIN</div>`, `<script>const s='SEEDED-SCRIPT'</script>`, `<style>/* SEEDED-STYLE */</style>`, `<div hidden>SEEDED-HIDDEN</div>`, `<div style="display:none">SEEDED-NONE</div>`, `<template>SEEDED-TPL</template>`, `<a href="?token=SEEDED-QUERY">`, `<a href="javascript:alert('SEEDED-JS')">`, `<img src="data:image/svg+xml,SEEDED-DATA">`. Plus visible text `Card` so a correct capture is non-empty. |
| `states.html` | `:8081/states.html` | `.b` with `:hover`, `:focus-visible`, `:disabled` rules **and** a decoy `.other:hover` rule that must not be attributed to `.b`. |
| `responsive.html` | `:8081/responsive.html` | `.x` styled inside `@media (max-width:600px)`, plus a nested `@supports (display:grid)` inside that media block for the condition-stack test. |
| `pseudo.html` | `:8081/pseudo.html` | `.i::before { content:"→"; margin-right:4px; color:red }`. |
| `tokens.html` | `:8081/tokens.html` | `:root{--brand:#0a7}` and `.b{color:var(--brand)}`. |
| `tokens-override.html` | `:8081/tokens-override.html` | `:root{--brand:#0a7}`, `html body .deep{--brand:#111}` (high specificity, **far** ancestor), `.theme-dark{--brand:#fff}` (low specificity, **near** ancestor), and `.b` inside `.theme-dark` inside `.deep`. This fixture exists specifically to prove nearest-ancestor beats higher-specificity-farther-ancestor. |
| `specificity.html` | `:8081/specificity.html` | Two `<style>` blocks; `#id .btn` in one and `.btn` in the other, both matching one `<button class="btn" id="id">`; one declaration carries `!important`. |
| `cross-origin.html` | `:8081/cross-origin.html` | `<link rel="stylesheet" href="http://127.0.0.1:8082/cross-origin.css">` **without** `crossorigin`, plus a `<p>`. |
| `cross-origin.css` | `:8082/cross-origin.css` | `p { color: rebeccapurple }`. |
| `fonts.html` | `:8081/fonts.html` | Two paragraphs: `p.absent { font-family:'NotInstalled Sans', monospace }` and `p.web { font-family: 'TestWeb', serif }` with an `@font-face` for `TestWeb` pointing at a **local** same-origin file, so `webfontStatus` has both a `not-a-webfont` and a `loaded` case. |
| `shot.html` | `:8081/shot.html` | See Task 9 Step 1. |
| `shadow.html` | `:8081/shadow.html` | A host element with an **open** shadow root containing a styled button, and a sibling host with a **closed** root — for the Task 2 shadow-boundary omission test. |

`tests/fixtures/site/index.html` is deterministic and offline, replacing the earlier
dependency on a copy of `skill-shelf/dist` that CI could never have had.

- [ ] **Step 9: Minimal `src/boot.ts` and the config files**

```ts
// src/boot.ts
declare const __TRUSTED_ORIGINS__: string[]
declare const __EXPOSE_TEST_HOOK__: boolean

const GUARD = '__uiSelectorActive__'
type W = Window & { [GUARD]?: boolean; __uiSelectorTest?: unknown }

function main(): void {
  const w = window as W
  if (w[GUARD]) return
  w[GUARD] = true
  if (__EXPOSE_TEST_HOOK__) {
    w.__uiSelectorTest = {}          // later tasks add their functions here
  }
  console.info('ui-selector: trusted origins =', __TRUSTED_ORIGINS__)
}
main()
```

```json
// selector.config.example.json  (committed)
{ "trustedOrigins": ["http://localhost", "http://127.0.0.1"] }
```

```json
// selector.config.test.json  (committed — deliberately narrow)
{ "trustedOrigins": ["http://localhost"] }
```

The test config trusts `localhost` only, so `http://127.0.0.1:8082` is a genuinely
**unknown** origin for the Task 8 trust tests — offline, with no `example.com`.

`.gitignore`: `node_modules/`, `dist/`, `selector.config.json`, `spikes/out/`,
`test-results/`, `playwright-report/`, `tests/fixtures/ui-selector.test.js`.
**Everything else under `tests/fixtures/` is committed.**

- [ ] **Step 10: Run everything, then install and click**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: PASS. Then open `dist/install.html`, drag the link to the bookmarks bar,
click it on a localhost page, and confirm the console line appears.

- [ ] **Step 11: Commit** (only with user authorization)

```bash
git add -A && git commit -m "feat: build pipeline, offline test harness, self-contained bookmarklet"
```

### Task 2: Types, allowlists, sanitizers — and the redaction suite

The privacy invariant goes in first, so every later task inherits it. Two of the
sanitizers are the whole ballgame: `visibleText` must not leak descendant user data,
and `reducedUrl` must not launder a payload through an allowlisted attribute.

**Files:**
- Create: `src/types.ts`, `src/allowlists.ts`, `src/sanitize.ts`
- Test: `tests/unit/sanitize.test.ts`, `tests/e2e/text-boundaries.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CaptureMode = 'standard' | 'deep'`
  - `type TrustLevel = 'trusted' | 'restricted'`
  - ```ts
    // The SINGLE source of truth. Every reason emitted anywhere in src/ must appear
    // here, and the tables in spec §6.5 and docs/data-contract.md are transcribed
    // from it — not maintained in parallel.
    export type OmissionReason =
      | 'restricted-mode'
      | 'cross-origin-stylesheet'
      | 'clipped-screenshot'
      | 'unsupported-browser'
      | 'budget-exceeded'
      | 'user-declined'
      | 'blocked-scheme'
      | 'unsupported-selector'
      | 'unsupported-at-rule'
      | 'shadow-boundary'
      | 'indeterminate-definition'
    ```
  - `interface Omission { field: string; reason: OmissionReason; detail?: string }`
  - `interface CaptureContext { mode: CaptureMode; trust: TrustLevel; omit(field: string, reason: OmissionReason, detail?: string): void; omissions: Omission[] }`
  - `reducedUrl(raw: string, base: string): string` — **http/https only**, origin + pathname
  - `visibleText(el: Element, trust: TrustLevel, ctx: CaptureContext): string | null`
  - `pickAttributes(el: Element, ctx: CaptureContext): Record<string, string>`
  - `makeContext(mode: CaptureMode = 'standard', trust: TrustLevel = 'trusted'): CaptureContext`
    — the only way a context is constructed, in production and in tests
  - `STYLE_PROPERTIES`, `TEXT_FORBIDDEN_TAGS`,
    `CAPS = { ancestryDepth: 5, textTrusted: 200, textRestricted: 80, textNodeVisits: 500, deepNodes: 200, deepChars: 20_000, deepAssets: 20 }`
  - The attribute tables, enumerated in full — an implementation that adds a
    URL-bearing attribute without routing it through `reducedUrl` is exactly the leak
    the scheme guard was written to stop, so the lists are closed, not illustrative:

    ```ts
    export const ATTRIBUTE_ALLOWLIST = [
      'class', 'id', 'role', 'type', 'alt', 'title', 'placeholder', 'lang', 'dir',
      'href', 'src',                      // the only two URL-bearing entries
      'width', 'height', 'loading', 'decoding',
    ] as const
    export const REDUCED_URL_ATTRIBUTES = ['href', 'src'] as const
    ```

    Deliberately **excluded**, each for a reason: `value`, `checked`, `selected`
    (user data); `name` (a form-field identifier, not a design fact); `action`,
    `formaction`, `ping`, `target` (form/navigation behaviour, and more URL surface for
    no design benefit); `srcset`, `poster`, `background`, `data`, `longdesc`,
    `cite` (URL-bearing and not needed in Standard — `poster` and `background-image`
    reappear only inside Deep's asset collector, which reduces them); anything
    `password`-related; every `on*` handler; every `data-*` except `data-testid`
    (application state hides there).

- [ ] **Step 1: Write the failing sanitizer tests**

```ts
// tests/unit/sanitize.test.ts
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'
import { pickAttributes, reducedUrl, visibleText } from '../../src/sanitize'
import { makeContext } from '../../src/types'

const BASE = 'https://x.dev/p/'

describe('reducedUrl', () => {
  it('keeps origin and pathname only', () => {
    expect(reducedUrl('https://x.dev/a/b?token=SECRET#frag', BASE)).toBe('https://x.dev/a/b')
  })
  it('drops credentials embedded in the URL', () => {
    expect(reducedUrl('https://u:p@x.dev/a', BASE)).toBe('https://x.dev/a')
  })
  it('resolves a relative URL against the supplied base, not a global', () => {
    expect(reducedUrl('./c?x=SECRET', BASE)).toBe('https://x.dev/p/c')
  })
  it('rejects javascript: instead of laundering its payload', () => {
    expect(reducedUrl('javascript:alert("SECRET")', BASE)).toBe('')
  })
  it('rejects data: URLs', () => {
    expect(reducedUrl('data:text/html,<b>SECRET</b>', BASE)).toBe('')
  })
  it('rejects mailto: and every other non-http scheme', () => {
    expect(reducedUrl('mailto:SECRET@x.dev', BASE)).toBe('')
    expect(reducedUrl('blob:https://x.dev/SECRET', BASE)).toBe('')
    expect(reducedUrl('file:///Users/SECRET', BASE)).toBe('')
  })
  it('returns an empty string for unparseable input rather than echoing it', () => {
    expect(reducedUrl('not a url ?token=SECRET', BASE)).toBe('')
  })
})

describe('visibleText', () => {
  let doc: Document
  const dom = (html: string) => {
    const w = new JSDOM(html).window
    globalThis.document = w.document
    globalThis.getComputedStyle = w.getComputedStyle.bind(w)
    globalThis.Node = w.Node
    globalThis.NodeFilter = w.NodeFilter
    return w.document
  }
  beforeEach(() => { doc = dom('<div id="card">ok</div>') })

  it('normalizes whitespace on a simple element', () => {
    doc = dom('<button id="b">  Submit   order </button>')
    expect(visibleText(doc.getElementById('b')!, 'trusted', makeContext())).toBe('Submit order')
  })

  it('returns null for the form controls themselves', () => {
    doc = dom('<input id="i" value="SECRET"><textarea id="t">SECRET</textarea>')
    expect(visibleText(doc.getElementById('i')!, 'trusted', makeContext())).toBeNull()
    expect(visibleText(doc.getElementById('t')!, 'trusted', makeContext())).toBeNull()
  })

  // The container cases are the ones a naive textContent implementation fails.
  it('excludes a DESCENDANT textarea value from a container capture', () => {
    doc = dom('<div id="c">Label <textarea>SECRET-AREA</textarea></div>')
    const t = visibleText(doc.getElementById('c')!, 'trusted', makeContext())!
    expect(t).toBe('Label')
    expect(t).not.toContain('SECRET')
  })

  it('excludes a descendant contenteditable subtree', () => {
    doc = dom('<div id="c">Note <div contenteditable="true">SECRET-EDITABLE</div></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Note')
  })

  it('excludes script and style source text', () => {
    doc = dom(`<div id="c">Hi<script>const s='SECRET-SCRIPT'</script><style>/* SECRET-STYLE */</style></div>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Hi')
  })

  it('excludes hidden and display:none subtrees', () => {
    doc = dom('<div id="c">Shown<span hidden>SECRET-HIDDEN</span><span style="display:none">SECRET-NONE</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Shown')
  })

  it('excludes template and noscript content', () => {
    doc = dom('<div id="c">A<template>SECRET-TPL</template><noscript>SECRET-NS</noscript></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('A')
  })

  it('counts the cap across the whole walk, not per node', () => {
    doc = dom(`<div id="c">${'<span>abcdefghij</span>'.repeat(40)}</div>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())!.length).toBe(200)
    expect(visibleText(doc.getElementById('c')!, 'restricted', makeContext())!.length).toBe(80)
  })

  it('records budget-exceeded when the node-visit cap is hit', () => {
    doc = dom(`<div id="c">${'<span>x</span>'.repeat(600)}</div>`)
    const ctx = makeContext()
    visibleText(doc.getElementById('c')!, 'trusted', ctx)
    expect(ctx.omissions.some(o => o.reason === 'budget-exceeded')).toBe(true)
  })

  // The ROOT cases. A TreeWalker never applies its filter to its own root, so each of
  // these leaks unless the root is checked separately.
  it('returns null when the selected root itself is hidden', () => {
    doc = dom('<div id="c" hidden>SECRET-HIDDEN</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('returns null when the selected root itself is display:none', () => {
    doc = dom('<div id="c" style="display:none">SECRET-NONE</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('returns null for every editable variant, as root and as descendant', () => {
    for (const attr of ['contenteditable="true"', 'contenteditable=""', 'contenteditable="plaintext-only"']) {
      doc = dom(`<div id="c" ${attr}>SECRET-EDITABLE</div>`)
      expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
      doc = dom(`<div id="p">Label <div ${attr}>SECRET-EDITABLE</div></div>`)
      expect(visibleText(doc.getElementById('p')!, 'trusted', makeContext())).toBe('Label')
    }
  })
  it('still captures text when contenteditable is explicitly false', () => {
    doc = dom('<div id="c" contenteditable="false">Visible</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Visible')
  })
  it('returns the whole string when it lands exactly on the cap', () => {
    doc = dom(`<p id="c">${'a'.repeat(200)}</p>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())!.length).toBe(200)
  })

  // The ANCESTOR cases. getComputedStyle(child) inside display:none reports the
  // child's own display, so a child of a hidden ancestor is only caught by walking up.
  it('refuses a descendant of a display:none ancestor', () => {
    doc = dom('<div style="display:none"><span id="c">SECRET-ANCESTOR</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('refuses a descendant of a [hidden] ancestor', () => {
    doc = dom('<div hidden><span id="c">SECRET-ANCESTOR</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('refuses visibility:collapse as well as hidden', () => {
    doc = dom('<span id="c" style="visibility:collapse">SECRET-COLLAPSE</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('still captures opacity:0 text, which is a design state and not suppression', () => {
    doc = dom('<span id="c" style="opacity:0">Fading in</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Fading in')
  })
  it('still captures aria-hidden text, by explicit policy', () => {
    doc = dom('<span id="c" aria-hidden="true">Decorative</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Decorative')
  })
})

describe('pickAttributes', () => {
  const dom = (html: string) => {
    const w = new JSDOM(html, { url: BASE }).window
    globalThis.document = w.document
    return w.document
  }

  it('allowlists design attributes and drops value-bearing ones', () => {
    const el = dom(`<input class="c" data-testid="t" aria-label="a" value="SECRET"
      checked placeholder="Email" name="email" type="email">`).querySelector('input')!
    const out = pickAttributes(el, makeContext())
    expect(out).toMatchObject({ class: 'c', 'data-testid': 't', 'aria-label': 'a',
                                placeholder: 'Email', type: 'email' })
    expect(out).not.toHaveProperty('value')
    expect(out).not.toHaveProperty('checked')
    expect(out).not.toHaveProperty('name')
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })

  it('reduces href and src to origin plus pathname', () => {
    const a = dom('<a href="https://x.dev/p?s=SECRET">l</a>').querySelector('a')!
    expect(pickAttributes(a, makeContext()).href).toBe('https://x.dev/p')
  })

  it('drops a javascript: href entirely and records the reason', () => {
    const a = dom(`<a href="javascript:alert('SECRET')">l</a>`).querySelector('a')!
    const ctx = makeContext()
    const out = pickAttributes(a, ctx)
    expect(out).not.toHaveProperty('href')
    expect(ctx.omissions.some(o => o.reason === 'blocked-scheme')).toBe(true)
  })

  it('drops a data: src rather than embedding the payload', () => {
    const img = dom('<img src="data:image/svg+xml,SECRET" alt="a">').querySelector('img')!
    const out = pickAttributes(img, makeContext())
    expect(out).not.toHaveProperty('src')
    expect(out.alt).toBe('a')
  })

  // Every allowed URL-bearing attribute against every hostile scheme. This matrix is
  // what fails if someone widens REDUCED_URL_ATTRIBUTES without thinking it through.
  it.each(['href', 'src'])('reduces or drops %s for every scheme', attr => {
    const cases: Array<[string, string | undefined]> = [
      ['https://x.dev/p?s=SECRET', 'https://x.dev/p'],
      ['//x.dev/p?s=SECRET', 'https://x.dev/p'],           // protocol-relative
      ['./rel?s=SECRET', 'https://x.dev/p/rel'],
      ['javascript:alert("SECRET")', undefined],
      ['data:text/html,SECRET', undefined],
      ['mailto:SECRET@x.dev', undefined],
      ['blob:https://x.dev/SECRET', undefined],
      ['file:///SECRET', undefined],
    ]
    for (const [input, want] of cases) {
      const el = dom(`<a ${attr}="${input}">l</a>`).querySelector('a')!
      const out = pickAttributes(el, makeContext())
      expect(out[attr]).toBe(want)
      expect(JSON.stringify(out)).not.toContain('SECRET')
    }
  })

  it('never emits an excluded URL-bearing attribute at all', () => {
    const f = dom(`<form action="javascript:x" ping="https://x.dev/SECRET"></form>`).querySelector('form')!
    const out = pickAttributes(f, makeContext())
    expect(out).not.toHaveProperty('action')
    expect(out).not.toHaveProperty('ping')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- sanitize`
Expected: FAIL — cannot resolve `../../src/sanitize`.

- [ ] **Step 3: Implement `reducedUrl` with a scheme allowlist**

```ts
// src/sanitize.ts
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export function reducedUrl(raw: string, base: string): string {
  let u: URL
  try {
    u = new URL(raw, base)
  } catch {
    return ''
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return ''     // javascript:, data:, blob:, mailto:, file:
  return `${u.origin}${u.pathname}`
}
```

Callers pass `document.baseURI` as `base`. Nothing reads a global `location`, which is
what made the old unit test environment-dependent.

- [ ] **Step 4: Implement `visibleText` as a bounded text-node walk**

`textContent` is unusable here: on a container it concatenates descendant `<textarea>`
values, `<script>` and `<style>` source, hidden nodes, and nested `contenteditable`
text. Walk text nodes instead and refuse to enter a forbidden subtree.

```ts
const TEXT_FORBIDDEN_TAGS = new Set([
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP',
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS',
])
// BUTTON is deliberately absent: a button's own label is a design fact we want.

function isEditable(el: Element): boolean {
  // `contenteditable=""` and `contenteditable="plaintext-only"` are BOTH editable.
  // Only `false` turns it off, and it inherits — so use the property, not the string.
  return (el as HTMLElement).isContentEditable === true ||
    (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
}

// Visual suppression must be judged against the ANCESTOR CHAIN, not the element
// alone: `getComputedStyle(child).display` inside a `display:none` parent returns the
// child's own specified display, not `none`. Selecting such a child directly would
// therefore have leaked its text.
function isVisuallySuppressed(el: Element): boolean {
  if ((el as HTMLElement).checkVisibility) {
    // Handles display:none anywhere above, visibility hidden/collapse, and
    // content-visibility. opacity is deliberately NOT treated as suppression: opacity:0
    // text is still in the layout and is often a real design state.
    if (!(el as HTMLElement).checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return true
  }
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return true
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true
  }
  return false
}

function isForbiddenSubtree(el: Element): boolean {
  if (TEXT_FORBIDDEN_TAGS.has(el.tagName)) return true
  if (isEditable(el)) return true
  return isVisuallySuppressed(el)
}

export function visibleText(el: Element, trust: TrustLevel, ctx: CaptureContext): string | null {
  // The walker never applies its filter to its own root, so the root is checked here
  // with the SAME predicate. Without this, selecting a `[hidden]` or `display:none`
  // container — or an editable one — emits exactly the text the filter exists to hide.
  if (isForbiddenSubtree(el)) return null
  noteShadowBoundary(el, ctx)
  const cap = trust === 'trusted' ? CAPS.textTrusted : CAPS.textRestricted
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return isForbiddenSubtree(node as Element)
          ? NodeFilter.FILTER_REJECT              // REJECT skips the whole subtree
          : NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const parts: string[] = []
  let chars = 0, visits = 0
  while (walker.nextNode()) {
    if (++visits > CAPS.textNodeVisits) { ctx.omit('element.text', 'budget-exceeded', 'node visits'); break }
    const raw = walker.currentNode.nodeValue ?? ''
    const room = cap - chars - (parts.length ? 1 : 0)
    if (room <= 0) { ctx.omit('element.text', 'budget-exceeded', 'character cap'); break }
    // Slice before normalizing so one multi-megabyte text node is never materialized in
    // full — but with headroom, because collapsing runs of whitespace shrinks the
    // string. Without headroom, "   " + 500 chars returns fewer than `room` characters.
    // Exact character utilization is explicitly NOT part of the contract; staying at or
    // under the cap is.
    const t = raw.slice(0, room * 4 + 8).replace(/\s+/g, ' ').trim().slice(0, room)
    if (!t) continue
    parts.push(t)
    chars += t.length + (parts.length > 1 ? 1 : 0)
  }
  return parts.join(' ')
}
```

The budget arithmetic charges for the joining space only when one will actually be
inserted, so text landing exactly on `cap` is returned whole rather than one character
short.

`FILTER_REJECT` (not `FILTER_SKIP`) on the element branch is the load-bearing detail:
it prunes the entire subtree, which is what keeps a descendant `<textarea>` value out.

**Shadow-boundary detection, and the limit of it.** A `TreeWalker` does not cross a
shadow root in either direction, so silence there must be reported rather than
inferred:

```ts
export function noteShadowBoundary(el: Element, ctx: CaptureContext): void {
  if (el.shadowRoot) ctx.omit('element.text', 'shadow-boundary', 'open shadow root not traversed')
  const root = el.getRootNode()
  if (root instanceof ShadowRoot) {
    ctx.omit('element.text', 'shadow-boundary', `element lives inside a ${root.mode} shadow tree`)
  }
  if ((el as HTMLElement).assignedSlot) {
    ctx.omit('element.text', 'shadow-boundary', 'slotted content; light and shadow trees differ')
  }
}
```

The honest limit, stated in spec §6.1 rather than glossed over: a host whose shadow
root is **closed** is not detectable after the fact — `el.shadowRoot` is `null` for it
and there is no other accessor. Instrumenting `attachShadow` would not help, because a
bookmarklet runs long after the page has built its trees. So the guarantee is narrowed
to what is actually checkable: open hosts, elements inside any shadow tree, and slotted
content are all reported; a closed host is indistinguishable from an element with no
shadow root at all.

**`aria-hidden` is deliberately not treated as suppression.** It is an accessibility
hint, not a visual one — `aria-hidden` content is frequently on screen (decorative
icons, duplicated labels) and is legitimate design content. Excluding it would lose
real fidelity, so the policy is explicit rather than implicit.

- [ ] **Step 5: Implement `pickAttributes`**

```ts
export function pickAttributes(el: Element, ctx: CaptureContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name
    if (!(ATTRIBUTE_ALLOWLIST.includes(name) || name.startsWith('aria-') || name === 'data-testid')) continue
    if (REDUCED_URL_ATTRIBUTES.includes(name)) {
      const reduced = reducedUrl(attr.value, document.baseURI)
      if (!reduced) { ctx.omit(`attributes.${name}`, 'blocked-scheme'); continue }
      out[name] = reduced
    } else {
      out[name] = attr.value
    }
  }
  return out
}
```

`ATTRIBUTE_ALLOWLIST` explicitly excludes `value`, `checked`, `selected`, `name`, and
anything `password`-related. Note `name` is excluded deliberately: it is a form-field
identifier, not a design fact.

- [ ] **Step 6: Run and confirm pass**

Run: `npm run test -- sanitize` → PASS. Then `npm run lint && npm run typecheck`.

- [ ] **Step 7: Browser-level boundary test on the seeded fixture**

```ts
// tests/e2e/text-boundaries.spec.ts
import { expect, test } from '@playwright/test'

test('capturing the whole seeded card leaks nothing', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx()
    return { text: window.__uiSelectorTest.visibleText(document.getElementById('card')!, 'trusted', ctx) }
  })
  expect(out.text).not.toMatch(/SEEDED-/)
  expect(out.text).toContain('Card')            // and it is not vacuously empty
})

test('every element inside the seeded card is individually safe as a root', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const leaks = await page.evaluate(() =>
    [...document.querySelectorAll('#card *')]
      .map(el => window.__uiSelectorTest.visibleText(el, 'trusted', window.__uiSelectorTest.ctx()))
      .filter(t => t && /SEEDED-/.test(t)))
  expect(leaks).toEqual([])
})

test('every reachable shadow relationship records a shadow-boundary omission', async ({ page }) => {
  await page.goto('http://localhost:8081/shadow.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(() => {
    const probe = (get: () => Element | null | undefined) => {
      const ctx = window.__uiSelectorTest.ctx()
      const el = get()
      if (!el) return null
      window.__uiSelectorTest.visibleText(el, 'trusted', ctx)
      return ctx.omissions.some(o => o.reason === 'shadow-boundary')
    }
    const openHost = document.getElementById('open-host')!
    return {
      host: probe(() => openHost),
      inside: probe(() => openHost.shadowRoot!.querySelector('button')),
      slotted: probe(() => document.getElementById('slotted-child')),
      closedHost: probe(() => document.getElementById('closed-host')),
      plain: probe(() => document.getElementById('plain')),
    }
  })
  expect(out.host).toBe(true)
  expect(out.inside).toBe(true)         // element INSIDE a shadow tree, not just the host
  expect(out.slotted).toBe(true)        // slotted content: light and shadow trees differ
  expect(out.plain).toBe(false)         // and no false positives on ordinary elements
  // A CLOSED host is not detectable after the fact. This asserts the documented limit
  // rather than pretending otherwise — see spec §6.1.
  expect(out.closedHost).toBe(false)
})
```

The second test is the one that matters most: it selects **every** descendant of the
seeded card in turn, so a leak is caught whichever element a user happens to click —
not only for the one container the first test picks.

This runs in a real engine, where `getComputedStyle` reflects the cascade rather than
jsdom's approximation — the unit tests pin the logic, this pins the reality.

- [ ] **Step 8: Commit** (with authorization)

```bash
git add -A && git commit -m "feat: deny-by-default allowlists, scheme guard, bounded text walk"
```

### Task 3: Locator ladder with self-verification

**Files:**
- Create: `src/locate.ts`
- Test: `tests/unit/locate.test.ts`, `tests/e2e/locate.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `locate(el: Element): Locator` where
  `interface Locator { selector: string; strategy: 'testid' | 'id' | 'aria' | 'structural'; confidence: 'exact' | 'ambiguous' | 'unverified'; matchCount: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/locate.test.ts
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { locate } from '../../src/locate'

const dom = (html: string) => {
  const w = new JSDOM(html).window
  globalThis.document = w.document
  globalThis.CSS = w.CSS
  return w.document
}

describe('locate', () => {
  it('prefers data-testid and reports an exact match', () => {
    const d = dom('<div><button data-testid="save">S</button></div>')
    expect(locate(d.querySelector('button')!)).toEqual({
      selector: '[data-testid="save"]', strategy: 'testid', confidence: 'exact', matchCount: 1,
    })
  })

  it('falls back to id, escaping CSS-unsafe characters', () => {
    const d = dom('<button id="a.b">S</button>')
    const r = locate(d.querySelector('button')!)
    expect(r.strategy).toBe('id')
    expect(d.querySelectorAll(r.selector)).toHaveLength(1)
  })

  it('uses aria-label plus role when no testid or id exists', () => {
    const d = dom('<button aria-label="Close dialog">x</button>')
    expect(locate(d.querySelector('button')!).strategy).toBe('aria')
  })

  it('marks a duplicated attribute selector ambiguous instead of claiming exact', () => {
    const d = dom('<button data-testid="dup">a</button><button data-testid="dup">b</button>')
    const r = locate(d.querySelectorAll('button')[1]!)
    expect(r.confidence).toBe('ambiguous')
    expect(r.matchCount).toBe(2)
  })

  it('builds a structural path that resolves to exactly the target', () => {
    const d = dom('<main><section><p>a</p><p>b</p></section></main>')
    const target = d.querySelectorAll('p')[1]!
    const r = locate(target)
    expect(r.strategy).toBe('structural')
    expect(d.querySelectorAll(r.selector)).toHaveLength(1)
    expect(d.querySelector(r.selector)).toBe(target)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- locate` → FAIL, module not found.

- [ ] **Step 3: Implement the ladder plus verification**

Ladder order: `data-testid` → `id` → `aria-label` (+ tag) → structural
`nth-child` path from the nearest ancestor bearing a stable attribute, else from
`body`. Every candidate is verified by re-querying:

```ts
// src/locate.ts
import type { Locator } from './types'

function verify(selector: string, el: Element): Pick<Locator, 'confidence' | 'matchCount'> {
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(selector)
  } catch {
    return { confidence: 'unverified', matchCount: 0 }
  }
  if (matches.length === 1 && matches[0] === el) return { confidence: 'exact', matchCount: 1 }
  return { confidence: 'ambiguous', matchCount: matches.length }
}
```

`locate` walks the ladder, returns the first candidate whose `confidence` is
`exact`, and otherwise returns the structural candidate with whatever confidence
verification produced. **It never reports `exact` without a verified single match** —
that is the invariant Spike 3 tests.

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test -- locate` → PASS.

- [ ] **Step 5: Add the durability e2e test**

```ts
// tests/e2e/locate.spec.ts
import { expect, test } from '@playwright/test'

test('locators survive a reload on a real-world page', async ({ page }) => {
  await page.goto('http://localhost:8080/')          // committed realistic fixture
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const results = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, h1, h2, p, img, li, section')].slice(0, 20)
    return els.map(el => ({ selector: window.__uiSelectorTest.locate(el).selector, tag: el.tagName }))
  })
  await page.reload()
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const survived = await page.evaluate(rs =>
    rs.filter(r => document.querySelectorAll(r.selector).length === 1 &&
      document.querySelector(r.selector)!.tagName === r.tag).length, results)
  expect(survived).toBeGreaterThanOrEqual(18)
})
```

`window.__uiSelectorTest` exists only in `dist/ui-selector.test.js`, built by
`npm run build:test` from Task 1 and produced automatically by the Playwright global
setup. Task 1's fourth build test asserts the hook is absent from the release bundle.

- [ ] **Step 6: Commit** (with authorization)

---

### Task 4: Capture environment and layout context

**Files:**
- Create: `src/capture/env.ts`, `src/capture/layout.ts`
- Test: `tests/unit/env.test.ts`, `tests/e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `CaptureContext`, `CAPS` (Task 2).
- Produces:
  - `captureEnv(): EnvContext` where `interface EnvContext { viewport: { width: number; height: number }; devicePixelRatio: number; prefersColorScheme: 'light' | 'dark' | 'no-preference'; colorScheme: string; themeAttributes: Record<string, string> }`
  - `captureLayout(el: Element, ctx: CaptureContext): LayoutContext` where
    `interface LayoutContext { rect: Rect; boxModel: { content: Rect; padding: Box; border: Box; margin: Box }; scroll: { pageX: number; pageY: number; elementScrollTop: number; elementScrollLeft: number; scrollParentSelector: string | null }; parent: { display: string; flexFlow?: string; gridTemplate?: string; gap?: string }; item: { flex?: string; gridArea?: string; alignSelf?: string; order?: string }; stacking: Array<{ selector: string; position: string; zIndex: string }>; nearestStackingContextSelector: string | null; ancestry: Array<{ tagName: string; role: string | null; display: string }> }`

  `scroll` is required by spec §6.1 and was missing from the earlier draft: without it
  a viewport-relative `rect` cannot be reproduced.

- [ ] **Step 1: Write the failing env test**

```ts
// tests/unit/env.test.ts
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { captureEnv } from '../../src/capture/env'

it('records viewport, DPR, and the theme attributes on <html>', () => {
  const w = new JSDOM('<html data-theme="dark" class="dark"><body></body></html>', {
    pretendToBeVisual: true,
  }).window
  Object.defineProperty(w, 'devicePixelRatio', { value: 2 })
  w.matchMedia = vi.fn().mockImplementation(q => ({ matches: q.includes('dark'), media: q })) as never
  globalThis.window = w as never
  globalThis.document = w.document
  const env = captureEnv()
  expect(env.devicePixelRatio).toBe(2)
  expect(env.prefersColorScheme).toBe('dark')
  expect(env.themeAttributes).toMatchObject({ 'data-theme': 'dark', class: 'dark' })
})
```

- [ ] **Step 2: Run, confirm failure, implement `env.ts`**

`captureEnv` reads `innerWidth`/`innerHeight`, `devicePixelRatio`,
`matchMedia('(prefers-color-scheme: dark)')`, the computed `color-scheme` on
`documentElement`, and the `class` plus every `data-*` attribute on `<html>`.

- [ ] **Step 3: Run and confirm pass**

Run: `npm run test -- env` → PASS.

- [ ] **Step 4: Implement `layout.ts` and its e2e test**

```ts
// tests/e2e/layout.spec.ts
import { expect, test } from '@playwright/test'

test('captures parent container and item properties for a grid child', async ({ page }) => {
  await page.setContent(`<div style="display:grid;grid-template-columns:1fr 2fr;gap:12px">
    <span id="a" style="grid-area:1/2;align-self:end">x</span></div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.parent.display).toBe('grid')
  expect(layout.parent.gap).toBe('12px')
  expect(layout.item.gridArea).toContain('2')
  expect(layout.item.alignSelf).toBe('end')
  // This fixture has no positioned or z-indexed ancestor, so an EMPTY stack is the
  // correct result. The earlier draft asserted length > 0 here, which would have
  // forced an implementation to invent an entry the DOM does not justify.
  expect(layout.stacking).toEqual([])
  expect(layout.nearestStackingContextSelector).toBeNull()
})
```

The chain walks ancestors collecting any with `position !== 'static'` or a non-`auto`
`z-index`, and stops at the element's **nearest ancestor stacking context** — the
first ancestor with a non-`none` `transform`, `filter`, `perspective`,
`contain: paint`, or `will-change`, or a positioned ancestor with a numeric
`z-index` — reported as `nearestStackingContextSelector`, or `null` when the walk
reaches `documentElement` without finding one.

This is deliberately **not** called a containing block, and the earlier draft's name
was wrong. The containing block of a statically positioned element is its nearest
block-container ancestor, which is generally not the transform ancestor; for
`position: absolute` it is the nearest positioned ancestor, and for `fixed` it is the
viewport unless a transform intervenes. Three different rules, none of which is what a
design brief needs. What a design brief needs is "what paints above what", which is
the stacking context — so that is what is captured, under its correct name. Spec §6.1
was amended to match.

Ancestry is capped at `CAPS.ancestryDepth`; exceeding it records a `budget-exceeded`
omission.

Add to the e2e file:

```ts
test('stops the walk at the nearest ancestor stacking context', async ({ page }) => {
  await page.setContent(`<div id="outer" style="position:relative;z-index:9">
    <div id="sc" style="transform:translateZ(0)">
      <div style="position:relative;z-index:5"><span id="a">x</span></div></div></div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.nearestStackingContextSelector).toContain('sc')
  // #outer is beyond the boundary and must NOT appear.
  expect(layout.stacking.some(s => s.selector.includes('outer'))).toBe(false)
})

test('records scroll offsets so a viewport-relative rect is reproducible', async ({ page }) => {
  await page.setContent(`<div style="height:3000px"></div><span id="a">x</span>`)
  await page.evaluate(() => window.scrollTo(0, 500))
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const layout = await page.evaluate(() =>
    window.__uiSelectorTest.captureLayout(document.getElementById('a')!, window.__uiSelectorTest.ctx()))
  expect(layout.scroll.pageY).toBe(500)
})
```

- [ ] **Step 5: Run both suites, then commit** (with authorization)

---

### Task 5: Matched rules, pseudo-elements, interaction states, media conditions

**Moved ahead of the computed-style task.** Custom-property definition sites and
declared values can only be resolved from matched rules, so the matcher must exist
first. This removes the two-step the earlier draft admitted to.

**Files:**
- Create: `src/capture/rules.ts`, `src/capture/pseudo.ts`, `src/capture/selector.ts`
- Test: `tests/unit/selector.test.ts`, `tests/e2e/rules.spec.ts`

**Interfaces:**
- Consumes: `STYLE_PROPERTIES`, `CaptureContext`.
- Produces:
  - `splitSelectorList(text: string): string[]` — depth-aware, respects `()`, `[]`, quotes
  - `specificity(selector: string): [number, number, number]`
  - `matchedRules(el: Element, ctx: CaptureContext): MatchedRules` where
    `interface MatchedRules { applied: Array<{ selector: string; sheet: string; conditions: string[]; specificity: [number, number, number]; declarations: Record<string, string>; important: string[] }>; states: Array<{ state: 'hover' | 'focus-visible' | 'active' | 'disabled'; selector: string; declarations: Record<string, string> }>; mediaConditions: string[]; customProperties: Array<{ name: string; value: string; selector: string; specificity: [number, number, number]; ancestorDepth: number; important: boolean; sheetIndex: number; ruleIndex: number }> }`

  `conditions` is a **stack**, not a single string: a rule inside
  `@media (max-width:600px) { @supports (display:grid) { … } }` carries both, in
  order. The earlier draft threaded one mutable string, so entering a nested block
  overwrote its parent's condition and the output could claim a rule was
  unconditional.

  `ancestorDepth` is 0 for the element itself and increases toward the root. It exists
  because the cascade for an inherited custom property is **nearest-ancestor-first**:
  a low-specificity `--brand` on the immediate parent beats a high-specificity one on
  `html`. Without owner depth, `customProperties` cannot express that, and the
  definition site reported would be wrong on any real themed page.
  - `capturePseudo(el: Element): { before?: PseudoBundle; after?: PseudoBundle }` where
    `interface PseudoBundle { content: string; computed: Record<string, string> }`

- [ ] **Step 1: Write the failing selector-parser tests**

A naive `selectorText.split(',')` breaks real CSS. These cases are the reason the
splitter is its own module with its own unit tests.

```ts
// tests/unit/selector.test.ts
import { describe, expect, it } from 'vitest'
import { splitSelectorList, specificity, stripStatePseudo } from '../../src/capture/selector'

describe('splitSelectorList', () => {
  it('splits a plain selector list', () => {
    expect(splitSelectorList('.a, .b , .c')).toEqual(['.a', '.b', '.c'])
  })
  it('does not split inside :is() / :not() / :where()', () => {
    expect(splitSelectorList(':is(.a, .b) .c, .d')).toEqual([':is(.a, .b) .c', '.d'])
  })
  it('does not split inside an attribute value', () => {
    expect(splitSelectorList('[data-x="a,b"], .c')).toEqual(['[data-x="a,b"]', '.c'])
  })
  it('does not split inside a quoted string containing a bracket', () => {
    expect(splitSelectorList(`[title="a],b"], .c`)).toEqual([`[title="a],b"]`, '.c'])
  })
  it('handles nested parens', () => {
    expect(splitSelectorList(':not(:is(.a, .b)), .c')).toEqual([':not(:is(.a, .b))', '.c'])
  })
})

describe('specificity', () => {
  it('counts ids, classes, and types', () => {
    expect(specificity('#a .b .c div')).toEqual([1, 2, 1])
  })
  it('counts attribute selectors and pseudo-classes as class-level', () => {
    expect(specificity('a[href]:hover')).toEqual([0, 2, 1])
  })
  it('counts a pseudo-element as type-level', () => {
    expect(specificity('.a::before')).toEqual([0, 1, 1])
  })
})

describe('stripStatePseudo', () => {
  it('removes a top-level state pseudo so the base can be matched', () => {
    expect(stripStatePseudo('.btn:hover', 'hover')).toBe('.btn')
  })
  it('refuses to touch a state pseudo nested inside a functional pseudo', () => {
    expect(stripStatePseudo('.btn:not(:hover)', 'hover')).toBeNull()
  })
})
```

- [ ] **Step 2: Run, confirm failure, implement `selector.ts`**

```ts
// src/capture/selector.ts
export function splitSelectorList(text: string): string[] {
  const out: string[] = []
  let depth = 0, quote: string | null = null, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1 }
  }
  out.push(text.slice(start).trim())
  return out.filter(Boolean)
}
```

`stripStatePseudo(selector, state)` scans for `:${state}` **at depth 0 only** and
returns the selector with that one token removed, or `null` when the pseudo appears
only inside a functional pseudo (`:not(:hover)`) — a case we decline to classify
rather than mis-classify. `specificity` counts `#id` → a, `.class` / `[attr]` /
`:pseudo-class` → b, type / `::pseudo-element` → c. **Documented limitation:** the
`:is()` / `:not()` / `:where()` argument rules from Selectors 4 are not implemented;
those selectors get the count of their outer form and a `unsupported-selector`
omission is recorded, so the JSON never claims a precision it does not have.

- [ ] **Step 3: Write the failing rules tests, all offline**

```ts
// tests/e2e/rules.spec.ts
import { expect, test } from '@playwright/test'

test('captures ::before content and computed styles', async ({ page }) => {
  await page.goto('http://localhost:8081/pseudo.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const p = await page.evaluate(() => window.__uiSelectorTest.capturePseudo(document.querySelector('.i')!))
  expect(p.before!.content).toBe('"\u2192"')
  expect(p.before!.computed['margin-right']).toBe('4px')
})

test('collects declarative interaction-state rules without forcing state', async ({ page }) => {
  await page.goto('http://localhost:8081/states.html')   // .b has :hover, :focus-visible, :disabled
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.b')!, window.__uiSelectorTest.ctx()))
  expect(new Set(r.states.map(s => s.state))).toEqual(new Set(['hover', 'focus-visible', 'disabled']))
  expect(r.states.find(s => s.state === 'hover')!.declarations['background-color']).toBeTruthy()
})

test('does not attribute another element\'s state rule to this element', async ({ page }) => {
  await page.goto('http://localhost:8081/states.html')   // page also defines .other:hover
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.b')!, window.__uiSelectorTest.ctx()))
  expect(r.states.every(s => !s.selector.includes('.other'))).toBe(true)
})

test('records media conditions of rules that applied', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 })
  await page.goto('http://localhost:8081/responsive.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.x')!, window.__uiSelectorTest.ctx()))
  expect(r.mediaConditions.some(c => c.includes('600px'))).toBe(true)
})

test('degrades to an omission on a cross-origin stylesheet instead of throwing', async ({ page }) => {
  // The fixture links http://127.0.0.1:8082/cross-origin.css WITHOUT crossorigin,
  // so cssRules access throws exactly as a CDN stylesheet does. Fully offline.
  await page.goto('http://localhost:8081/cross-origin.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const omissions = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx()
    window.__uiSelectorTest.matchedRules(document.querySelector('p')!, ctx)
    return ctx.omissions
  })
  expect(omissions.some(o => o.reason === 'cross-origin-stylesheet')).toBe(true)
})

test('reports specificity for competing rules from different sheets', async ({ page }) => {
  await page.goto('http://localhost:8081/specificity.html')  // #id .btn vs .btn, two sheets
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const r = await page.evaluate(() =>
    window.__uiSelectorTest.matchedRules(document.querySelector('.btn')!, window.__uiSelectorTest.ctx()))
  const sorted = [...r.applied].sort((a, b) =>
    b.specificity[0] - a.specificity[0] || b.specificity[1] - a.specificity[1])
  expect(sorted[0].specificity[0]).toBe(1)
  expect(new Set(r.applied.map(a => a.sheet)).size).toBeGreaterThan(1)
})
```

- [ ] **Step 4: Run, confirm failure, implement `rules.ts`**

`getMatchedCSSRules` no longer exists, so walk `document.styleSheets`. Two details
carry the correctness:

```ts
interface RuleSite { sheet: string; sheetIndex: number; ruleIndex: number }
interface Conditions { media: string[]; supports: string[] }

function eachStyleRule(ctx: CaptureContext,
                       visit: (rule: CSSStyleRule, conditions: Conditions, site: RuleSite) => void) {
  const seen = new WeakSet<CSSStyleSheet>()      // @import graphs can be cyclic
  const isType = (rule: CSSRule, name: string) =>
    typeof (globalThis as Record<string, unknown>)[name] === 'function' &&
    rule instanceof (globalThis as Record<string, { new (): CSSRule }>)[name]

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules                                   // throws on cross-origin
    } catch {
      ctx.omit('styles.matchedRules', 'cross-origin-stylesheet', sheet.href ?? 'unknown')
      continue
    }
    walkSheet(sheet, sheetIndex, { media: [], supports: [] })

    // `conditions` is rebuilt at each level, never mutated: a nested @supports inside
    // an @media must CARRY its parent condition, not replace it. Media and supports are
    // kept in SEPARATE lists — feeding a supports condition to matchMedia, as an
    // earlier draft did, silently misclassifies the responsive field.
    function walkSheet(target: CSSStyleSheet, sIdx: number, conditions: Conditions) {
      if (seen.has(target)) return                     // cyclic @import: stop, do not hang
      seen.add(target)
      let list: CSSRuleList
      try {
        list = target.cssRules
      } catch {
        ctx.omit('styles.matchedRules', 'cross-origin-stylesheet', target.href ?? 'unknown')
        return
      }
      walk(list, conditions, target.href ?? 'inline', sIdx)
    }

    function walk(list: CSSRuleList, conditions: Conditions, sheetId: string, sIdx: number) {
      Array.from(list).forEach((rule, ruleIndex) => {
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
          // An @import carries its own media condition, and the imported sheet's rules
          // belong to THAT sheet's provenance, not the importing one.
          const mediaText = imp.media?.mediaText
          walkSheet(imp.styleSheet as CSSStyleSheet,
                    sIdx,
                    mediaText ? { ...conditions, media: [...conditions.media, mediaText] } : conditions)
        }
        else if (isType(rule, 'CSSContainerRule') || isType(rule, 'CSSScopeRule'))
          ctx.omit('styles.matchedRules', 'unsupported-at-rule', rule.constructor.name)
        else if (isType(rule, 'CSSStyleRule'))
          visit(rule as CSSStyleRule, conditions, { sheet: sheetId, sheetIndex: sIdx, ruleIndex })
      })
    }
  }
}
```

`CSSLayerBlockRule` is feature-detected through `globalThis` rather than referenced
directly — a bare `rule instanceof CSSLayerBlockRule` throws `ReferenceError` in any
engine that lacks the constructor, which would take down the whole walk on a
best-effort browser.

For each style rule, `splitSelectorList(rule.selectorText)` and then per part:
- `el.matches(part)` → an applied rule; record selector, sheet, the `conditions` stack,
  specificity, its allowlisted declarations, and the properties declared `!important`
  (via `rule.style.getPropertyPriority`).
- otherwise, for each state in `['hover', 'focus-visible', 'active', 'disabled']`, if
  `stripStatePseudo(part, state)` returns a base that `el.matches`, record a state
  rule. A `null` return records `unsupported-selector` and is skipped.
- any declaration whose property starts with `--` is pushed to `customProperties`
  with the rule's selector, specificity, `important`, `sheetIndex`/`ruleIndex` for
  source order, and the `ancestorDepth` of the nearest element in the chain
  `[el, ...ancestors]` that the rule matches. **This is what Task 6 uses to name a
  token's definition site**, and it is why this task runs first.
- `mediaConditions` collects entries from `conditions.media` **only** — never from
  `conditions.supports` — for applied rules where `matchMedia(condition).matches`.
  Supports conditions travel with the matched-rule record instead, where they are
  evidence rather than a media query.
- `sheetIndex`/`ruleIndex` come from the `RuleSite` the walker passes in, which is what
  makes the source-order tie-break in Task 6 actually implementable rather than
  aspirational.

**At-rules: what is traversed and what is refused.**

| Rule | Handling |
|---|---|
| `CSSStyleRule` | matched normally |
| `CSSMediaRule`, `CSSSupportsRule` | traversed, condition pushed onto the stack |
| `CSSLayerBlockRule` | traversed; **layer order is not modelled** |
| `CSSImportRule` | traversed via `rule.styleSheet`, wrapped in the same try/catch — an `@import`ed cross-origin sheet throws exactly like a linked one |
| `CSSContainerRule`, `CSSScopeRule` | **skipped**, with an `unsupported-at-rule` omission naming the rule |
| CSS nesting (`&`) | relative selectors are not resolved; such rules are skipped with `unsupported-selector` |

And a stated non-guarantee, mirrored in spec §6.2: `matchedRules` reports rules
*observed to match*, each with its own specificity, source order and `important` list.
It does **not** resolve the cascade — layer precedence, `!important` across layers, and
`@scope` proximity are not computed. Reimplementing the CSS cascade inside a
bookmarklet is not an MVP, and reporting a resolved winner we cannot actually compute
would be worse than reporting the evidence.

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test -- selector && npm run test:e2e -- rules` → PASS.

- [ ] **Step 6: Commit** (with authorization)

### Task 6: Computed styles, CSS variables, typography

**Files:**
- Create: `src/capture/styles.ts`
- Test: `tests/e2e/styles.spec.ts`

**Interfaces:**
- Consumes: `STYLE_PROPERTIES` (Task 2), `matchedRules` (Task 5), `CaptureContext`.
- Produces: `captureStyles(el: Element, rules: MatchedRules, ctx: CaptureContext): StyleBundle` where
  `interface StyleBundle { computed: Record<string, string>; variables: Array<{ name: string; resolved: string; definedIn: string | null; usedBy: string[] }>; typography: Typography }`
  and `interface Typography { declaredFamilies: string[]; webfontStatus: Record<string, 'loaded' | 'loading' | 'unloaded' | 'not-a-webfont'>; size: string; lineHeight: string; letterSpacing: string; weight: string; featureSettings: string }`

Note the signature: `captureStyles` takes the already-computed `MatchedRules`. It does
not re-walk the CSSOM, and it does not guess.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/styles.spec.ts
import { expect, test } from '@playwright/test'

test('names a token definition site from matched rules, not by value comparison', async ({ page }) => {
  // fixture: :root{--brand:#0a7}  .b{color:var(--brand)}
  await page.goto('http://localhost:8081/tokens.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const brand = s.variables.find(v => v.name === '--brand')!
  expect(brand.resolved).toBe('#0a7')
  expect(brand.definedIn).toBe(':root')       // impossible to get right by comparing computed values
  expect(brand.usedBy).toContain('color')
  expect(s.computed.color).toBe('rgb(0, 170, 119)')
})

test('resolves the winning definition when a token is redefined on an ancestor', async ({ page }) => {
  // fixture: :root{--brand:#0a7}  .theme-dark{--brand:#fff}  .b inside .theme-dark
  await page.goto('http://localhost:8081/tokens-override.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const s = await page.evaluate(() => {
    const el = document.querySelector('.b')!
    const ctx = window.__uiSelectorTest.ctx()
    return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
  })
  const brand = s.variables.find(v => v.name === '--brand')!
  expect(brand.definedIn).toBe('.theme-dark')
  expect(brand.resolved).toBe('#fff')
})

test('distinguishes a webfont from a family no @font-face declares', async ({ page }) => {
  await page.goto('http://localhost:8081/fonts.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const out = await page.evaluate(async () => {
    await document.fonts.ready
    const read = (sel: string) => {
      const el = document.querySelector(sel)!
      const ctx = window.__uiSelectorTest.ctx()
      return window.__uiSelectorTest.captureStyles(el, window.__uiSelectorTest.matchedRules(el, ctx), ctx)
    }
    return { absent: read('p.absent').typography, web: read('p.web').typography }
  })
  expect(out.absent.declaredFamilies[0]).toBe('NotInstalled Sans')
  expect(out.absent.webfontStatus['NotInstalled Sans']).toBe('not-a-webfont')
  expect(out.web.webfontStatus['TestWeb']).toBe('loaded')
  // No field claims the absent family is or is not rendered — see Step 4.
  expect(out.absent).not.toHaveProperty('firstFamilyRendered')
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:e2e -- styles` → FAIL.

- [ ] **Step 3: Implement `computed` and `variables`**

- `computed`: `getComputedStyle(el)` filtered to `STYLE_PROPERTIES`.
- `variables`: for each allowlisted property, take the **declared** value from
  `rules.applied` (highest specificity wins, later sheet breaks ties) and extract
  `var\(\s*(--[\w-]+)` occurrences. `resolved` is
  `getComputedStyle(el).getPropertyValue(name).trim()`. `definedIn` is the **observed**
  definition site — not "the winning declaration", because Standard mode must not claim
  a cascade resolution that spec §6.2 explicitly disclaims for Deep. It is the selector
  of the best candidate in `rules.customProperties`, ordered: **smallest
  `ancestorDepth` first** (nearest wins, because an inherited custom property resolves
  per element), then `important`, then specificity, then `sheetIndex`/`ruleIndex`.

  Two definition sources are not stylesheet rules and are handled explicitly:
  - **Inline** `style="--brand:…"` on the element or an ancestor never appears in
    `document.styleSheets`. Walk `[el, ...ancestors]` reading
    `n.style.getPropertyValue(name)`; a hit yields `definedIn: '[inline]'` with that
    element's `ancestorDepth`, and inline beats every stylesheet rule at equal depth.
  - **Undeterminable** — a cross-origin sheet, a UA default, or a
    `@container`/`@scope` block we skipped. `definedIn` is `null` **and** an
    `indeterminate-definition` omission is recorded naming the variable. Silence here
    would read as "no token involved", which is the opposite of the truth.

  Depth must dominate specificity, not the reverse. On a themed page
  `html body .deep { --brand:#111 }` outranks `.theme-dark { --brand:#fff }` on
  specificity, yet if `.theme-dark` is the nearer ancestor it is the one that wins for
  the element — which is precisely the shape `tokens-override.html` is built to catch.

The earlier draft resolved this by comparing an ancestor's computed value to its
parent's. That cannot work: custom properties inherit, so `html`, `body`, and the
element all compute the same value and no comparison distinguishes the definition
site. Reading the declaration out of the matched rules is the only correct route,
and it is why Task 5 now precedes this one.

- [ ] **Step 4: Implement typography honestly — and ship only what is exact**

`document.fonts.check()` does **not** answer "is the first declared family installed":
it can return `true` for a family the engine will never render. So no field claims to.

- `declaredFamilies` — the computed `font-family` split into a list, quotes stripped.
- `webfontStatus` — for each declared family, the `status` of a matching `FontFace` in
  `document.fonts`, or `'not-a-webfont'` when no `@font-face` declares it. Wrapped in
  try/catch; `document.fonts` may be absent.
- size, lineHeight, letterSpacing, weight, featureSettings — straight from computed
  style.

**Cut from v1:** a canvas `measureText` heuristic comparing the declared family against
`monospace` and `serif` sentinels to guess whether a *system* family resolved. It was in
the previous draft and is removed. It is a heuristic with silent false negatives
whenever a family's metrics coincide with a sentinel, and a design brief that says
"this font did not render" when it did is worse than one that stays silent. Whether a
system family resolved is v1.1 work, or never.


- [ ] **Step 5: Run and confirm pass**, then `npm run lint && npm run typecheck`

- [ ] **Step 6: Commit** (with authorization)

### Task 7: CSP-safe DOM builder and the element picker

**Files:**
- Create: `src/ui/dom.ts`, `src/pick.ts`
- Test: `tests/unit/dom.test.ts`, `tests/e2e/pick.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: { text?: string; style?: Partial<CSSStyleDeclaration>; attrs?: Record<string, string> }, children?: Node[]): HTMLElementTagNameMap[K]`
  - `host(): { root: ShadowRoot; destroy(): void }` — closed shadow root on a
    `position:fixed` container with `z-index: 2147483647`
  - `pick(): Promise<Element | null>` — resolves on click, `null` on Escape

- [ ] **Step 1: Write the failing builder test**

```ts
// tests/unit/dom.test.ts
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { el } from '../../src/ui/dom'

it('sets text via textContent so markup in the input is inert', () => {
  globalThis.document = new JSDOM('<body></body>').window.document
  const node = el('div', { text: '<img src=x onerror=alert(1)>' })
  expect(node.childElementCount).toBe(0)
  expect(node.textContent).toContain('<img')
})

it('applies inline styles rather than emitting a style element', () => {
  globalThis.document = new JSDOM('<body></body>').window.document
  const node = el('span', { style: { color: 'red' } })
  expect(node.style.color).toBe('red')
  expect(document.querySelectorAll('style')).toHaveLength(0)
})
```

- [ ] **Step 2: Run, confirm failure, implement `dom.ts`**

Uses only `document.createElement`, `textContent`, `setAttribute`, and
`element.style` assignment. No template strings reach the DOM.

- [ ] **Step 3: Implement the picker and its e2e test**

```ts
// tests/e2e/pick.spec.ts
import { expect, test } from '@playwright/test'

test('highlights on hover and resolves the clicked element', async ({ page }) => {
  await page.setContent('<button id="target" style="padding:20px">Pick me</button>')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const picked = page.evaluate(() => window.__uiSelectorTest.pick().then(e => e && e.id))
  await page.hover('#target')
  await page.click('#target')
  expect(await picked).toBe('target')
})

test('Escape cancels and removes every trace from the page', async ({ page }) => {
  await page.setContent('<button id="t">x</button>')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const cancelled = page.evaluate(() => window.__uiSelectorTest.pick())
  await page.keyboard.press('Escape')
  expect(await cancelled).toBeNull()
  expect(await page.evaluate(() => document.body.children.length)).toBe(1)
})

test('runs under a strict CSP with Trusted Types enforced', async ({ page }) => {
  // `page.addScriptTag` injects an inline <script>, which this fixture's
  // `script-src 'self'` blocks outright — using it here would prove nothing. The
  // fixture instead carries `<script src="/ui-selector.test.js">` in its own markup,
  // served same-origin by tests/server.mjs, so the bundle loads the way an allowed
  // script does.
  const errors: string[] = []
  const violations: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    (window as never as Record<string, string[]>).__csp = []
    document.addEventListener('securitypolicyviolation', e =>
      ((window as never as Record<string, string[]>).__csp).push(
        `${(e as SecurityPolicyViolationEvent).violatedDirective}:${(e as SecurityPolicyViolationEvent).blockedURI}`))
  })
  await page.goto('http://localhost:8081/strict-csp.html')
  await page.evaluate(() => window.__uiSelectorTest.pick())
  await page.hover('#t')
  await page.click('#t')
  violations.push(...await page.evaluate(() => (window as never as Record<string, string[]>).__csp))
  expect(errors).toEqual([])
  expect(violations).toEqual([])          // our own code must trigger zero violations
})
```

Note what this test can and cannot establish. It proves our **code** does nothing a
strict CSP or Trusted Types blocks. It does **not** prove that a real `javascript:`
bookmarklet click is exempt from the page CSP — no automation can, because Playwright
cannot click a browser-chrome bookmark. That check stays a human step in
`docs/phase-0-manual-checks.md`.

The picker attaches `pointerover`/`click`/`keydown` listeners on `document` with
`{ capture: true }`, calls `preventDefault` and `stopPropagation` on the selecting
click so the page's own handlers never fire, and uses `elementFromPoint` with
`composedPath()` so a click landing on a shadow-DOM child resolves to the real
target. It draws the highlight as a single fixed-position outline div inside the
closed shadow root — never a style injected into the page.

- [ ] **Step 4: Run both suites and confirm pass**

- [ ] **Step 5: Commit** (with authorization)

---

### Task 8: Trust gate, run-once confirmation, install-page origin display

**Files:**
- Create: `src/trust.ts`
- Modify: `src/boot.ts`, `build/install-template.mjs`
- Test: `tests/unit/trust.test.ts`, `tests/e2e/trust.spec.ts`

**Interfaces:**
- Consumes: `__TRUSTED_ORIGINS__`, `el`/`host` (Task 7).
- Produces:
  - `classify(origin: string, trusted: string[]): 'trusted' | 'unknown'`
  - `gate(): Promise<{ trust: TrustLevel; mode: CaptureMode } | null>` — `null` when
    the user dismisses

- [ ] **Step 1: Write the failing classification tests**

```ts
// tests/unit/trust.test.ts
import { describe, expect, it } from 'vitest'
import { classify } from '../../src/trust'

const T = ['http://localhost', 'https://skill-shelf.pages.dev']

describe('classify', () => {
  it('matches localhost on any port', () => {
    expect(classify('http://localhost:4321', T)).toBe('trusted')
  })
  it('matches an exact https origin', () => {
    expect(classify('https://skill-shelf.pages.dev', T)).toBe('trusted')
  })
  it('does not treat a suffix lookalike as trusted', () => {
    expect(classify('https://skill-shelf.pages.dev.evil.tld', T)).toBe('unknown')
  })
  it('does not let a subdomain inherit trust', () => {
    expect(classify('https://x.skill-shelf.pages.dev', T)).toBe('unknown')
  })
  it('treats claude.ai as unknown even though it is an intended target', () => {
    expect(classify('https://claude.ai', T)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run, confirm failure, implement**

Match on the parsed `URL` origin: equal hostname **and** protocol, port ignored only
for `localhost`/`127.0.0.1`. No substring comparison anywhere — that is what the
lookalike tests pin.

- [ ] **Step 3: Implement the dialog and its e2e test**

The test build's `selector.config.test.json` trusts `http://localhost` only, so
`http://127.0.0.1:8082` is a genuinely unknown origin — no `example.com`, no network.

```ts
// tests/e2e/trust.spec.ts
const UNKNOWN = 'http://127.0.0.1:8082/site-lite.html'
const TRUSTED = 'http://localhost:8080/'

test('unknown origin requires confirmation, offers no permanent trust, and blocks Deep', async ({ page }) => {
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  const shadowText = await page.evaluate(() => window.__uiSelectorTest.dialogText())
  expect(shadowText).toContain('Run once on 127.0.0.1')
  expect(shadowText).not.toMatch(/always|remember|trust this site/i)
  expect(shadowText).toContain('Deep mode unavailable')
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  expect(await gate).toEqual({ trust: 'restricted', mode: 'standard' })
})

test('dismissing the dialog tears down completely', async ({ page }) => {
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await page.keyboard.press('Escape')
  expect(await gate).toBeNull()
  expect(await page.evaluate(() => (window as never as Record<string, unknown>).__uiSelectorActive__)).toBeUndefined()
})

test('a trusted origin can choose Deep, and a restricted one cannot', async ({ page }) => {
  await page.goto(TRUSTED)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const trusted = page.evaluate(() => window.__uiSelectorTest.gate())
  const text = await page.evaluate(() => window.__uiSelectorTest.dialogText())
  expect(text).toMatch(/deep/i)                        // the control exists on trusted origins
  await page.evaluate(() => window.__uiSelectorTest.chooseMode('deep'))
  expect(await trusted).toEqual({ trust: 'trusted', mode: 'deep' })

  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const restricted = page.evaluate(() => window.__uiSelectorTest.gate())
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  expect(await restricted).toEqual({ trust: 'restricted', mode: 'standard' })
})

test('a trusted origin still defaults to Standard unless Deep is chosen', async ({ page }) => {
  await page.goto(TRUSTED)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await page.evaluate(() => window.__uiSelectorTest.clickProceed())
  expect(await gate).toEqual({ trust: 'trusted', mode: 'standard' })
})

test('no storage API is touched on any path', async ({ page }) => {
  // addInitScript MUST precede goto: registered afterwards it does not instrument the
  // already-loaded document, and the assertion would pass vacuously.
  await page.addInitScript(() => {
    const w = window as never as Record<string, unknown>
    w.__touched = [] as string[]
    const note = (what: string) => (w.__touched as string[]).push(what)

    // The earlier draft hooked only setItem, so a read, a removeItem, a cookie write,
    // or an IndexedDB open would all have passed silently. Cover the surface.
    for (const name of ['localStorage', 'sessionStorage']) {
      const store = (window as never as Record<string, Storage>)[name]
      for (const m of ['setItem', 'getItem', 'removeItem', 'clear', 'key'] as const) {
        const real = (store[m] as (...a: unknown[]) => unknown).bind(store)
        ;(store as never as Record<string, unknown>)[m] = (...a: unknown[]) => {
          note(`${name}.${m}`); return real(...a)
        }
      }
    }
    const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      get() { note('cookie.get'); return cookieDesc.get!.call(document) },
      set(v) { note('cookie.set'); cookieDesc.set!.call(document, v) },
    })
    const openReal = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((...a: Parameters<typeof openReal>) => { note('indexedDB.open'); return openReal(...a) }) as typeof openReal
    if ('caches' in window) {
      const cachesOpen = caches.open.bind(caches)
      caches.open = ((...a: Parameters<typeof cachesOpen>) => { note('caches.open'); return cachesOpen(...a) }) as typeof cachesOpen
    }
  })
  await page.goto(UNKNOWN)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const gate = page.evaluate(() => window.__uiSelectorTest.gate())
  await page.evaluate(() => window.__uiSelectorTest.clickRunOnce())
  await gate
  // Run a full capture too: the invariant is "never touches storage", not
  // "never touches storage during the trust dialog".
  await page.evaluate(() => window.__uiSelectorTest.runHeadless('.b'))
  expect(await page.evaluate(() => (window as never as Record<string, string[]>).__touched)).toEqual([])
})
```

The invariant asserted here is deliberately scoped to what the instrumentation actually
observes: **ui-selector never calls `localStorage`/`sessionStorage`
get/set/remove/clear/key, never reads or writes `document.cookie`, never calls
`indexedDB.open`, and never calls `caches.open`.** That is stronger than "writes
nothing" and it is fully checked. It is *not* the unbounded claim "touches no storage
API of any kind" — direct property access on a storage object, other IndexedDB entry
points, and the rest of `CacheStorage` are outside the wrapper, and the wording says so
rather than implying coverage the test does not have.

Spec §5 lets a trusted origin opt into Deep, so `gate()` returns a **mode choice**,
not just a trust level: trusted origins get a Standard/Deep control that defaults to
Standard, and restricted origins get no Deep path at all. The earlier draft tested
only the restricted branch, which would have let every trusted capture silently
default to Standard with nobody noticing.

- [ ] **Step 4: Update the install page**

`build/install-template.mjs` renders the baked `trustedOrigins` as a visible list
with the byte count and the build timestamp, so an old bookmark's contents are
auditable from the page that generated it.

- [ ] **Step 5: Run all suites, then commit** (with authorization)

---

### Task 9: Screenshot

Two things make this task different from the earlier draft: `getDisplayMedia` needs
**transient user activation** (so it cannot be called from `page.evaluate`) and a
**secure context** (so `page.setContent`'s `about:blank` document is not a valid
target). And display capture is inherently non-deterministic, so the crop arithmetic
gets its own deterministic seam.

**Files:**
- Create: `src/shot.ts`
- Create: `tests/fixtures/shot.html`
- Test: `tests/e2e/shot.spec.ts`

**Interfaces:**
- Consumes: `CaptureContext`.
- Produces:
  `screenshot(el: Element, ctx: CaptureContext, opts?: { streamFactory?: () => Promise<MediaStream>; canvasFactory?: () => HTMLCanvasElement }): Promise<Screenshot | null>`
  where `interface Screenshot { canvas: HTMLCanvasElement; rect: Rect; scale: number; clipped: boolean }`

  `streamFactory` defaults to the real `getDisplayMedia` call; `canvasFactory` defaults
  to `document.createElement('canvas')`. Both exist so the crop path can be driven
  deterministically — known stream contents, and an injectable failure — without any
  test mutating a global prototype. Production passes neither.

- [ ] **Step 1: Build the fixture with a real control**

`tests/fixtures/shot.html` is served from `http://localhost:8081` — localhost is a
secure context, so `getDisplayMedia` is available — and contains a real button plus a
deterministic target:

```html
<title>shot-fixture</title>
<button id="shoot">Screenshot</button>
<div id="target" style="width:120px;height:80px;background:#0a7"></div>
<div id="tall" style="height:5000px;background:linear-gradient(red,blue)"></div>
<script src="/ui-selector.test.js"></script>
<script>
  document.getElementById('shoot').addEventListener('click', async () => {
    const ctx = window.__uiSelectorTest.ctx()
    const el = document.getElementById(window.__shotTarget || 'target')
    window.__shotResult = await window.__uiSelectorTest.screenshot(el, ctx)
    window.__shotOmissions = ctx.omissions
  })
</script>
```

The handler runs inside the click, so activation is live when `getDisplayMedia` is
reached. `page.click('#shoot')` is what supplies it — `page.evaluate` never can.

- [ ] **Step 2: Write the failing deterministic crop test**

All crop tests share one helper, installed in the page, so no test invents its own
frame-readiness scheme. It paints on a rAF loop (a `captureStream` produces frames only
while the canvas is drawn to) and — critically — stops the loop in a `finally`, so a
rejected screenshot cannot leave a self-scheduling loop running for the rest of the page.

```ts
// tests/e2e/shot-helpers.ts — injected via page.addScriptTag / evaluate
export const DETERMINISTIC_STREAM = `
window.__mkStream = (scaleFactor) => {
  const src = document.createElement('canvas')
  src.width = Math.round(window.innerWidth * scaleFactor)
  src.height = Math.round(window.innerHeight * scaleFactor)
  const c = src.getContext('2d')
  let frame = 0
  const paint = () => {
    c.fillStyle = '#0a7'; c.fillRect(0, 0, src.width, src.height)
    c.fillStyle = '#fff'; c.fillRect(0, 0, 40, 40)      // a known marker to sample
    frame = requestAnimationFrame(paint)
  }
  paint()
  const stream = src.captureStream(30)
  return { stream, stop: () => { cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop()) } }
}`
```

```ts
// tests/e2e/shot.spec.ts
import { expect, test } from '@playwright/test'
import { DETERMINISTIC_STREAM } from './shot-helpers'

test.beforeEach(async ({ page }) => { await page.addInitScript(DETERMINISTIC_STREAM) })

test('crops from the video scale, not devicePixelRatio', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  // A canvas.captureStream() is a real MediaStream with dimensions we choose, so the
  // crop arithmetic is checked exactly, with no display-capture permission involved.
  const out = await page.evaluate(async () => {
    const { stream, stop } = window.__mkStream(3)      // 3x, deliberately NOT the DPR
    try {
      const ctx = window.__uiSelectorTest.ctx()
      const el = document.getElementById('target')!
      const shot = await window.__uiSelectorTest.screenshot(el, ctx, {
        streamFactory: async () => stream,
      })
      const r = el.getBoundingClientRect()
      const px = shot!.canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data
      return { scale: shot!.scale, w: shot!.canvas.width, h: shot!.canvas.height,
               expectW: Math.round(r.width * 3), expectH: Math.round(r.height * 3),
               dpr: devicePixelRatio, blank: px[3] === 0 }
    } finally {
      stop()                                            // never leak the paint loop
    }
  })
  expect(out.scale).toBeCloseTo(3, 1)
  expect(out.scale).not.toBeCloseTo(out.dpr, 1)     // the bug this test exists to catch
  expect(out.w).toBe(out.expectW)
  expect(out.h).toBe(out.expectH)
  expect(out.blank).toBe(false)                     // a correctly sized blank crop is still a failure
})

test('clamps an oversized element to the viewport and reports clipped', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const { stream, stop } = window.__mkStream(1)
    try {
      const ctx = window.__uiSelectorTest.ctx()
      const shot = await window.__uiSelectorTest.screenshot(document.getElementById('tall')!, ctx, {
        streamFactory: async () => stream,
      })
      return { h: shot!.canvas.height, clipped: shot!.clipped, vh: window.innerHeight,
               omissions: ctx.omissions }
    } finally { stop() }
  })
  expect(out.clipped).toBe(true)
  expect(out.h).toBeLessThanOrEqual(out.vh)
  expect(out.omissions.some(o => o.reason === 'clipped-screenshot')).toBe(true)
})

test('stops every track when the crop path throws', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const { stream, stop } = window.__mkStream(1)
    try {
      // Force a failure INSIDE the crop, after the stream is live, through an injected
      // seam rather than by mutating HTMLCanvasElement.prototype. A global prototype
      // patch that is only restored after the awaited call leaves the whole page
      // poisoned if anything throws unexpectedly.
      const ctx = window.__uiSelectorTest.ctx()
      const result = await window.__uiSelectorTest
        .screenshot(document.getElementById('target')!, ctx, {
          streamFactory: async () => stream,
          canvasFactory: () => { throw new Error('forced crop failure') },
        })
        .then(() => 'resolved', () => 'rejected')
      return { result, ended: stream.getTracks().every(t => t.readyState === 'ended') }
    } finally { stop() }
  })
  expect(out.ended).toBe(true)       // the assertion that needs a real failure to mean anything
})

test('emits an unsupported-browser omission when getDisplayMedia is absent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  })
  await page.goto('http://localhost:8081/shot.html')
  const omissions = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return ctx.omissions
  })
  expect(omissions.some(o => o.reason === 'unsupported-browser')).toBe(true)
})

test('a browser without getSupportedConstraints still captures — support is getDisplayMedia alone', async ({ page }) => {
  // Spec §7: support is decided by the presence of getDisplayMedia and nothing else.
  // The old getSupportedConstraints probe is gone entirely, so this fixture — which
  // omits it — must behave exactly like a fully-featured browser.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => (window as never as { __mkStream: (n: number) => { stream: MediaStream } })
          .__mkStream(1).stream,
        // no getSupportedConstraints at all
      },
    })
  })
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    const shot = await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return { got: Boolean(shot), omissions: ctx.omissions }
  })
  expect(out.got).toBe(true)
  expect(out.omissions.some(o => o.reason === 'unsupported-browser')).toBe(false)
})

test('records user-declined when the permission is refused', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => { throw new DOMException('denied', 'NotAllowedError') } },
    })
  })
  await page.goto('http://localhost:8081/shot.html')
  const omissions = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return ctx.omissions
  })
  expect(omissions.some(o => o.reason === 'user-declined')).toBe(true)
})
```

- [ ] **Step 3: Write the real-capture smoke test, separately**

```ts
test.describe('real display capture', () => {
  test.use({ launchOptions: { args: [
    '--use-fake-ui-for-media-stream',
    '--auto-select-tab-capture-source-by-title=shot-fixture',
  ] } })

  test('a real user click reaches a PNG', async ({ page }) => {
    await page.goto('http://localhost:8081/shot.html')
    await page.click('#shoot')                      // supplies transient activation
    await expect.poll(() => page.evaluate(() => Boolean((window as never as Record<string, unknown>).__shotResult)))
      .toBe(true)
    const ok = await page.evaluate(() => {
      const s = (window as never as Record<string, { canvas: HTMLCanvasElement }>).__shotResult
      return s.canvas.width > 0 && s.canvas.toDataURL('image/png').startsWith('data:image/png')
    })
    expect(ok).toBe(true)
  })
})
```

If the Chromium auto-select flag ever stops matching by title, only this smoke test
breaks — the crop arithmetic is covered by the deterministic tests above, which is the
point of the seam.

- [ ] **Step 4: Run, confirm failure, implement**

```ts
// src/shot.ts
function displayCaptureSupported(): boolean {
  const md = navigator.mediaDevices
  return Boolean(md) && typeof md.getDisplayMedia === 'function'
}
```

One fact, one function. `getSupportedConstraints()` is dropped entirely: it enumerates
*track* constraints and the Screen Capture spec's supported-constraint list does not
include `preferCurrentTab`, so probing it there reports the hint absent on Chromium too
— a detector that is not merely unreliable but systematically wrong.

`preferCurrentTab: true` is therefore passed **unconditionally**. It is a dictionary
member: an engine that does not implement it ignores it, per WebIDL, so there is
nothing to detect and no branch to get wrong. Chromium honours it; Firefox and Safari
show their own picker.

Support is one fact and it gates one decision: attempt capture, or record
`unsupported-browser` and return `null`. Nothing else feeds that gate. Spec §7 and §9,
the Global Constraints, and `docs/phase-0-manual-checks.md` all now state this same
rule, because the previous draft had it three ways at once — a test expecting
`unsupported-browser`, code returning `supported: true`, and a checklist saying
"disabled".

The earlier draft wrote `'preferCurrentTab' in navigator.mediaDevices.getSupportedConstraints?.() ?? {}`,
which parses as `('preferCurrentTab' in undefined) ?? {}` because `in` binds tighter
than `??` — a `TypeError` instead of the intended `unsupported-browser` omission.

The rest: `scrollIntoView({ block: 'nearest' })`, obtain the stream (via
`opts.streamFactory` when given, else
`getDisplayMedia({ preferCurrentTab: true, video: { frameRate: 1 } })`), attach it to a
muted `<video>`, **await a delivered frame** (below), compute
`scale = video.videoWidth / window.innerWidth`, clamp the rect to the viewport (setting
`clipped` and recording a `clipped-screenshot` omission when clamping changed it),
`drawImage` into our own canvas, and stop every track in a `finally`. A rejected
permission records `user-declined` and returns `null`.

Two animation frames is **not** a frame-delivery guarantee — it can leave `videoWidth`
at 0 or crop a blank frame. Wait for the real signals, with a bounded fallback so a
stream that never produces a frame cannot hang the tool:

```ts
async function firstFrame(video: HTMLVideoElement, timeoutMs = 3000): Promise<boolean> {
  if (video.readyState < 1) {
    await new Promise<void>(r => video.addEventListener('loadedmetadata', () => r(), { once: true }))
  }
  const rvfc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback
  const delivered = rvfc
    ? new Promise<boolean>(r => rvfc.call(video, () => r(true)))
    : new Promise<boolean>(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))
  const timeout = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs))
  const ok = await Promise.race([delivered, timeout])
  return ok && video.videoWidth > 0
}
```

A `false` return records `unsupported-browser` with detail `no frame delivered` and
returns `null` rather than emitting a blank canvas.

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test:e2e -- shot` → PASS.

- [ ] **Step 6: Commit** (with authorization)

### Task 10: Capture orchestrator, Markdown renderer, preview panel, output

**Files:**
- Create: `src/capture/index.ts`, `src/ui/markdown.ts`, `src/ui/panel.ts`
- Modify: `src/boot.ts`
- Test: `tests/unit/capture.test.ts`, `tests/unit/markdown.test.ts`, `tests/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: `capture(el: Element, ctx: CaptureContext): CaptureV1`;
  `toMarkdown(result: CaptureV1): string`;
  `showPanel(result: CaptureV1, shot: Screenshot | null): void`

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/unit/capture.test.ts
// @vitest-environment jsdom       <- this test needs a document; the default is node
import { describe, expect, it } from 'vitest'
import { capture } from '../../src/capture'
import { makeContext } from '../../src/types'

it('always emits schemaVersion, reduced page identity, and an omissions array', () => {
  // jsdom document created at https://x.dev/p?token=SECRET — see the environmentOptions
  // in vitest.config.ts, which sets the jsdom `url` so page identity has something real
  // to reduce. `makeContext` is the helper produced by Task 2.
  const result = capture(document.querySelector('button')!, makeContext('standard', 'restricted'))
  expect(result.schemaVersion).toBe('1.0')
  expect(result.page).toEqual({ origin: 'https://x.dev', pathname: '/p' })
  expect(JSON.stringify(result)).not.toContain('SECRET')
  expect(Array.isArray(result.omissions)).toBe(true)
})

it('records restricted-mode omissions instead of silently dropping deep fields', () => {
  const result = capture(document.querySelector('button')!, makeContext('deep', 'restricted'))
  expect(result.deep).toBeUndefined()
  expect(result.omissions).toContainEqual(
    expect.objectContaining({ field: 'deep', reason: 'restricted-mode' }))
})
```

- [ ] **Step 2: Run, confirm failure, implement the orchestrator**

`capture` assembles `env`, `element`, `locator`, `layout`, `styles`, `pseudo`,
`states`, `ancestry`, and — only when `mode === 'deep' && trust === 'trusted'` —
`deep`. A Deep request under `restricted` records the omission rather than throwing.

- [ ] **Step 3: Write the failing Markdown renderer test**

```ts
// tests/unit/markdown.test.ts
// @vitest-environment node        <- toMarkdown is pure; it must not need a DOM
import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../../src/ui/markdown'
import type { CaptureV1 } from '../../src/types'

const fixture: CaptureV1 = {
  schemaVersion: '1.0',
  capturedAt: '2026-08-22T00:00:00.000Z',
  page: { origin: 'https://skill-shelf.pages.dev', pathname: '/' },
  trust: 'trusted',
  mode: 'standard',
  env: { viewport: { width: 1440, height: 900 }, devicePixelRatio: 2,
         prefersColorScheme: 'dark', colorScheme: 'dark light', themeAttributes: { 'data-theme': 'dark' } },
  element: { tagName: 'BUTTON', role: 'button', accessibleName: 'Save', attributes: { class: 'btn' }, text: 'Save' },
  locator: { selector: '[data-testid="save"]', strategy: 'testid', confidence: 'exact', matchCount: 1 },
  layout: { rect: { x: 10, y: 20, width: 96, height: 40 },
            boxModel: { content: { x: 10, y: 20, width: 96, height: 40 },
                        padding: { top: 8, right: 16, bottom: 8, left: 16 },
                        border: { top: 1, right: 1, bottom: 1, left: 1 },
                        margin: { top: 0, right: 0, bottom: 0, left: 0 } },
            scroll: { pageX: 0, pageY: 0, elementScrollTop: 0, elementScrollLeft: 0,
                      scrollParentSelector: null },
            parent: { display: 'flex', flexFlow: 'row nowrap', gap: '8px' },
            item: { flex: '0 1 auto', alignSelf: 'center' },
            stacking: [{ selector: 'header', position: 'sticky', zIndex: '10' }],
            nearestStackingContextSelector: 'header',
            ancestry: [{ tagName: 'DIV', role: null, display: 'flex' }] },
  styles: { computed: { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(0, 170, 119)' },
            variables: [{ name: '--brand', resolved: '#0a7', definedIn: ':root', usedBy: ['background-color'] }],
            typography: { declaredFamilies: ['Inter', 'sans-serif'],
                          webfontStatus: { Inter: 'loaded', 'sans-serif': 'not-a-webfont' },
                          size: '14px', lineHeight: '20px', letterSpacing: 'normal',
                          weight: '600', featureSettings: 'normal' } },
  pseudo: {},
  states: [{ state: 'hover', selector: '.btn:hover', declarations: { 'background-color': '#096' } }],
  omissions: [{ field: 'deep', reason: 'restricted-mode' }],
}

describe('toMarkdown', () => {
  it('renders the locator, tokens, typography, and states', () => {
    const md = toMarkdown(fixture)
    expect(md).toContain('[data-testid="save"]')
    expect(md).toContain('--brand')
    expect(md).toContain('#0a7')
    expect(md).toContain('Inter')
    expect(md).toContain(':hover')
  })

  it('surfaces omissions so absence never reads as unstyled', () => {
    expect(toMarkdown(fixture)).toMatch(/omission|not captured/i)
  })

  it('reports webfont status per declared family', () => {
    const md = toMarkdown({ ...fixture,
      styles: { ...fixture.styles,
        typography: { ...fixture.styles.typography,
          webfontStatus: { Inter: 'unloaded', 'sans-serif': 'not-a-webfont' } } } })
    expect(md).toMatch(/unloaded/i)
    expect(md).toContain('Inter')
  })

  it('is a pure function of its input — it never touches the DOM', () => {
    const spy = { called: false }
    const guard = new Proxy({}, { get() { spy.called = true; return undefined } })
    const saved = globalThis.document
    ;(globalThis as { document?: unknown }).document = guard
    try { toMarkdown(fixture) } finally { globalThis.document = saved }
    expect(spy.called).toBe(false)
  })

  it('cannot reintroduce a secret the JSON never contained', () => {
    expect(toMarkdown(fixture)).not.toContain('SEEDED-')
  })
})
```

- [ ] **Step 4: Run, confirm failure, implement `markdown.ts`**

Run: `npm run test -- markdown` → FAIL. Then implement as string concatenation over
the `CaptureV1` fields — headings for identity / layout / tokens / typography /
states, a two-column table for variables, and a trailing "Not captured" list built
from `omissions`. It imports nothing from `src/capture/**` and references no global
except its argument; the purity test above pins that.

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test -- markdown` → PASS.

- [ ] **Step 6: Implement the preview panel**

The panel renders inside the closed shadow root: the JSON in a scrollable
`<pre>` (set via `textContent`), the screenshot painted into a `<canvas>` we own
(never `<img src="blob:">`), the omissions list, and three buttons — **Copy JSON**,
**Copy as prompt** (`toMarkdown`, both via `navigator.clipboard.writeText`), and
**Download** (an `<a download>` with an object URL revoked immediately after the
click). The panel is the privacy affordance: the user sees exactly what leaves the
page before it leaves.

- [ ] **Step 7: End-to-end flow test**

```ts
// tests/e2e/flow.spec.ts
test('full flow on a real-world page produces actionable JSON with no secrets', async ({ page, context }) => {
  await context.addCookies([{ name: 'sid', value: 'SEEDED-COOKIE', url: 'http://localhost:8080' }])
  await page.goto('http://localhost:8080/?q=SEEDED-QUERY')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const json = await page.evaluate(() => window.__uiSelectorTest.runHeadless('h1'))
  expect(json.schemaVersion).toBe('1.0')
  expect(json.page.pathname).toBe('/')
  const text = JSON.stringify(json)
  expect(text).not.toContain('SEEDED-')
  expect(json.styles.typography.declaredFamilies.length).toBeGreaterThan(0)
  expect(json.locator.confidence).toBe('exact')
})

test('@live deployed skill-shelf still behaves the same', async ({ page }) => {
  await page.goto('https://skill-shelf.pages.dev/')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const json = await page.evaluate(() => window.__uiSelectorTest.runHeadless('h1'))
  expect(json.page.origin).toBe('https://skill-shelf.pages.dev')
  expect(json.locator.confidence).toBe('exact')
})
```

The `@live` test is excluded from CI by the Task 12 workflow and run by hand before
a release. Everything else must pass with the machine offline.

- [ ] **Step 8: Run every suite; wire `boot.ts` to `gate → pick → capture → panel`**

- [ ] **Step 9: Manual verification on all three target classes**

Build, reinstall the bookmarklet, and run it on: a localhost page, skill-shelf, and a
Claude artifact document **loaded as the top-level page** (open the artifact, then
open its frame in a new tab — selecting inside the claude.ai shell is out of scope
per spec §3). Check both Copy JSON and Copy as prompt. Confirm the payload size is
still inside the Spike 1 envelope: `npm run build` prints it.

- [ ] **Step 10: Commit** (with authorization)

---

### Task 11: Deep mode

**Files:**
- Create: `src/capture/deep.ts`
- Modify: `src/capture/index.ts`
- Test: `tests/e2e/deep.spec.ts`

**Interfaces:**
- Consumes: `CAPS`, `pickAttributes`, `reducedUrl`, `matchedRules`.
- Produces: `captureDeep(el: Element, ctx: CaptureContext): DeepBundle` where
  `interface DeepBundle { subtree: SanitizedNode[]; rules: MatchedRules['applied']; keyframes: Array<{ name: string; text: string }>; assets: Asset[] }`
  and
  `interface Asset { kind: 'img' | 'source' | 'poster' | 'background-image'; url: string; naturalWidth: number | null; naturalHeight: number | null; objectFit: string | null; selector: string }`

  Asset collection rules, stated so the implementation can neither quietly omit them
  nor reintroduce URL data:
  - Sources, in order: `img[src]`, `picture > source[srcset]` (first candidate URL
    only), `video[poster]`, and computed `background-image` `url()` values — for the
    selected element and its captured subtree.
  - Every URL goes through `reducedUrl`. A rejected scheme (`data:`, `blob:`) drops the
    asset and records `blocked-scheme`: asset bytes must never ride along inside a data
    URL, which is exactly how an "asset metadata" field turns into an exfiltration
    channel.
  - `naturalWidth`/`naturalHeight` come from the live element where available, `null`
    otherwise (background images, unloaded sources). Cross-origin images still report
    natural dimensions — that is not tainted information.
  - Capped at `CAPS.deepAssets` (20), with `budget-exceeded` beyond it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/deep.spec.ts
test('sanitizes the subtree, respects budgets, and never carries form values', async ({ page }) => {
  await page.setContent(`<div id="c"><input value="SEEDED-INPUT"><span>ok</span>
    ${'<b>x</b>'.repeat(500)}</div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const { deep, omissions } = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx('deep', 'trusted')
    return { deep: window.__uiSelectorTest.captureDeep(document.getElementById('c')!, ctx), omissions: ctx.omissions }
  })
  expect(JSON.stringify(deep)).not.toContain('SEEDED-INPUT')
  expect(deep.subtree.some(n => n.tagName === 'INPUT')).toBe(false)   // pruned, not just emptied
  expect(deep.subtree.length).toBeLessThanOrEqual(200)
  expect(omissions.some(o => o.reason === 'budget-exceeded')).toBe(true)
})

test('collects assets with reduced URLs and drops data-URL sources', async ({ page }) => {
  await page.goto('http://localhost:8081/seeded-secrets.html')
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const { deep, omissions } = await page.evaluate(() => {
    const ctx = window.__uiSelectorTest.ctx('deep', 'trusted')
    return { deep: window.__uiSelectorTest.captureDeep(document.getElementById('card')!, ctx),
             omissions: ctx.omissions }
  })
  expect(JSON.stringify(deep.assets)).not.toContain('SEEDED-DATA')
  expect(omissions.some(o => o.reason === 'blocked-scheme')).toBe(true)
  for (const a of deep.assets) expect(a.url).toMatch(/^https?:\/\/[^?#]*$/)
})

test('collects only the keyframes the element actually animates', async ({ page }) => {
  await page.setContent(`<style>@keyframes spin{to{transform:rotate(360deg)}}
    @keyframes unused{to{opacity:0}} .s{animation:spin 1s linear infinite}</style><div class="s">x</div>`)
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  const deep = await page.evaluate(() =>
    window.__uiSelectorTest.captureDeep(document.querySelector('.s')!, window.__uiSelectorTest.ctx('deep', 'trusted')))
  expect(deep.keyframes.map(k => k.name)).toEqual(['spin'])
})
```

- [ ] **Step 2: Run, confirm failure, implement**

Subtree walk emits `{ tagName, attributes: pickAttributes(node, ctx), text: visibleText(node, trust, ctx) }`
breadth-first, stopping at `CAPS.deepNodes` or `CAPS.deepChars` with a
`budget-exceeded` omission. It must **not** descend into `TEXT_FORBIDDEN_TAGS`
subtrees at all — the walk shares `isForbiddenSubtree` from Task 2, including the
ancestor-chain visibility check, so a `<textarea>` never appears as a node, let alone
as text. It calls `noteShadowBoundary` on the root and does not cross shadow roots,
matching the Standard-mode boundary exactly rather than defining a second one. `rules` carries the `specificity` field
from Task 5, satisfying spec §6.2's requirement for specificity and origin sheet. Keyframes are matched by name against the computed
`animation-name` list. Assets record reduced `src` plus natural dimensions only —
never bytes.

- [ ] **Step 3: Run and confirm pass**

- [ ] **Step 4: Commit** (with authorization)

---

### Task 12: Documentation, CI, and the standing redaction gate

**Files:**
- Create: `README.md`, `docs/data-contract.md`, `docs/phase-0-manual-checks.md`,
  `.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (commands table + gotchas), `NOTICE`
- Test: `tests/e2e/redaction.spec.ts`

**Interfaces:**
- Consumes: the whole build.
- Produces: a green CI run that fails on any secret leak or payload-size regression.

- [ ] **Step 1: Write the standing redaction gate**

```ts
// tests/e2e/redaction.spec.ts
import { expect, test } from '@playwright/test'

// Every seed the fixture plants. An incomplete list is the failure mode this gate
// exists to prevent, so it is derived from fixtures/seeded-secrets.html exhaustively.
const SEEDS = [
  'SEEDED-COOKIE', 'SEEDED-INPUT', 'SEEDED-AREA', 'SEEDED-EDITABLE',
  'SEEDED-EDITABLE-EMPTY', 'SEEDED-EDITABLE-PLAIN', 'SEEDED-SCRIPT', 'SEEDED-STYLE',
  'SEEDED-HIDDEN', 'SEEDED-NONE', 'SEEDED-TPL', 'SEEDED-QUERY', 'SEEDED-JS',
  'SEEDED-DATA', 'SEEDED-STORAGE',
]

test('no seeded secret ever appears in any captured output', async ({ page, context }) => {
  await context.addCookies([{ name: 'sid', value: 'SEEDED-COOKIE', url: 'http://localhost:8081' }])
  await page.goto('http://localhost:8081/seeded-secrets.html?q=SEEDED-QUERY')
  await page.evaluate(() => localStorage.setItem('k', 'SEEDED-STORAGE'))
  await page.addScriptTag({ path: 'dist/ui-selector.test.js' })
  // Every element in the seeded card, in both modes, as JSON *and* as Markdown —
  // not an arbitrary first-40 slice, which could miss the very element that leaks.
  const blob = await page.evaluate(() => {
    const els = [document.getElementById('card')!, ...document.querySelectorAll('#card *')]
    const out: string[] = []
    for (const el of els) {
      for (const [mode, trust] of [['standard', 'restricted'], ['deep', 'trusted']] as const) {
        const json = window.__uiSelectorTest.runHeadlessOn(el, mode, trust)
        out.push(JSON.stringify(json), window.__uiSelectorTest.toMarkdown(json))
      }
    }
    return out.join('\n')
  })
  for (const seed of SEEDS) expect(blob).not.toContain(seed)
})
```

- [ ] **Step 2: Run it and confirm it passes** (it should, if Tasks 2–11 are correct;
      if it fails, that is a real defect, not a test bug)

- [ ] **Step 3: Write `README.md`**

Sections: what it captures, **what it never captures** (verbatim from spec §6.4),
the two output formats (JSON and prompt-ready Markdown), the trust model table,
install and rebuild instructions, browser support, the Claude-artifact iframe caveat
with the exact "open the artifact document as the top-level page" steps, and the
threat model. English only.

- [ ] **Step 4: Write `docs/data-contract.md`**

The full `CaptureV1` schema with one annotated example output per mode, and the
`omissions` reason table.

- [ ] **Step 5: CLAUDE.md commands table and gotchas**

| Task | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` |
| test | `npm run test` |
| e2e | `npm run test:e2e` |
| lint | `npm run lint` |
| format | `npm run format` |
| typecheck | `npm run typecheck` |

Gotchas to record, one line each: bookmarklet must be re-dragged after every build;
crop scale is `videoWidth / innerWidth`, never DPR; `innerHTML` and friends are
lint-banned for CSP/Trusted-Types reasons; cross-origin stylesheets throw on
`cssRules` and must degrade to an omission; a Claude artifact embedded in claude.ai
is a cross-origin iframe and out of reach.

- [ ] **Step 6: `docs/phase-0-manual-checks.md`**

The three checks no automation can perform, written as a ~10-minute human checklist
with a place to record each result:

1. **Real bookmarklet click under a strict CSP.** Build, drag `dist/install.html`'s
   link to the bookmarks bar, open `http://localhost:8081/strict-csp.html`, click the
   bookmark. Record whether the overlay appears and whether the console shows CSP
   violations. This is the one claim the Task 7 automated test explicitly cannot make.
2. **Cross-browser and sync.** Same bookmark in Firefox and Safari. Expected: selection
   and capture work; the screenshot control is **enabled** wherever `getDisplayMedia`
   exists but shows a system surface picker instead of offering this tab. Record which
   browsers offered a picker and whether the crop still landed correctly. Then restart Chrome, export and
   re-import bookmarks, and — if a second signed-in device exists — confirm the
   bookmarklet arrives intact. Record the largest encoded length that survives.
3. **Claude artifact frame topology.** Open one of your own published artifacts, run
   `[...document.querySelectorAll('iframe')].map(f => ({ src: f.src, sandbox: f.getAttribute('sandbox') }))`
   in DevTools, and record whether the artifact document is cross-origin. Then open
   that document as the top-level page and click the bookmarklet there.

If check 1 or 2 fails, delivery switches to the ~1 KB loader plus SRI-pinned payload
and Task 1 is revised — the capture core is unaffected by design.

- [ ] **Step 7: CI workflow**

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm }
      - run: npm ci                       # requires the committed package-lock.json
      - run: npm run lint && npm run typecheck && npm run test
      # Browser provisioning is a bootstrap prerequisite, not part of the test run.
      # The "offline" guarantee covers the tests themselves: once chromium is present,
      # no test reaches the network. A runner without it fails here, loudly and early.
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e -- --grep-invert @live
```

- [ ] **Step 8: Final verification, then commit and (with explicit authorization) push**

Run: `npm run lint && npm run format && npm run typecheck && npm run test && npm run build && npm run test:e2e`
Expected: all green, and the build's printed payload size within half the Spike 1
envelope. Then run the release-only check once, online:
`npm run test:e2e -- --grep @live`.

---

## Self-review notes

- **Spec coverage:** §3 artifact flow → Task 10 Step 9, Task 12 README and
  manual-checks doc. §4 trust → Task 8 (both branches: restricted run-once and the
  trusted Standard/Deep choice). §5 modes → Task 8 `gate()` returning a mode.
  §6.1 fields → Task 4 (env, geometry, box model, **scroll offsets**, layout context,
  stacking to the **nearest ancestor stacking context**), Task 5 (pseudo-elements, interaction states,
  media conditions), Task 6 (computed styles, tokens with definition sites,
  typography). §6.2 Deep → Task 11, including rule **specificity** and origin sheet.
  §6.3 output formats → Task 10 (`markdown.ts` plus the three-button panel).
  §6.4 exclusions → Task 2 (scheme allowlist, bounded text-node walk with forbidden
  subtrees) plus the Task 12 standing gate. §6.5 omissions → threaded through
  `CaptureContext` from Task 2, with `unsupported-selector` and `blocked-scheme`
  added for the cases the parser and the URL guard decline to handle. §7 screenshot → Task 9. §8 CSP rules → Task 1 lint
  ban plus Task 7 builder plus the Task 7 strict-CSP test. §9 browser support →
  Task 9 feature detection. §11 payload envelope → Task 1 size test plus Spike 1.
  §12 provenance → Tasks 1 and 12.
- **Offline by default:** every suite except the single `@live` test in Task 10 runs
  with no network — committed fixtures, a zero-dependency `node:http` server, and a
  second origin obtained by binding `127.0.0.1:8082` rather than by reaching a CDN.
  CI excludes `@live`, so a push never sends traffic anywhere and cannot go red
  because an external host is down.
- **No two-step remains.** The earlier draft had Task 5 (styles) read declared values
  that only Task 6 (rules) could supply properly. The two are now swapped: rules and
  the selector parser land first, and `captureStyles` takes `MatchedRules` as an
  argument rather than guessing. Custom-property definition sites are read from the
  winning declaration, which is the only correct route — comparing computed values
  across ancestors cannot work, because custom properties inherit.
- **Two seams exist purely for testability**, and neither ships behaviour:
  `__EXPOSE_TEST_HOOK__` (compile-time, dead-code-eliminated from the release bundle)
  and `screenshot`'s optional `streamFactory` (defaulted to the real
  `getDisplayMedia`). Both are pinned by tests that assert their absence or default.
- **What automation cannot cover** is enumerated in `docs/phase-0-manual-checks.md`
  rather than silently assumed: a real `javascript:` bookmarklet click under a strict
  CSP, cross-browser and bookmark-sync survival, and the Claude artifact frame
  topology. No test in this plan claims any of the three.
- **Type consistency:** `CaptureContext.omit(field, reason, detail?)` is the single
  omission channel in every task. `visibleText` and `pickAttributes` both take it, so
  a refusal is always recorded rather than silently dropping a field. `reducedUrl`
  takes an explicit `base` so nothing depends on a global `location`. `captureStyles`
  takes `MatchedRules`. `toMarkdown` takes `CaptureV1` and returns `string` — no
  context, no DOM, no second capture path. `Locator.confidence` is `'exact' | 'ambiguous' |
  'unverified'` everywhere. `Screenshot.scale` is the video-derived scale, never DPR.
