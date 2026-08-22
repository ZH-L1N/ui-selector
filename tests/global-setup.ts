// tests/global-setup.ts — build and stage only. No network calls here.
import { execSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'

export default function () {
  execSync('npm run build:test', { stdio: 'inherit' })
  // Staged inside the fixture root so a strict-CSP page can load it as a same-origin
  // script. Injection cannot be used there — see Task 7.
  copyFileSync('dist/ui-selector.test.js', 'tests/fixtures/ui-selector.test.js')
}
