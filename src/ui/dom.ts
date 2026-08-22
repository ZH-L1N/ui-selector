// src/ui/dom.ts — the CSP-safe element builder. Every node this tool puts on a page
// goes through here.
//
// Four primitives only: document.createElement, textContent, setAttribute, and
// element.style assignment. No template string ever reaches the DOM, so
// `require-trusted-types-for 'script'` has nothing to intercept.
//
// Why styles go through the CSSOM and never setAttribute('style', …): CSP's
// style-src / style-src-attr checks the `style` CONTENT ATTRIBUTE, so a page without
// 'unsafe-inline' reports a violation for setAttribute('style'). Assigning
// element.style.color is CSSOM manipulation, which CSP does not police. That is the
// whole reason the builder takes `style` as an object and refuses a style attribute.

export interface ElProps {
  text?: string
  style?: Partial<CSSStyleDeclaration>
  attrs?: Record<string, string>
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.text !== undefined) node.textContent = props.text
  if (props.style) {
    for (const [name, value] of Object.entries(props.style)) {
      if (value === undefined || value === null) continue
      // Indexed CSSOM assignment — see the header note on why this is not setAttribute.
      ;(node.style as unknown as Record<string, string>)[name] = String(value)
    }
  }
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      // A style attribute here would be a CSP violation on any page without
      // 'unsafe-inline'. Fail loudly at the call site rather than at runtime on a
      // stranger's page.
      if (name.toLowerCase() === 'style') throw new Error('dom.el: pass style as an object, not a style attribute')
      node.setAttribute(name, value)
    }
  }
  for (const child of children) node.appendChild(child)
  return node
}

export interface UiHost {
  root: ShadowRoot
  destroy(): void
}

// A CLOSED shadow root on a fixed, zero-size, pointer-transparent container.
//
// pointer-events: none is load-bearing twice over: the page must keep receiving the
// hover and click the picker is listening for, and Playwright's actionability check
// must not see our overlay covering the target. Anything inside that needs clicks
// (the trust dialog) opts back in with pointer-events: auto on its own panel.
export function host(): UiHost {
  const container = el('div', {
    style: {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      margin: '0',
      padding: '0',
      border: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      colorScheme: 'light',
    },
  })
  const root = container.attachShadow({ mode: 'closed' })
  ;(document.body ?? document.documentElement).appendChild(container)
  return { root, destroy: () => container.remove() }
}
