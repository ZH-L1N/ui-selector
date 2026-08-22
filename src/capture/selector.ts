// src/capture/selector.ts — depth-aware selector-list splitter, specificity,
// state-pseudo stripping.
//
// A naive `selectorText.split(',')` breaks real CSS — `:is(.a, .b)` and
// `[data-x="a,b"]` both contain commas that are not list separators — which is
// why the splitter is its own module with its own unit tests.

// A quote character closes the string only when preceded by an EVEN run of
// backslashes: in `"a\\"` the backslash is itself escaped, so the quote closes;
// in `"a\""` it is not. Checking only text[i-1] mis-reads the first form,
// leaves the scanner "inside a string" forever, and silently merges selector
// parts / mis-files state rules downstream — so all three scanners share this.
function closesQuote(text: string, i: number): boolean {
  let k = i - 1
  while (k >= 0 && text[k] === '\\') k--
  return (i - 1 - k) % 2 === 0
}

export function splitSelectorList(text: string): string[] {
  const out: string[] = []
  let depth = 0, quote: string | null = null, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote && closesQuote(text, i)) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1 }
  }
  out.push(text.slice(start).trim())
  return out.filter(Boolean)
}

// Removes ONE occurrence of `:${state}` found at depth 0 (outside parens,
// brackets, and quotes) and returns the remaining base selector. Returns null
// when the pseudo appears only inside a functional pseudo (`:not(:hover)`) or
// only inside quotes — a case we decline to classify rather than mis-classify.
export function stripStatePseudo(selector: string, state: string): string | null {
  const token = `:${state}`
  let depth = 0, quote: string | null = null
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (quote) {
      if (c === quote && closesQuote(selector, i)) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '(' || c === '[') { depth++; continue }
    if (c === ')' || c === ']') { depth--; continue }
    if (c === ':' && selector.startsWith(token, i)) {
      // Token boundary: `:hover` must not match inside `:hovering` or a
      // functional form, and `::x` is a pseudo-element, not a state.
      const after = selector[i + token.length]
      if (after !== undefined && /[\w(-]/.test(after)) continue
      if (selector[i - 1] === ':') continue
      if (depth === 0) {
        const base = (selector.slice(0, i) + selector.slice(i + token.length)).trim()
        return base || '*'
      }
      // Present, but only at depth > 0: keep scanning for a depth-0
      // occurrence; if none exists we return null below.
    }
  }
  return null
}

// Specificity per the classic (a, b, c) counting: #id -> a; .class, [attr],
// :pseudo-class -> b; type, ::pseudo-element -> c.
//
// Documented limitation (spec §6.2 mirror): the Selectors 4 argument rules for
// :is() / :not() / :where() are NOT implemented — those selectors get the count
// of their outer form (one pseudo-class), and the caller records an
// `unsupported-selector` omission so the JSON never claims a precision it does
// not have. This function stays pure; the omission belongs to the caller.
const IDENT_CHAR = /[-\w\u0080-\uFFFF]/
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

export function specificity(selector: string): [number, number, number] {
  let a = 0, b = 0, c = 0
  let i = 0
  const n = selector.length
  const readIdent = (): string => {
    const start = i
    while (i < n && (IDENT_CHAR.test(selector[i]) || selector[i] === '\\')) {
      if (selector[i] === '\\') i++
      i++
    }
    return selector.slice(start, i)
  }
  const skipParens = (): void => {
    let depth = 0
    do {
      const d = selector[i]
      if (d === '(') depth++
      else if (d === ')') depth--
      i++
    } while (i < n && depth > 0)
  }
  while (i < n) {
    const ch = selector[i]
    if (ch === '"' || ch === "'") {
      i++
      while (i < n && selector[i] !== ch) { if (selector[i] === '\\') i++; i++ }
      i++
    } else if (ch === '[') {
      i++
      let quote: string | null = null
      while (i < n) {
        const d = selector[i]
        if (quote) { if (d === quote && closesQuote(selector, i)) quote = null }
        else if (d === '"' || d === "'") quote = d
        else if (d === ']') break
        i++
      }
      i++
      b++
    } else if (ch === '#') {
      i++; readIdent(); a++
    } else if (ch === '.') {
      i++; readIdent(); b++
    } else if (ch === ':') {
      if (selector[i + 1] === ':') { i += 2; readIdent(); c++; continue }
      i++
      const name = readIdent()
      if (selector[i] === '(') skipParens()
      if (LEGACY_PSEUDO_ELEMENTS.has(name)) c++ // :before et al are elements
      else b++
    } else if (IDENT_CHAR.test(ch) || ch === '\\') {
      readIdent()
      c++ // a type selector
    } else {
      i++ // '*', combinators, whitespace
    }
  }
  return [a, b, c]
}
