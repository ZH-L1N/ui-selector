// build/bundle.mjs
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { installPage } from './install-template.mjs'

const TEST = process.argv.includes('--test')
const CONFIG = TEST
  ? 'selector.config.test.json'
  : existsSync('selector.config.json') ? 'selector.config.json' : 'selector.config.example.json'
const { trustedOrigins } = JSON.parse(readFileSync(CONFIG, 'utf8'))

const result = await build({
  entryPoints: ['src/boot.ts'],
  bundle: true, minify: !TEST, format: 'iife', target: 'chrome120',
  write: false, legalComments: 'none',
  define: {
    __TRUSTED_ORIGINS__: JSON.stringify(trustedOrigins),
    __EXPOSE_TEST_HOOK__: String(TEST),
  },
})
const code = result.outputFiles[0].text
mkdirSync('dist', { recursive: true })

if (TEST) {
  writeFileSync('dist/ui-selector.test.js', code)
  console.log(`test bundle: ${code.length} bytes; trusted: ${trustedOrigins.join(', ')}`)
} else {
  writeFileSync('dist/ui-selector.js', code)
  const url = 'javascript:' + encodeURIComponent(`(()=>{${code}})()`)
  writeFileSync('dist/bookmarklet.txt', url)
  writeFileSync('dist/install.html',
    installPage({ url, trustedOrigins, bytes: url.length, builtAt: new Date().toISOString() }))
  console.log(`encoded bookmarklet: ${url.length} bytes; trusted: ${trustedOrigins.join(', ')}`)
}
