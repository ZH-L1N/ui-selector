import { defineConfig } from 'vitest/config'

// Unit tests only: tests/e2e is Playwright's territory, and vitest's default
// include glob would otherwise try to execute those spec files and fail.
//
// The jsdom URL deliberately carries a query string with a seed value: page
// identity must reduce to origin + pathname, and the capture unit test asserts
// the seed never appears in output.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environmentOptions: {
      jsdom: { url: 'https://x.dev/p?token=SECRET' },
    },
  },
})
