// tests/unit/selector.test.ts
import { describe, expect, it } from 'vitest'
import { splitSelectorList, specificity, stripStatePseudo } from '../../src/capture/selector'

describe('splitSelectorList', () => {
  it('splits a plain selector list', () => {
    expect(splitSelectorList('.a, .b , .c')).toEqual(['.a', '.b', '.c'])
  })
  it('does not split inside :is() / :not() / :where()', () => {
    expect(splitSelectorList(':is(.a, .b) .c, .d')).toEqual([':is(.a, .b) .c', '.d'])
  })
  it('does not split inside an attribute value', () => {
    expect(splitSelectorList('[data-x="a,b"], .c')).toEqual(['[data-x="a,b"]', '.c'])
  })
  it('does not split inside a quoted string containing a bracket', () => {
    expect(splitSelectorList(`[title="a],b"], .c`)).toEqual([`[title="a],b"]`, '.c'])
  })
  it('handles nested parens', () => {
    expect(splitSelectorList(':not(:is(.a, .b)), .c')).toEqual([':not(:is(.a, .b))', '.c'])
  })
  it('splits after a quoted string ending in an escaped backslash', () => {
    // Chromium serializes an attribute value that is literally `a\` as "a\\":
    // the closing quote is preceded by an EVEN backslash run and really closes.
    expect(splitSelectorList(String.raw`[data-x="a\\"], .b`)).toEqual([String.raw`[data-x="a\\"]`, '.b'])
  })
  it('still refuses to split on an escaped quote (odd backslash run)', () => {
    expect(splitSelectorList(String.raw`[data-x="a\","], .b`)).toEqual([String.raw`[data-x="a\","]`, '.b'])
  })
})

describe('specificity', () => {
  it('counts ids, classes, and types', () => {
    expect(specificity('#a .b .c div')).toEqual([1, 2, 1])
  })
  it('counts attribute selectors and pseudo-classes as class-level', () => {
    expect(specificity('a[href]:hover')).toEqual([0, 2, 1])
  })
  it('counts a pseudo-element as type-level', () => {
    expect(specificity('.a::before')).toEqual([0, 1, 1])
  })
  it('counts selectors after an attribute string ending in an escaped backslash', () => {
    // With an odd/even confusion the [...] scanner runs to end of string and
    // `.b` is never counted.
    expect(specificity(String.raw`[data-y="q\\"] .b`)).toEqual([0, 2, 0])
  })
})

describe('stripStatePseudo', () => {
  it('removes a top-level state pseudo so the base can be matched', () => {
    expect(stripStatePseudo('.btn:hover', 'hover')).toBe('.btn')
  })
  it('refuses to touch a state pseudo nested inside a functional pseudo', () => {
    expect(stripStatePseudo('.btn:not(:hover)', 'hover')).toBeNull()
  })
  it('strips a state after an attribute string ending in an escaped backslash', () => {
    expect(stripStatePseudo(String.raw`[data-y="q\\"]:hover`, 'hover')).toBe(String.raw`[data-y="q\\"]`)
  })
})
