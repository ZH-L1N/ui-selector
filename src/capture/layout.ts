// src/capture/layout.ts — geometry, box model, scroll, parent/item context,
// stacking-context chain, bounded ancestry.
import { CAPS } from '../allowlists'
import { locate } from '../locate'
import type { Box, CaptureContext, LayoutContext, Rect } from '../types'

const px = (v: string): number => Number.parseFloat(v) || 0

function readBox(cs: CSSStyleDeclaration, prop: 'padding' | 'margin'): Box {
  return {
    top: px(cs.getPropertyValue(`${prop}-top`)),
    right: px(cs.getPropertyValue(`${prop}-right`)),
    bottom: px(cs.getPropertyValue(`${prop}-bottom`)),
    left: px(cs.getPropertyValue(`${prop}-left`)),
  }
}

function readBorder(cs: CSSStyleDeclaration): Box {
  return {
    top: px(cs.getPropertyValue('border-top-width')),
    right: px(cs.getPropertyValue('border-right-width')),
    bottom: px(cs.getPropertyValue('border-bottom-width')),
    left: px(cs.getPropertyValue('border-left-width')),
  }
}

function findScrollParent(el: Element): Element | null {
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (/(auto|scroll|overlay)/.test(cs.overflowX + ' ' + cs.overflowY)) return n
  }
  return null
}

// A stacking context in the paint-order sense — "what paints above what". The
// trigger list must be COMPLETE, not representative: any trigger missing here
// makes the walk run past a real paint boundary and confidently report
// ancestors that do not participate in the element's stacking order. Verified
// per trigger against Chromium's actual paint order (elementFromPoint probes),
// not from memory — opacity<1, isolation, mix-blend-mode, backdrop-filter,
// contain:layout, and z-index-less fixed/sticky were all missed once.
function isStackingContext(cs: CSSStyleDeclaration): boolean {
  if (cs.transform && cs.transform !== 'none') return true
  if (cs.filter && cs.filter !== 'none') return true
  if (cs.backdropFilter && cs.backdropFilter !== 'none') return true
  if (cs.perspective && cs.perspective !== 'none') return true
  if (Number.parseFloat(cs.opacity) < 1) return true
  if (cs.isolation === 'isolate') return true
  if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return true
  // layout containment creates a context too; style containment does not.
  if (/\b(paint|layout|strict|content)\b/.test(cs.contain)) return true
  if (cs.willChange && cs.willChange !== 'auto') return true
  // fixed and sticky establish a context regardless of z-index; other
  // positioned elements need a numeric z-index.
  if (cs.position === 'fixed' || cs.position === 'sticky') return true
  return cs.position !== 'static' && cs.zIndex !== 'auto'
}

export function captureLayout(el: Element, ctx: CaptureContext): LayoutContext {
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const rect: Rect = { x: r.x, y: r.y, width: r.width, height: r.height }

  const padding = readBox(cs, 'padding')
  const margin = readBox(cs, 'margin')
  const border = readBorder(cs)
  const content: Rect = {
    x: r.x + border.left + padding.left,
    y: r.y + border.top + padding.top,
    width: Math.max(0, r.width - border.left - border.right - padding.left - padding.right),
    height: Math.max(0, r.height - border.top - border.bottom - padding.top - padding.bottom),
  }

  const scrollParent = findScrollParent(el)
  const scroll: LayoutContext['scroll'] = {
    pageX: window.scrollX,
    pageY: window.scrollY,
    elementScrollTop: el.scrollTop,
    elementScrollLeft: el.scrollLeft,
    scrollParentSelector: scrollParent ? locate(scrollParent).selector : null,
  }

  // Parent container and own item properties — only the ones the parent's
  // display mode makes meaningful.
  const parentEl = el.parentElement
  const parent: LayoutContext['parent'] = { display: 'none' }
  const item: LayoutContext['item'] = {}
  if (parentEl) {
    const pcs = getComputedStyle(parentEl)
    parent.display = pcs.display
    const isFlex = pcs.display.includes('flex')
    const isGrid = pcs.display.includes('grid')
    if (isFlex) parent.flexFlow = `${pcs.flexDirection} ${pcs.flexWrap}`
    if (isGrid) parent.gridTemplate = `${pcs.gridTemplateRows} / ${pcs.gridTemplateColumns}`
    if (isFlex || isGrid) {
      parent.gap = pcs.gap
      item.alignSelf = cs.alignSelf
      item.order = cs.order
      if (isFlex) item.flex = cs.flex
      if (isGrid) item.gridArea = cs.gridArea
    }
  }

  // Walk ancestors collecting positioned / z-indexed entries, stopping at (and
  // including, when it is itself positioned) the nearest ancestor stacking
  // context. documentElement is never considered: reaching it means null.
  const stacking: LayoutContext['stacking'] = []
  let nearestStackingContextSelector: string | null = null
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const acs = getComputedStyle(n)
    if (acs.position !== 'static' || acs.zIndex !== 'auto') {
      stacking.push({ selector: locate(n).selector, position: acs.position, zIndex: acs.zIndex })
    }
    if (isStackingContext(acs)) {
      nearestStackingContextSelector = locate(n).selector
      break
    }
  }

  const ancestry: LayoutContext['ancestry'] = []
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (ancestry.length >= CAPS.ancestryDepth) {
      ctx.omit('layout.ancestry', 'budget-exceeded', `ancestry deeper than ${CAPS.ancestryDepth}`)
      break
    }
    ancestry.push({
      tagName: n.tagName.toLowerCase(),
      role: n.getAttribute('role'),
      display: getComputedStyle(n).display,
    })
  }

  return {
    rect,
    boxModel: { content, padding, border, margin },
    scroll,
    parent,
    item,
    stacking,
    nearestStackingContextSelector,
    ancestry,
  }
}
