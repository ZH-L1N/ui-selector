// tests/unit/trust.test.ts
import { describe, expect, it } from 'vitest'
import { classify } from '../../src/trust'

const T = ['http://localhost', 'https://skill-shelf.pages.dev']

describe('classify', () => {
  it('matches localhost on any port', () => {
    expect(classify('http://localhost:4321', T)).toBe('trusted')
  })
  it('matches an exact https origin', () => {
    expect(classify('https://skill-shelf.pages.dev', T)).toBe('trusted')
  })
  it('does not treat a suffix lookalike as trusted', () => {
    expect(classify('https://skill-shelf.pages.dev.evil.tld', T)).toBe('unknown')
  })
  it('does not let a subdomain inherit trust', () => {
    expect(classify('https://x.skill-shelf.pages.dev', T)).toBe('unknown')
  })
  it('treats claude.ai as unknown even though it is an intended target', () => {
    expect(classify('https://claude.ai', T)).toBe('unknown')
  })
  it('forces claude.ai to unknown even when the baked config lists it (sensitive host)', () => {
    // Spec §3: claude.ai is never trusted — the shell page carries conversation
    // text, so restricted caps (and no Deep mode) must survive a config entry.
    expect(classify('https://claude.ai', ['https://claude.ai'])).toBe('unknown')
  })
  it('extends the sensitive-host downgrade to claude.ai subdomains', () => {
    expect(classify('https://www.claude.ai', ['https://www.claude.ai'])).toBe('unknown')
  })
  it('does not let a prefix lookalike inherit trust', () => {
    expect(classify('https://evil-skill-shelf.pages.dev', T)).toBe('unknown')
  })
  it('requires the protocol to match, so http never inherits https trust', () => {
    expect(classify('http://skill-shelf.pages.dev', T)).toBe('unknown')
  })
  it('ignores the port for 127.0.0.1 when 127.0.0.1 is trusted', () => {
    expect(classify('http://127.0.0.1:8082', ['http://127.0.0.1'])).toBe('trusted')
  })
  it('does not extend loopback trust from localhost to 127.0.0.1', () => {
    expect(classify('http://127.0.0.1:8082', T)).toBe('unknown')
  })
  it('requires an exact port on a non-loopback host', () => {
    expect(classify('https://skill-shelf.pages.dev:8443', T)).toBe('unknown')
  })
  it('returns unknown for an unparseable origin rather than throwing', () => {
    expect(classify('not-an-origin', T)).toBe('unknown')
  })
  it('returns unknown when the trusted list is empty', () => {
    expect(classify('http://localhost:4321', [])).toBe('unknown')
  })
})
