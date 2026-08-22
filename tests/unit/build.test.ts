import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('build pipeline', () => {
  it('emits a javascript: bookmarklet with the trusted origins baked in', () => {
    execSync('npm run build', { stdio: 'pipe' })
    const url = readFileSync('dist/bookmarklet.txt', 'utf8')
    expect(url.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(url)).toContain('http://localhost')
    expect(url).not.toMatch(/\s/)
  })

  it('reports the encoded size so the Spike 1 envelope can be enforced', () => {
    const url = readFileSync('dist/bookmarklet.txt', 'utf8')
    expect(url.length).toBeLessThan(60_000)      // tighten to (Spike 1 result / 2)
  })

  it('shows the baked trusted origins on the install page', () => {
    expect(readFileSync('dist/install.html', 'utf8')).toContain('http://localhost')
  })

  it('stamps the install page with the byte count and build time so a stale bookmark is auditable', () => {
    const html = readFileSync('dist/install.html', 'utf8')
    const url = readFileSync('dist/bookmarklet.txt', 'utf8')
    expect(html).toContain(`${url.length} bytes`)
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T[\d:.]+Z">/)
  })

  it('keeps the test hook OUT of the release bundle and IN the test bundle', () => {
    execSync('npm run build:test', { stdio: 'pipe' })
    expect(readFileSync('dist/ui-selector.js', 'utf8')).not.toContain('__uiSelectorTest')
    expect(readFileSync('dist/ui-selector.test.js', 'utf8')).toContain('__uiSelectorTest')
  })
})
