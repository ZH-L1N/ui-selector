// src/allowlists.ts — the deny-by-default tables. A field reaches the output only
// if a table here names it. These lists are CLOSED, not illustrative: widening one
// without routing new URL-bearing entries through reducedUrl is exactly the leak
// the scheme guard was written to stop.

export const ATTRIBUTE_ALLOWLIST = [
  'class', 'id', 'role', 'type', 'alt', 'title', 'placeholder', 'lang', 'dir',
  'href', 'src',                      // the only two URL-bearing entries
  'width', 'height', 'loading', 'decoding',
] as const
export const REDUCED_URL_ATTRIBUTES = ['href', 'src'] as const

// Deliberately EXCLUDED, each for a reason: `value`, `checked`, `selected`
// (user data); `name` (a form-field identifier, not a design fact); `action`,
// `formaction`, `ping`, `target` (form/navigation behaviour, and more URL surface
// for no design benefit); `srcset`, `poster`, `background`, `data`, `longdesc`,
// `cite` (URL-bearing and not needed in Standard — `poster` and `background-image`
// reappear only inside Deep's asset collector, which reduces them); anything
// `password`-related; every `on*` handler; every `data-*` except `data-testid`
// (application state hides there).

// ARIA attributes are allowlisted individually, never by prefix. Deliberately
// EXCLUDED: `aria-checked`, `aria-selected`, `aria-pressed`, `aria-valuenow`,
// `aria-valuetext` — on custom widgets (role=checkbox/slider/option …) these
// mirror the user's LIVE form value, the same data class the native `value` /
// `checked` / `selected` exclusions above guard (spec §6.4). Their styling role
// is judged not worth the leak: a role=slider's aria-valuetext is an arbitrary
// user-facing string ("$750,000"). `aria-valuemin`/`aria-valuemax` stay — they
// are widget configuration, not the chosen value.
export const ARIA_ATTRIBUTE_ALLOWLIST = [
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
  'aria-expanded', 'aria-disabled', 'aria-haspopup', 'aria-current',
  'aria-modal', 'aria-live', 'aria-orientation', 'aria-invalid',
  'aria-required', 'aria-readonly', 'aria-busy', 'aria-level',
  'aria-valuemin', 'aria-valuemax',
] as const

// The theme signal on <html>, as a CLOSED key list — not a data-* prefix:
// frameworks stamp application/user state into other root data-* attributes
// (data-user-id, data-csrf-token, data-ab-bucket …), and spec §6.1 scopes env
// to "the theme class/attribute on <html>". Same rationale as excluding
// data-* from the attribute allowlist above.
export const THEME_ATTRIBUTES = [
  'class', 'data-theme', 'data-mode', 'data-color-mode', 'data-color-scheme',
  'data-bs-theme', 'data-light-theme', 'data-dark-theme', 'data-appearance',
] as const

// Subtrees whose text is never design content: form controls (user data), source
// text, and inert containers. BUTTON is deliberately absent: a button's own label
// is a design fact we want.
export const TEXT_FORBIDDEN_TAGS = new Set([
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP',
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS',
])

// The computed-style design table (~60 properties): box, typography, color,
// border, shadow, transform, transition, overflow — per spec §6.1. This table
// DOES contain url()-capable properties (cursor, filter, backdrop-filter), so
// every captured style value is routed through reduceCssUrls in sanitize.ts —
// the earlier claim that no URL-bearing property appears here was false and
// leaked signed query strings. background-image stays out of the table; Deep's
// asset collector reduces it separately.
export const STYLE_PROPERTIES = [
  // box / position
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'box-sizing', 'margin', 'padding',
  // flex / grid container and item
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'gap', 'flex', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
  'grid-area', 'align-self', 'justify-self', 'order',
  // typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-transform', 'text-decoration',
  'text-overflow', 'white-space', 'word-break', 'vertical-align',
  'font-feature-settings',
  // color
  'color', 'background-color', 'opacity',
  // border / outline
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'outline', 'outline-offset',
  // shadow
  'box-shadow', 'text-shadow',
  // transform
  'transform', 'transform-origin',
  // transition / animation
  'transition', 'animation',
  // overflow and rendering state
  'overflow-x', 'overflow-y', 'visibility', 'cursor', 'pointer-events',
  'object-fit', 'aspect-ratio', 'filter', 'backdrop-filter',
] as const

export const CAPS = {
  ancestryDepth: 5,
  textTrusted: 200,
  textRestricted: 80,
  textNodeVisits: 500,
  deepNodes: 200,
  deepChars: 20_000,
  deepAssets: 20,
} as const
