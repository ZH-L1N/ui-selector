// src/ui/markdown.ts — toMarkdown(CaptureV1) -> prompt-ready Markdown.
//
// A PURE function of the already-sanitized CaptureV1 object. It never reads the
// DOM, references no global except its argument, and imports nothing from
// src/capture/** — that is what makes Markdown inherit every redaction
// guarantee for free (spec §6.3), and a Proxy-based purity test pins it.
import type { CaptureV1 } from '../types'

const round = (n: number): number => Math.round(n * 100) / 100

function box(b: { top: number; right: number; bottom: number; left: number }): string {
  return `${b.top}px ${b.right}px ${b.bottom}px ${b.left}px (top right bottom left)`
}

export function toMarkdown(result: CaptureV1): string {
  const lines: string[] = []
  const { element, locator, layout, styles, states, omissions } = result

  lines.push(`# Design brief: <${element.tagName.toLowerCase()}> on ${result.page.origin}${result.page.pathname}`)
  lines.push('')
  lines.push(`Captured ${result.capturedAt} — mode ${result.mode}, trust ${result.trust}, schema ${result.schemaVersion}.`)
  lines.push('')

  lines.push('## Identity and locator')
  lines.push('')
  if (element.role) lines.push(`- Role: ${element.role}`)
  if (element.accessibleName) lines.push(`- Accessible name: ${element.accessibleName}`)
  if (element.text) lines.push(`- Visible text: ${element.text}`)
  const attrs = Object.entries(element.attributes)
  if (attrs.length) lines.push(`- Attributes: ${attrs.map(([k, v]) => `${k}="${v}"`).join(', ')}`)
  lines.push(`- Locator: \`${locator.selector}\` (strategy ${locator.strategy}, confidence ${locator.confidence}, ${locator.matchCount} match${locator.matchCount === 1 ? '' : 'es'})`)
  lines.push('')

  lines.push('## Layout')
  lines.push('')
  const r = layout.rect
  lines.push(`- Rect: ${round(r.width)}x${round(r.height)} at (${round(r.x)}, ${round(r.y)}), viewport ${result.env.viewport.width}x${result.env.viewport.height} @ DPR ${result.env.devicePixelRatio}`)
  lines.push(`- Padding: ${box(layout.boxModel.padding)}; border: ${box(layout.boxModel.border)}; margin: ${box(layout.boxModel.margin)}`)
  const parent = layout.parent
  const parentBits = [`display ${parent.display}`]
  if (parent.flexFlow) parentBits.push(`flex-flow ${parent.flexFlow}`)
  if (parent.gridTemplate) parentBits.push(`grid-template ${parent.gridTemplate}`)
  if (parent.gap) parentBits.push(`gap ${parent.gap}`)
  lines.push(`- Parent: ${parentBits.join(', ')}`)
  const item = Object.entries(layout.item).filter(([, v]) => v)
  if (item.length) lines.push(`- As item: ${item.map(([k, v]) => `${k} ${v}`).join(', ')}`)
  if (layout.stacking.length) {
    lines.push(`- Stacking chain: ${layout.stacking.map(s => `\`${s.selector}\` (${s.position}, z-index ${s.zIndex})`).join(' -> ')}`)
  }
  if (layout.nearestStackingContextSelector) {
    lines.push(`- Nearest stacking context: \`${layout.nearestStackingContextSelector}\``)
  }
  if (layout.ancestry.length) {
    lines.push(`- Ancestry: ${layout.ancestry.map(a => `${a.tagName}${a.role ? `[${a.role}]` : ''}(${a.display})`).join(' < ')}`)
  }
  lines.push('')

  if (styles.variables.length) {
    lines.push('## Design tokens')
    lines.push('')
    lines.push('| Variable | Resolved | Defined in | Used by |')
    lines.push('|---|---|---|---|')
    for (const v of styles.variables) {
      lines.push(`| \`${v.name}\` | ${v.resolved} | ${v.definedIn ? `\`${v.definedIn}\`` : 'indeterminate'} | ${v.usedBy.join(', ')} |`)
    }
    lines.push('')
  }

  lines.push('## Typography')
  lines.push('')
  const t = styles.typography
  const families = t.declaredFamilies.map(f => {
    const status = t.webfontStatus[f]
    return status ? `${f} (${status})` : f
  })
  lines.push(`- Families: ${families.join(', ')}`)
  lines.push(`- Size ${t.size}, line-height ${t.lineHeight}, weight ${t.weight}, letter-spacing ${t.letterSpacing}, feature-settings ${t.featureSettings}`)
  lines.push('')

  if (result.pseudo.before || result.pseudo.after) {
    lines.push('## Pseudo-elements')
    lines.push('')
    for (const which of ['before', 'after'] as const) {
      const p = result.pseudo[which]
      if (p) lines.push(`- ::${which} content ${p.content}`)
    }
    lines.push('')
  }

  if (states.length) {
    lines.push('## Interaction states')
    lines.push('')
    for (const s of states) {
      const decls = Object.entries(s.declarations).map(([k, v]) => `${k}: ${v}`).join('; ')
      lines.push(`- :${s.state} via \`${s.selector}\`${decls ? ` — ${decls}` : ''}`)
    }
    lines.push('')
  }

  if (result.mediaConditions?.length) {
    lines.push('## Responsive context')
    lines.push('')
    for (const m of result.mediaConditions) lines.push(`- @media ${m}`)
    lines.push('')
  }

  if (result.deep) {
    lines.push('## Deep capture')
    lines.push('')
    lines.push(`- Sanitized subtree: ${result.deep.subtree.length} nodes`)
    lines.push(`- Matched rules: ${result.deep.rules.length}`)
    if (result.deep.keyframes.length) {
      lines.push(`- Keyframes: ${result.deep.keyframes.map(k => k.name).join(', ')}`)
    }
    if (result.deep.assets.length) {
      lines.push(`- Assets: ${result.deep.assets.map(a => `${a.kind} ${a.url}`).join('; ')}`)
    }
    lines.push('')
  }

  // Absence must never read as "unstyled": every omission is listed with its reason.
  lines.push('## Not captured')
  lines.push('')
  if (omissions.length) {
    for (const o of omissions) {
      lines.push(`- ${o.field} — ${o.reason}${o.detail ? ` (${o.detail})` : ''}`)
    }
  } else {
    lines.push('- Nothing was omitted.')
  }
  lines.push('')

  return lines.join('\n')
}
