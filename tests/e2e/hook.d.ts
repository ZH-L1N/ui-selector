// Types for the window.__uiSelectorTest hook that dist/ui-selector.test.js exposes.
// Later tasks extend this surface as they add functions to the hook.
import type {
  CaptureContext, CaptureMode, CaptureV1, DeepBundle, EnvContext, LayoutContext, Locator,
  MatchedRules, PseudoBundle, StyleBundle, TrustLevel,
} from '../../src/types'
import type { Omission } from '../../src/types'
import type { Screenshot, ShotOptions } from '../../src/shot'
import type { GateDecision } from '../../src/trust'

declare global {
  interface Window {
    __uiSelectorTest: {
      ctx(mode?: CaptureMode, trust?: TrustLevel): CaptureContext
      visibleText(el: Element, trust: TrustLevel, ctx: CaptureContext): string | null
      pickAttributes(el: Element, ctx: CaptureContext): Record<string, string>
      reducedUrl(raw: string, base: string): string
      locate(el: Element): Locator
      captureEnv(): EnvContext
      captureLayout(el: Element, ctx: CaptureContext): LayoutContext
      matchedRules(el: Element, ctx: CaptureContext): MatchedRules
      capturePseudo(el: Element, ctx: CaptureContext): { before?: PseudoBundle; after?: PseudoBundle }
      captureStyles(el: Element, rules: MatchedRules, ctx: CaptureContext): StyleBundle
      capture(el: Element, ctx: CaptureContext): CaptureV1
      captureDeep(el: Element, ctx: CaptureContext): DeepBundle
      runHeadless(selector: string, mode?: CaptureMode, trust?: TrustLevel): CaptureV1
      toMarkdown(result: CaptureV1): string
      showPanel(result: CaptureV1, shot: Screenshot | null): void
      pick(): Promise<Element | null>
      gate(): Promise<GateDecision | null>
      dialogText(): string
      clickRunOnce(): void
      clickProceed(): void
      chooseMode(mode: CaptureMode): void
      panelText(): string
      clickPanel(selector: string): void
      screenshot(el: Element, ctx: CaptureContext, opts?: ShotOptions): Promise<Screenshot | null>
    }
    // Test-only globals installed by tests/e2e/shot-helpers.ts and shot.html.
    // `marker` plants a magenta 12x12 square at a SOURCE coordinate so the crop's
    // source offset — not just its size — is assertable.
    __mkStream(scaleFactor: number, marker?: { x: number; y: number }): { stream: MediaStream; stop(): void }
    __shotTarget?: string
    __shotResult?: Screenshot | null
    __shotOmissions?: Omission[]
  }
}

export {}
