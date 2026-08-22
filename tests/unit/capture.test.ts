// tests/unit/capture.test.ts
// @vitest-environment jsdom       <- this test needs a document; the default is node
import { beforeEach, expect, it } from 'vitest'
import { capture } from '../../src/capture'
import { makeContext } from '../../src/types'

// jsdom document created at https://x.dev/p?token=SECRET — see the environmentOptions
// in vitest.config.ts, which sets the jsdom `url` so page identity has something real
// to reduce. `makeContext` is the helper produced by Task 2.
beforeEach(() => {
  document.body.textContent = ''
  const button = document.createElement('button')
  button.textContent = 'Save'
  document.body.appendChild(button)
})

it('always emits schemaVersion, reduced page identity, and an omissions array', () => {
  const result = capture(document.querySelector('button')!, makeContext('standard', 'restricted'))
  expect(result.schemaVersion).toBe('1.0')
  expect(result.page).toEqual({ origin: 'https://x.dev', pathname: '/p' })
  expect(JSON.stringify(result)).not.toContain('SECRET')
  expect(Array.isArray(result.omissions)).toBe(true)
})

it('records restricted-mode omissions instead of silently dropping deep fields', () => {
  const result = capture(document.querySelector('button')!, makeContext('deep', 'restricted'))
  expect(result.deep).toBeUndefined()
  expect(result.omissions).toContainEqual(
    expect.objectContaining({ field: 'deep', reason: 'restricted-mode' }))
})
