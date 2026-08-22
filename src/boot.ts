// src/boot.ts — entry: single-instance guard, trust gate, selection, teardown.
import { capture } from './capture'
import { captureDeep } from './capture/deep'
import { captureEnv } from './capture/env'
import { captureLayout } from './capture/layout'
import { capturePseudo } from './capture/pseudo'
import { matchedRules } from './capture/rules'
import { captureStyles } from './capture/styles'
import { locate } from './locate'
import { pick } from './pick'
import { pickAttributes, reducedUrl, visibleText } from './sanitize'
import type { Screenshot } from './shot'
import { screenshot } from './shot'
import { activeDialogRoot, gate } from './trust'
import type { CaptureMode, CaptureV1, TrustLevel } from './types'
import { makeContext } from './types'
import { toMarkdown } from './ui/markdown'
import { activePanelRoot, showPanel } from './ui/panel'

declare const __TRUSTED_ORIGINS__: string[]
declare const __EXPOSE_TEST_HOOK__: boolean

const GUARD = '__uiSelectorActive__'
type W = Window & { [GUARD]?: boolean; __uiSelectorTest?: unknown }

// Teardown is only the guard: every UI surface owns its own destroy(), and no state
// is written anywhere else — not storage, not cookies, not the page's DOM.
function teardown(): void {
  delete (window as W)[GUARD]
}

// Test-only drivers for UI that lives in a CLOSED shadow root, where a Playwright
// locator cannot reach. Dead-code-eliminated from the release bundle along with the
// whole __EXPOSE_TEST_HOOK__ branch.
function clickInDialog(selector: string): void {
  activeDialogRoot()?.querySelector<HTMLElement>(selector)?.click()
}

// The ONE capture path, drivable without any UI: the flow test and the standing
// redaction gate both go through here, so they exercise exactly what the real
// flow assembles — not a hand-rolled subset.
function runHeadless(selector: string, mode?: CaptureMode, trust?: TrustLevel): CaptureV1 {
  const target = document.querySelector(selector)
  if (!target) throw new Error(`runHeadless: nothing matches ${selector}`)
  return capture(target, makeContext(mode, trust))
}

function displayCaptureSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

async function main(): Promise<void> {
  const w = window as W
  if (w[GUARD]) return
  w[GUARD] = true
  if (__EXPOSE_TEST_HOOK__) {
    w.__uiSelectorTest = {
      ctx: (mode?: CaptureMode, trust?: TrustLevel) => makeContext(mode, trust),
      visibleText,
      pickAttributes,
      reducedUrl,
      locate,
      captureEnv,
      captureLayout,
      matchedRules,
      capturePseudo,
      captureStyles,
      capture,
      captureDeep,
      runHeadless,
      toMarkdown,
      showPanel,
      pick,
      screenshot,
      gate: () =>
        gate(__TRUSTED_ORIGINS__).then(decision => {
          if (!decision) teardown()
          return decision
        }),
      dialogText: () => activeDialogRoot()?.textContent ?? '',
      clickRunOnce: () => clickInDialog('[data-act="run-once"]'),
      clickProceed: () => clickInDialog('[data-act="proceed"]'),
      chooseMode: (mode: CaptureMode) => {
        clickInDialog(`[data-mode="${mode}"]`)
        clickInDialog('[data-act="proceed"]')
      },
      panelText: () => activePanelRoot()?.textContent ?? '',
      clickPanel: (selector: string) =>
        activePanelRoot()?.querySelector<HTMLElement>(selector)?.click(),
    }
    // The test bundle exposes the surface and stops here. Running the real flow on
    // load would put a trust dialog in front of every single e2e test.
    return
  }

  const decision = await gate(__TRUSTED_ORIGINS__)
  if (!decision) {
    teardown()
    return
  }
  const target = await pick()
  if (!target) {
    teardown()
    return
  }

  const ctx = makeContext(decision.mode, decision.trust)
  const result = capture(target, ctx)

  // The screenshot control is disabled — with the omission recorded — when
  // getDisplayMedia is absent (spec §7). When present, the capture originates
  // from the click on the panel's screenshot control itself, so transient user
  // activation is live; screenshot() records its own omissions on refusal.
  let takeScreenshot: (() => Promise<Screenshot | null>) | null = null
  if (displayCaptureSupported()) {
    takeScreenshot = async () => {
      try {
        return await screenshot(target, ctx)
      } catch {
        // screenshot() rethrows only on an unexpected in-crop failure (after
        // stopping tracks). Record the absence rather than crashing the panel.
        ctx.omit('screenshot', 'unsupported-browser', 'unexpected failure during crop')
        return null
      }
    }
  } else {
    ctx.omit('screenshot', 'unsupported-browser', 'getDisplayMedia unavailable')
  }

  showPanel(result, null, { takeScreenshot, onClose: teardown })
}

main().catch(() => teardown())
