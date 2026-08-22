import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/global-setup.ts', // build + stage ONLY; no fetch
  projects: [
    // Playwright does NOT guarantee webServer processes are listening before
    // globalSetup runs, so the fixture health check cannot live there — it would fail
    // with ECONNREFUSED on a fresh run. A setup project runs as a normal test, after
    // server readiness, and every other project depends on it.
    { name: 'fixtures-ready', testMatch: /fixtures-ready\.setup\.ts/ },
    { name: 'chromium', dependencies: ['fixtures-ready'] },
  ],
  webServer: [
    { command: 'node tests/server.mjs tests/fixtures/site 8080', port: 8080,
      reuseExistingServer: !process.env.CI },
    { command: 'node tests/server.mjs tests/fixtures 8081', port: 8081,
      reuseExistingServer: !process.env.CI },
    { command: 'node tests/server.mjs tests/fixtures 8082 127.0.0.1', port: 8082,
      reuseExistingServer: !process.env.CI },
  ],
  use: { baseURL: 'http://localhost:8080' },
})
