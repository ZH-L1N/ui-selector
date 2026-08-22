// src/trust.ts — origin classification and the run-once confirmation dialog.
//
// Trust is decided by PARSED URL comparison, never by substring matching: with
// substrings, `https://skill-shelf.pages.dev.evil.tld` and
// `https://x.skill-shelf.pages.dev` both read as trusted. Those two cases have unit
// tests precisely because that is the mistake this file exists to not make.
//
// The dialog cannot promote an origin to trusted (spec §4). Promotion happens only by
// editing the local config and rebuilding, so the dialog offers exactly two outcomes:
// run once with restricted caps, or nothing. Nothing is written to localStorage,
// sessionStorage, cookies, IndexedDB, or Cache Storage on any path here — trust state
// lives in a local variable for the lifetime of one invocation.
import type { CaptureMode, TrustLevel } from './types'
import { el, host } from './ui/dom'

export interface GateDecision {
  trust: TrustLevel
  mode: CaptureMode
}

// The port is ignored ONLY for loopback, where a dev server's port changes run to
// run and pinning it would make the config useless. Every other host must match its
// port exactly.
const LOOPBACK = new Set(['localhost', '127.0.0.1'])

// Sensitive hosts (spec §3): pages that carry the user's conversation text.
// NEVER trusted, not even from the user's own baked config — a config entry is
// ignored here by construction, so the restricted text cap applies and Deep
// mode stays locked (capture() disables Deep for any non-trusted context).
// Subdomains are covered too: the shell can live on more than one label.
const SENSITIVE_HOSTS = new Set(['claude.ai'])

export function isSensitiveHost(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false
  }
  for (const s of SENSITIVE_HOSTS) {
    if (host === s || host.endsWith(`.${s}`)) return true
  }
  return false
}

export function classify(origin: string, trusted: string[]): 'trusted' | 'unknown' {
  let page: URL
  try {
    page = new URL(origin)
  } catch {
    return 'unknown'
  }
  if (isSensitiveHost(origin)) return 'unknown'  // a config entry cannot promote it
  for (const entry of trusted) {
    let candidate: URL
    try {
      candidate = new URL(entry)
    } catch {
      continue                                  // a malformed config entry trusts nothing
    }
    if (candidate.protocol !== page.protocol) continue
    if (candidate.hostname !== page.hostname) continue     // exact host, never a suffix
    if (LOOPBACK.has(page.hostname)) return 'trusted'
    if (candidate.port !== page.port) continue
    return 'trusted'
  }
  return 'unknown'
}

const PANEL: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '50%',
  top: '32px',
  transform: 'translateX(-50%)',
  boxSizing: 'border-box',
  maxWidth: '30rem',
  padding: '16px 18px',
  borderRadius: '10px',
  border: '1px solid #cfd8d5',
  background: '#ffffff',
  color: '#12211e',
  font: '14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
  // The host container is pointer-events: none so the page keeps its own events;
  // the panel opts back in because its buttons must be clickable.
  pointerEvents: 'auto',
}

const TITLE: Partial<CSSStyleDeclaration> = {
  margin: '0 0 8px',
  font: '600 15px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
}

const NOTE: Partial<CSSStyleDeclaration> = { margin: '0 0 6px', color: '#3c534e' }
const ROW: Partial<CSSStyleDeclaration> = { display: 'flex', gap: '8px', marginTop: '12px' }

function button(text: string, attrs: Record<string, string>, primary: boolean): HTMLButtonElement {
  return el('button', {
    text,
    attrs: { type: 'button', ...attrs },
    style: {
      font: 'inherit',
      padding: '6px 12px',
      borderRadius: '6px',
      cursor: 'pointer',
      border: primary ? '1px solid #0a7766' : '1px solid #cfd8d5',
      background: primary ? '#0a7766' : '#ffffff',
      color: primary ? '#ffffff' : '#12211e',
    },
  })
}

function br(): Text {
  // A newline between blocks so the closed root's textContent reads as lines rather
  // than one run-on string. Purely for legibility of dialogText() in tests and logs.
  return document.createTextNode('\n')
}

// The live dialog's closed shadow root, so a test can read and drive UI it cannot
// reach with querySelector. Production never calls this.
let activeRoot: ShadowRoot | null = null
export function activeDialogRoot(): ShadowRoot | null {
  return activeRoot
}

