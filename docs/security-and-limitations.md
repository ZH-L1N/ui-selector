# Security and limitations

`ui-selector` is code you build locally and run inside a page's JavaScript context. Its
security contract protects the text you inspect and choose to share; it does not turn a
bookmarklet into a browser sandbox.

## Trust model

The bookmarklet has three trust states and no runtime trust promotion:

| State          | How it is reached                                                                             | Capabilities                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Trusted**    | The exact origin is present in the gitignored config baked into the bookmarklet at build time | Standard mode; Deep mode may be selected per run                                                 |
| **Restricted** | The user confirms a run once on an unknown origin                                             | Standard mode with tighter text caps; screenshot remains an explicit action; Deep is unavailable |
| **Refused**    | The user dismisses the prompt with Cancel or Escape                                           | Nothing runs and the tool tears down                                                             |

The run-once prompt cannot make an origin trusted. Promotion requires editing
`selector.config.json` and rebuilding the bookmarklet.

Origins are parsed and compared exactly. Protocol, hostname, and port must match, except that
loopback origins ignore the port so local development servers remain usable. Suffix or
substring matching is deliberately unavailable: trusting `https://example.com` does not
trust `https://example.com.evil.tld` or `https://x.example.com`.

`claude.ai` and its subdomains are sensitive hosts enforced in code. They are always treated
as unknown even when the local config lists them, so they remain restricted and cannot use
Deep mode.

The generated `dist/install.html` displays the trusted-origin list embedded in that build.
The self-contained bookmarklet has no runtime update path, so rebuilding and reinstalling is
required after any source or trust-config change.

## Output policy

A field reaches `CaptureV1` only when an allowlist in
[`src/allowlists.ts`](../src/allowlists.ts) names it. The same sanitized object feeds both
output formats:

- JSON is the canonical `CaptureV1` representation.
- Markdown is produced by the pure `toMarkdown(result: CaptureV1)` function and never reads
  the DOM.

Every emitted URL surface, including stylesheet provenance and URLs inside CSS values, is
restricted to `http`/`https` and reduced to origin plus pathname. Query strings, hashes, and
credentials are removed.

## Data never captured

Neither Standard nor Deep mode captures:

- cookies or values from localStorage, sessionStorage, IndexedDB, or Cache Storage;
- form state such as `value`, `checked`, or `selectedIndex`;
- React, Vue, or Svelte runtime state and props;
- URL query parameters or hashes;
- `contenteditable` text;
- password-type data.

The tool does not write to storage APIs, cookies, or the page. Output leaves the browser only
after the user chooses Copy or Download.

Text is dropped from suppressed and inert subtrees when any ancestor makes it inaccessible.
The forbidden set includes `display:none`, `[hidden]`, `script`, `style`, `template`,
`noscript`, `iframe`, `object`, `embed`, `canvas`, and form controls.

[`tests/e2e/redaction.spec.ts`](../tests/e2e/redaction.spec.ts) is the standing privacy gate.
Its fixture seeds cookies, form values, editable text, script/style text, hidden content,
unsafe URL schemes, storage, and a query string. It captures the seeded card and every
descendant in Standard and Deep mode, as JSON and Markdown, and asserts that no seed appears.

## Threat model

### A hostile page

A bookmarklet executes after the page has full control of its own realm. A malicious page can
replace built-ins such as `getComputedStyle`, `Element.prototype.matches`,
`document.styleSheets`, or `JSON.stringify`; observe that the tool ran; and intercept what a
Copy button writes to the clipboard.

The closed shadow root prevents the page's CSS and ordinary selectors from interfering with
the tool's interface. It is not a security boundary against script that already owns the
realm. Do not run `ui-selector` on a page you believe is actively hostile. The run-once prompt
is a deliberate decision point, not a sandbox.

### Screenshot surface

Screenshots require an explicit click on the panel's Screenshot control, which calls
`getDisplayMedia` while live user activation is present. The browser or operating system then
shows its own surface picker.

The crop is trustworthy only when the selected surface is the current browser tab. A window
or screen frame places the viewport at an unknowable offset. The implementation verifies a
browser surface and compatible aspect ratio; otherwise it records an omission and produces no
image. Choose the capture surface deliberately.

The selected frame is painted into a canvas owned by the tool, displayed locally, and
discarded when the panel closes. Screenshot bytes never enter `CaptureV1`, JSON, or Markdown.

### Bookmarklet payload

`dist/bookmarklet.txt` and `dist/install.html` embed the trusted-origin list in plain text.
There are no credentials in the payload and no runtime network path, but private hostnames can
still be sensitive. Do not commit personal builds or their capture output.

### After capture

A sanitized design brief still describes a UI. The tool's responsibility ends when the user
copies or downloads the output. Review the panel before sharing it and apply the receiving
system's own data-handling policy.

## Browser, document, and capture boundaries

### Browser support

- Chrome and Chromium are the supported v1 target.
- Safari selection, capture, JSON, and Markdown are best-effort. Safari offers window and
  screen surfaces rather than the tab surface required for screenshot cropping, so screenshot
  attempts correctly end in `wrong-capture-surface`.
- Firefox is best-effort and currently untested.

### Shadow DOM

Selection can resolve an open-shadow child through `composedPath`. Text and subtree walks stop
at the shadow host and record `shadow-boundary`; capture does not cross a shadow boundary in
either direction. A closed shadow host is indistinguishable from an element with no accessible
shadow root and is therefore silent.

### Frames and Claude artifacts

A bookmarklet runs in the top document and cannot inject itself into child frames. Selecting a
frame records `frame-content-unreachable` rather than returning a confidently incomplete
brief.

Claude artifacts are not supported. A published artifact is nested across three documents:

```text
claude.ai
  └─ <uuid>.frame.claudeusercontent.com
       └─ iframe.ready
```

Directly opening the intermediate or inner URL does not make the artifact contents reachable,
and every artifact uses a different random subdomain. Exact origin matching intentionally
rules out a wildcard trust workaround. Reaching inside those frames requires an extension
with all-frames injection, which is outside this bookmarklet's scope.

### CSS evidence

Deep mode reports matched CSS rules with specificity, source sheet, declaration importance,
and the observed at-rule condition stack. It does not resolve the full cascade: layer order,
cross-layer `!important`, and `@scope` proximity remain unresolved. `@container` and `@scope`
blocks are skipped with an `unsupported-at-rule` omission.

Cross-origin stylesheets may make `sheet.cssRules` throw `SecurityError`; this degrades to a
`cross-origin-stylesheet` omission. The capture provides evidence, not a claim that it has
reimplemented browser style resolution.

### Reconstruction fidelity

The current capture boundary describes the selected element, not a per-child reconstruction
of its descendants. Text and control leaf elements perform strongly in the first measured
actionability run, while selected containers can omit visually essential child structure and
styles. See [`docs/actionability.md`](./actionability.md) for the method, the 8/12 overall
result, and the ranked v1.1 gaps.
