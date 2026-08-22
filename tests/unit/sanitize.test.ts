import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'
import { pickAttributes, reducedUrl, visibleText } from '../../src/sanitize'
import { makeContext } from '../../src/types'

const BASE = 'https://x.dev/p/'

describe('reducedUrl', () => {
  it('keeps origin and pathname only', () => {
    expect(reducedUrl('https://x.dev/a/b?token=SECRET#frag', BASE)).toBe('https://x.dev/a/b')
  })
  it('drops credentials embedded in the URL', () => {
    expect(reducedUrl('https://u:p@x.dev/a', BASE)).toBe('https://x.dev/a')
  })
  it('resolves a relative URL against the supplied base, not a global', () => {
    expect(reducedUrl('./c?x=SECRET', BASE)).toBe('https://x.dev/p/c')
  })
  it('rejects javascript: instead of laundering its payload', () => {
    expect(reducedUrl('javascript:alert("SECRET")', BASE)).toBe('')
  })
  it('rejects data: URLs', () => {
    expect(reducedUrl('data:text/html,<b>SECRET</b>', BASE)).toBe('')
  })
  it('rejects mailto: and every other non-http scheme', () => {
    expect(reducedUrl('mailto:SECRET@x.dev', BASE)).toBe('')
    expect(reducedUrl('blob:https://x.dev/SECRET', BASE)).toBe('')
    expect(reducedUrl('file:///Users/SECRET', BASE)).toBe('')
  })
  it('returns an empty string for unparseable input rather than echoing it', () => {
    expect(reducedUrl('not a url ?token=SECRET', BASE)).toBe('')
  })
})