export function gate(trusted: string[], origin: string = location.origin): Promise<GateDecision | null> {
  const level = classify(origin, trusted)
  // location.origin is the string "null" on an opaque origin (a sandboxed document),
  // where new URL() throws. Fall back to the raw string rather than taking the whole
  // tool down over a label.
  let hostname = origin
  try {
    hostname = new URL(origin).hostname
  } catch {
    hostname = origin
  }
  const ui = host()
  activeRoot = ui.root

  return new Promise<GateDecision | null>(resolve => {
    let mode: CaptureMode = 'standard'          // trusted origins DEFAULT to standard

    const finish = (decision: GateDecision | null): void => {
      document.removeEventListener('keydown', onKeyDown, true)
      ui.destroy()
      activeRoot = null
      resolve(decision)
    }

    function onKeyDown(event: Event): void {
      if ((event as KeyboardEvent).key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finish(null)
    }

    const cancel = button('Cancel', { 'data-act': 'cancel' }, false)
    cancel.addEventListener('click', () => finish(null))

    let panel: HTMLElement
    if (level === 'trusted') {
      const standard = button('Standard', { 'data-mode': 'standard', 'aria-pressed': 'true' }, true)
      const deep = button('Deep', { 'data-mode': 'deep', 'aria-pressed': 'false' }, false)
      const select = (next: CaptureMode): void => {
        mode = next
        for (const [node, name] of [[standard, 'standard'], [deep, 'deep']] as const) {
          const on = name === next
          node.setAttribute('aria-pressed', String(on))
          node.style.background = on ? '#0a7766' : '#ffffff'
          node.style.color = on ? '#ffffff' : '#12211e'
          node.style.border = on ? '1px solid #0a7766' : '1px solid #cfd8d5'
        }
      }
      standard.addEventListener('click', () => select('standard'))
      deep.addEventListener('click', () => select('deep'))
      const proceed = button('Proceed', { 'data-act': 'proceed' }, true)
      proceed.addEventListener('click', () => finish({ trust: 'trusted', mode }))

      panel = el('div', { attrs: { role: 'dialog', 'aria-modal': 'false' }, style: PANEL }, [
        el('div', { text: `Capture on ${hostname}`, style: TITLE }),
        br(),
        el('div', { text: `${origin} is a trusted origin in this build.`, style: NOTE }),
        br(),
        el('div', { text: 'Choose a capture mode. Standard is selected.', style: NOTE }),
        br(),
        el('div', { style: ROW }, [standard, deep]),
        br(),
        el('div', {
          text: 'Standard captures the design brief. Deep adds the sanitized subtree, matched rules with specificity, keyframes, and asset metadata.',
          style: { ...NOTE, marginTop: '10px' },
        }),
        br(),
        el('div', { style: ROW }, [proceed, cancel]),
      ])
    } else {
      const runOnce = button('Run once', { 'data-act': 'run-once' }, true)
      runOnce.addEventListener('click', () => finish({ trust: 'restricted', mode: 'standard' }))

      // Wording is contract, not copy: this dialog must never suggest a persistent
      // decision, because there is no mechanism to make one (spec §4).
      panel = el('div', { attrs: { role: 'dialog', 'aria-modal': 'false' }, style: PANEL }, [
        el('div', { text: `Run once on ${hostname}?`, style: TITLE }),
        br(),
        el('div', {
          // On a sensitive host the "not in your list" line could be FALSE (the
          // user may well have listed it); say why the downgrade happened instead.
          text: isSensitiveHost(origin)
            ? `${origin} is a sensitive host (it can carry conversation text), so capture always runs restricted here. A config entry cannot promote it.`
            : `${origin} is not in the origin list baked into this build.`,
          style: NOTE,
        }),
        br(),
        el('div', {
          text: 'Restricted capture: visible text is capped at 80 characters. Deep mode unavailable.',
          style: NOTE,
        }),
        br(),
        el('div', {
          text: 'This decision covers one run and is not written to disk, storage, or cookies. To change it, edit the local config and rebuild.',
          style: NOTE,
        }),
        br(),
        el('div', { style: ROW }, [runOnce, cancel]),
      ])
    }

    ui.root.appendChild(panel)
    document.addEventListener('keydown', onKeyDown, true)
  })
}
