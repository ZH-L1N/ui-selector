// src/capture/env.ts — viewport, DPR, theme, color-scheme.
//
// Everything is read through `window.*` explicitly (never bare globals): the
// unit-test environment installs a JSDOM window on globalThis.window only, and
// in a browser the two are the same object anyway.
import { THEME_ATTRIBUTES } from '../allowlists'
import type { EnvContext } from '../types'

function prefers(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

export function captureEnv(): EnvContext {
  const prefersColorScheme: EnvContext['prefersColorScheme'] =
    prefers('(prefers-color-scheme: dark)') ? 'dark'
    : prefers('(prefers-color-scheme: light)') ? 'light'
    : 'no-preference'

  let colorScheme = ''
  try {
    colorScheme = window.getComputedStyle(document.documentElement).getPropertyValue('color-scheme')
  } catch {
    colorScheme = ''
  }

  // The theme signal on <html>: the class list plus the CLOSED theme-key list.
  // Never a bare data-* prefix — application/user state hides in other root
  // data-* attributes (data-user-id, data-csrf-token …), the same reason the
  // attribute allowlist admits no data-* except data-testid.
  const themeAttributes: Record<string, string> = {}
  for (const attr of Array.from(document.documentElement.attributes)) {
    if ((THEME_ATTRIBUTES as readonly string[]).includes(attr.name)) themeAttributes[attr.name] = attr.value
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    prefersColorScheme,
    colorScheme,
    themeAttributes,
  }
}
