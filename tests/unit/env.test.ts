// tests/unit/env.test.ts
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { captureEnv } from '../../src/capture/env'

it('records viewport, DPR, and the theme attributes on <html>', () => {
  const w = new JSDOM('<html data-theme="dark" class="dark"><body></body></html>', {
    pretendToBeVisual: true,
  }).window
  Object.defineProperty(w, 'devicePixelRatio', { value: 2 })
  w.matchMedia = vi.fn().mockImplementation(q => ({ matches: q.includes('dark'), media: q })) as never
  globalThis.window = w as never
  globalThis.document = w.document
  const env = captureEnv()
  expect(env.devicePixelRatio).toBe(2)
  expect(env.prefersColorScheme).toBe('dark')
  expect(env.themeAttributes).toMatchObject({ 'data-theme': 'dark', class: 'dark' })
})

it('ships only the closed theme-key list from <html>, never arbitrary data-*', () => {
  // Frameworks stamp application/user state on the root element
  // (data-user-id, data-csrf-token …) — a bare data-* prefix would ship it.
  const w = new JSDOM(
    '<html data-theme="dark" data-user-email="a@b.com" data-csrf-token="SECRET-CSRF" data-ab-bucket="7"><body></body></html>',
    { pretendToBeVisual: true },
  ).window
  globalThis.window = w as never
  globalThis.document = w.document
  const env = captureEnv()
  expect(env.themeAttributes).toEqual({ 'data-theme': 'dark' })
  expect(JSON.stringify(env)).not.toContain('SECRET-CSRF')
  expect(JSON.stringify(env)).not.toContain('a@b.com')
})