describe('visibleText', () => {
  let doc: Document
  const dom = (html: string) => {
    const w = new JSDOM(html).window
    globalThis.document = w.document
    globalThis.getComputedStyle = w.getComputedStyle.bind(w)
    globalThis.Node = w.Node
    globalThis.NodeFilter = w.NodeFilter
    // noteShadowBoundary references the ShadowRoot global, which plain node lacks.
    globalThis.ShadowRoot = w.ShadowRoot
    return w.document
  }
  beforeEach(() => { doc = dom('<div id="card">ok</div>') })

  it('normalizes whitespace on a simple element', () => {
    doc = dom('<button id="b">  Submit   order </button>')
    expect(visibleText(doc.getElementById('b')!, 'trusted', makeContext())).toBe('Submit order')
  })

  it('returns null for the form controls themselves', () => {
    doc = dom('<input id="i" value="SECRET"><textarea id="t">SECRET</textarea>')
    expect(visibleText(doc.getElementById('i')!, 'trusted', makeContext())).toBeNull()
    expect(visibleText(doc.getElementById('t')!, 'trusted', makeContext())).toBeNull()
  })

  // The container cases are the ones a naive textContent implementation fails.
  it('excludes a DESCENDANT textarea value from a container capture', () => {
    doc = dom('<div id="c">Label <textarea>SECRET-AREA</textarea></div>')
    const t = visibleText(doc.getElementById('c')!, 'trusted', makeContext())!
    expect(t).toBe('Label')
    expect(t).not.toContain('SECRET')
  })

  it('excludes a descendant contenteditable subtree', () => {
    doc = dom('<div id="c">Note <div contenteditable="true">SECRET-EDITABLE</div></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Note')
  })

  it('excludes script and style source text', () => {
    doc = dom(`<div id="c">Hi<script>const s='SECRET-SCRIPT'</script><style>/* SECRET-STYLE */</style></div>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Hi')
  })

  it('excludes hidden and display:none subtrees', () => {
    doc = dom('<div id="c">Shown<span hidden>SECRET-HIDDEN</span><span style="display:none">SECRET-NONE</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Shown')
  })

  it('excludes template and noscript content', () => {
    doc = dom('<div id="c">A<template>SECRET-TPL</template><noscript>SECRET-NS</noscript></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('A')
  })

  it('counts the cap across the whole walk, not per node', () => {
    doc = dom(`<div id="c">${'<span>abcdefghij</span>'.repeat(40)}</div>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())!.length).toBe(200)
    expect(visibleText(doc.getElementById('c')!, 'restricted', makeContext())!.length).toBe(80)
  })

  it('records budget-exceeded when the node-visit cap is hit', () => {
    doc = dom(`<div id="c">${'<span>x</span>'.repeat(600)}</div>`)
    const ctx = makeContext()
    visibleText(doc.getElementById('c')!, 'trusted', ctx)
    expect(ctx.omissions.some(o => o.reason === 'budget-exceeded')).toBe(true)
  })

  // The ROOT cases. A TreeWalker never applies its filter to its own root, so each of
  // these leaks unless the root is checked separately.
  it('returns null when the selected root itself is hidden', () => {
    doc = dom('<div id="c" hidden>SECRET-HIDDEN</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('returns null when the selected root itself is display:none', () => {
    doc = dom('<div id="c" style="display:none">SECRET-NONE</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('returns null for every editable variant, as root and as descendant', () => {
    for (const attr of ['contenteditable="true"', 'contenteditable=""', 'contenteditable="plaintext-only"']) {
      doc = dom(`<div id="c" ${attr}>SECRET-EDITABLE</div>`)
      expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
      doc = dom(`<div id="p">Label <div ${attr}>SECRET-EDITABLE</div></div>`)
      expect(visibleText(doc.getElementById('p')!, 'trusted', makeContext())).toBe('Label')
    }
  })
  it('still captures text when contenteditable is explicitly false', () => {
    doc = dom('<div id="c" contenteditable="false">Visible</div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Visible')
  })
  it('returns the whole string when it lands exactly on the cap', () => {
    doc = dom(`<p id="c">${'a'.repeat(200)}</p>`)
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())!.length).toBe(200)
  })

  // The ANCESTOR cases. getComputedStyle(child) inside display:none reports the
  // child's own display, so a child of a hidden ancestor is only caught by walking up.
  it('refuses a descendant of a display:none ancestor', () => {
    doc = dom('<div style="display:none"><span id="c">SECRET-ANCESTOR</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('refuses a descendant of a [hidden] ancestor', () => {
    doc = dom('<div hidden><span id="c">SECRET-ANCESTOR</span></div>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('refuses visibility:collapse as well as hidden', () => {
    doc = dom('<span id="c" style="visibility:collapse">SECRET-COLLAPSE</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBeNull()
  })
  it('still captures opacity:0 text, which is a design state and not suppression', () => {
    doc = dom('<span id="c" style="opacity:0">Fading in</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Fading in')
  })
  it('still captures aria-hidden text, by explicit policy', () => {
    doc = dom('<span id="c" aria-hidden="true">Decorative</span>')
    expect(visibleText(doc.getElementById('c')!, 'trusted', makeContext())).toBe('Decorative')
  })
})

describe('pickAttributes', () => {
  const dom = (html: string) => {
    const w = new JSDOM(html, { url: BASE }).window
    globalThis.document = w.document
    return w.document
  }

  it('allowlists design attributes and drops value-bearing ones', () => {
    const el = dom(`<input class="c" data-testid="t" aria-label="a" value="SECRET"
      checked placeholder="Email" name="email" type="email">`).querySelector('input')!
    const out = pickAttributes(el, makeContext())
    expect(out).toMatchObject({ class: 'c', 'data-testid': 't', 'aria-label': 'a',
                                placeholder: 'Email', type: 'email' })
    expect(out).not.toHaveProperty('value')
    expect(out).not.toHaveProperty('checked')
    expect(out).not.toHaveProperty('name')
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })

  it('reduces href and src to origin plus pathname', () => {
    const a = dom('<a href="https://x.dev/p?s=SECRET">l</a>').querySelector('a')!
    expect(pickAttributes(a, makeContext()).href).toBe('https://x.dev/p')
  })

  it('drops a javascript: href entirely and records the reason', () => {
    const a = dom(`<a href="javascript:alert('SECRET')">l</a>`).querySelector('a')!
    const ctx = makeContext()
    const out = pickAttributes(a, ctx)
    expect(out).not.toHaveProperty('href')
    expect(ctx.omissions.some(o => o.reason === 'blocked-scheme')).toBe(true)
  })

  it('drops a data: src rather than embedding the payload', () => {
    const img = dom('<img src="data:image/svg+xml,SECRET" alt="a">').querySelector('img')!
    const out = pickAttributes(img, makeContext())
    expect(out).not.toHaveProperty('src')
    expect(out.alt).toBe('a')
  })

  // Every allowed URL-bearing attribute against every hostile scheme. This matrix is
  // what fails if someone widens REDUCED_URL_ATTRIBUTES without thinking it through.
  it.each(['href', 'src'])('reduces or drops %s for every scheme', attr => {
    const cases: Array<[string, string | undefined]> = [
      ['https://x.dev/p?s=SECRET', 'https://x.dev/p'],
      ['//x.dev/p?s=SECRET', 'https://x.dev/p'],           // protocol-relative
      ['./rel?s=SECRET', 'https://x.dev/p/rel'],
      ['javascript:alert("SECRET")', undefined],
      ['data:text/html,SECRET', undefined],
      ['mailto:SECRET@x.dev', undefined],
      ['blob:https://x.dev/SECRET', undefined],
      ['file:///SECRET', undefined],
    ]
    for (const [input, want] of cases) {
      const el = dom(`<a ${attr}="${input}">l</a>`).querySelector('a')!
      const out = pickAttributes(el, makeContext())
      expect(out[attr]).toBe(want)
      expect(JSON.stringify(out)).not.toContain('SECRET')
    }
  })

  it('drops the ARIA attributes that mirror form values on custom widgets', () => {
    // aria-checked / aria-selected / aria-pressed / aria-valuenow / aria-valuetext
    // on a role=checkbox|slider ARE the user's live form value — the same data
    // class the native value/checked/selected exclusions guard (spec §6.4).
    const el = dom(`<span role="slider" aria-label="Salary" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow="750000" aria-valuetext="SECRET-VALUETEXT" aria-checked="true"
      aria-selected="true" aria-pressed="true" aria-expanded="false">x</span>`).querySelector('span')!
    const out = pickAttributes(el, makeContext())
    expect(out).toMatchObject({ role: 'slider', 'aria-label': 'Salary',
                                'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-expanded': 'false' })
    for (const k of ['aria-valuenow', 'aria-valuetext', 'aria-checked', 'aria-selected', 'aria-pressed']) {
      expect(out).not.toHaveProperty(k)
    }
    expect(JSON.stringify(out)).not.toContain('SECRET-VALUETEXT')
    expect(JSON.stringify(out)).not.toContain('750000')
  })

  it('never emits an excluded URL-bearing attribute at all', () => {
    const f = dom(`<form action="javascript:x" ping="https://x.dev/SECRET"></form>`).querySelector('form')!
    const out = pickAttributes(f, makeContext())
    expect(out).not.toHaveProperty('action')
    expect(out).not.toHaveProperty('ping')
  })
})
