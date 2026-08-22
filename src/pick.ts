// src/pick.ts — hover highlight and click-to-select.
//
// Three rules this file exists to enforce:
//   1. Listeners are on `document` in the CAPTURE phase, so the selecting click is
//      intercepted on the way down and the page's own handlers never run.
//   2. The picked node comes from `composedPath()[0]`, so a click that lands on a
//      shadow-DOM child resolves to that child rather than being retargeted to its
//      host. `elementFromPoint` is the fallback when the path yields no element.
//   3. The highlight is a fixed-position outline div inside our CLOSED shadow root.
//      Nothing is ever injected into the page's own stylesheets or markup.
import { el, host } from './ui/dom'

const ACCENT = '#0a7766'

export function pick(): Promise<Element | null> {
  const ui = host()
  const outline = el('div', {
    style: {
      position: 'fixed',
      display: 'none',
      boxSizing: 'border-box',
      border: `2px solid ${ACCENT}`,
      borderRadius: '2px',
      background: 'rgba(10, 119, 102, 0.12)',
      pointerEvents: 'none',
    },
  })
  ui.root.appendChild(outline)

  return new Promise<Element | null>(resolve => {
    // `composedPath()[0]` is the deepest node the event actually reached, which is the
    // shadow child for an open root and the host for a closed one. Falling back to
    // elementFromPoint covers events that carry no usable path (synthetic ones).
    const targetOf = (event: Event): Element | null => {
      const first = event.composedPath()[0]
      if (first instanceof Element) return first
      const mouse = event as MouseEvent
      if (typeof mouse.clientX !== 'number') return null
      return document.elementFromPoint(mouse.clientX, mouse.clientY)
    }

    const highlight = (target: Element): void => {
      const r = target.getBoundingClientRect()
      outline.style.display = 'block'
      outline.style.left = `${r.left}px`
      outline.style.top = `${r.top}px`
      outline.style.width = `${r.width}px`
      outline.style.height = `${r.height}px`
    }

    const onPointerOver = (event: Event): void => {
      const target = targetOf(event)
      if (target) highlight(target)
    }

    const onClick = (event: Event): void => {
      const target = targetOf(event)
      // Kill the click three ways: no default action (navigation, form submit), no
      // descent to the page's own listeners, and no other capture listener on
      // document either.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finish(target)
    }

    const onKeyDown = (event: Event): void => {
      if ((event as KeyboardEvent).key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finish(null)
    }

    function finish(result: Element | null): void {
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      ui.destroy()
      resolve(result)
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
  })
}
