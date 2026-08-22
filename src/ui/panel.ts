// src/ui/panel.ts — the preview panel: JSON preview, screenshot canvas,
// omissions list, Copy JSON / Copy as prompt / Download.
//
// The panel is the privacy affordance: the user sees exactly what leaves the
// page before it leaves. It renders in a CLOSED shadow root via the dom.ts
// builders only — no innerHTML, no injected <style> tag, no <img src="blob:">
// (the screenshot paints into a <canvas> we own, which img-src cannot block).
import type { Screenshot } from '../shot'
import type { CaptureV1 } from '../types'
import { el, host } from './dom'
import { toMarkdown } from './markdown'

export interface PanelHooks {
  // Provided by boot when getDisplayMedia exists. The capture must originate
  // from the click on the screenshot control itself, so transient user
  // activation is live (spec §7) — which is why this is a callback wired to a
  // button, not a shot taken up front. Null disables the control.
  takeScreenshot?: (() => Promise<Screenshot | null>) | null
  onClose?: () => void
}

const PANEL: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  right: '16px',
  top: '16px',
  boxSizing: 'border-box',
  width: 'min(480px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  padding: '16px 18px',
  borderRadius: '10px',
  border: '1px solid #cfd8d5',
  background: '#ffffff',
  color: '#12211e',
  font: '13px/1.5 system-ui, -apple-system, Segoe UI, sans-serif',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
  // The host container is pointer-events: none; the panel opts back in.
  pointerEvents: 'auto',
}

const HEADING: Partial<CSSStyleDeclaration> = {
  margin: '0 0 8px',
  font: '600 15px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
}

const PRE: Partial<CSSStyleDeclaration> = {
  margin: '8px 0',
  padding: '8px',
  maxHeight: '40vh',
  overflow: 'auto',
  borderRadius: '6px',
  border: '1px solid #e4eae8',
  background: '#f6f8f7',
  font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre',
  userSelect: 'text',
}

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

// The live panel's closed shadow root, so a test can read and drive UI it
// cannot reach with querySelector. Production never calls this.
let activeRoot: ShadowRoot | null = null
export function activePanelRoot(): ShadowRoot | null {
  return activeRoot
}

// Momentary button feedback without timers competing over shared state.
function flash(node: HTMLButtonElement, message: string): void {
  const original = node.textContent
  node.textContent = message
  setTimeout(() => { node.textContent = original }, 1500)
}

export function showPanel(result: CaptureV1, shot: Screenshot | null, hooks: PanelHooks = {}): void {
  const ui = host()
  activeRoot = ui.root

  const close = (): void => {
    document.removeEventListener('keydown', onKeyDown, true)
    ui.destroy()
    activeRoot = null
    hooks.onClose?.()
  }
  function onKeyDown(event: Event): void {
    if ((event as KeyboardEvent).key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    close()
  }

  const json = (): string => JSON.stringify(result, null, 2)

  const pre = el('pre', { text: json(), style: PRE, attrs: { 'data-panel': 'json' } })

  // Our own canvas, painted from the shot's canvas. Never <img src="blob:">.
  const canvas = el('canvas', {
    style: { display: 'none', maxWidth: '100%', borderRadius: '6px', border: '1px solid #e4eae8' },
  })
  const paint = (s: Screenshot): void => {
    canvas.width = s.canvas.width
    canvas.height = s.canvas.height
    canvas.getContext('2d')?.drawImage(s.canvas, 0, 0)
    canvas.style.display = 'block'
  }

  const omissionsList = el('ul', {
    style: { margin: '4px 0 8px', paddingLeft: '18px', color: '#3c534e' },
    attrs: { 'data-panel': 'omissions' },
  })
  const renderOmissions = (): void => {
    omissionsList.textContent = ''
    if (result.omissions.length === 0) {
      omissionsList.appendChild(el('li', { text: 'Nothing was omitted.' }))
      return
    }
    for (const o of result.omissions) {
      omissionsList.appendChild(
        el('li', { text: `${o.field} — ${o.reason}${o.detail ? ` (${o.detail})` : ''}` }))
    }
  }
  renderOmissions()

  // Screenshot omissions recorded after assembly land in result.omissions (it
  // is the context's live array), so refresh the JSON and the list together.
  const refresh = (): void => {
    pre.textContent = json()
    renderOmissions()
  }

  const copyJson = button('Copy JSON', { 'data-act': 'copy-json' }, true)
  copyJson.addEventListener('click', () => {
    navigator.clipboard.writeText(json()).then(
      () => flash(copyJson, 'Copied'),
      () => flash(copyJson, 'Copy failed'),
    )
  })

  const copyPrompt = button('Copy as prompt', { 'data-act': 'copy-prompt' }, false)
  copyPrompt.addEventListener('click', () => {
    navigator.clipboard.writeText(toMarkdown(result)).then(
      () => flash(copyPrompt, 'Copied'),
      () => flash(copyPrompt, 'Copy failed'),
    )
  })

  const download = button('Download', { 'data-act': 'download' }, false)
  download.addEventListener('click', () => {
    // An object URL on an <a download> triggers a download, not a navigation,
    // so default-src does not block it (verified against strict-csp.html in
    // flow.spec.ts). Revoked immediately after the click.
    const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }))
    const a = el('a', { attrs: { href: url, download: 'ui-selector-capture.json' } })
    a.click()
    URL.revokeObjectURL(url)
  })

  const buttons: HTMLElement[] = [copyJson, copyPrompt, download]

  const shoot = button('Screenshot', { 'data-act': 'screenshot' }, false)
  if (hooks.takeScreenshot) {
    const take = hooks.takeScreenshot
    shoot.addEventListener('click', () => {
      shoot.disabled = true
      void take().then(s => {
        shoot.disabled = false
        if (s) paint(s)
        refresh()                    // user-declined / clipped omissions show up
      })
    })
  } else {
    shoot.disabled = true
    shoot.style.opacity = '0.5'
    shoot.style.cursor = 'default'
    shoot.title = 'Screenshot unavailable: getDisplayMedia is not supported here'
  }
  buttons.push(shoot)

  const closeBtn = button('Close', { 'data-act': 'close' }, false)
  closeBtn.addEventListener('click', close)
  buttons.push(closeBtn)

  const panel = el('div', { attrs: { role: 'dialog', 'aria-modal': 'false' }, style: PANEL }, [
    el('div', {
      text: `Captured <${result.element.tagName.toLowerCase()}> — ${result.locator.selector}`,
      style: HEADING,
    }),
    canvas,
    el('div', { text: 'Not captured:', style: { margin: '6px 0 0', fontWeight: '600' } }),
    omissionsList,
    pre,
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, buttons),
  ])

  if (shot) paint(shot)
  ui.root.appendChild(panel)
  document.addEventListener('keydown', onKeyDown, true)
}
