import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'test-results/',
      'playwright-report/',
      'tests/fixtures/',
      'spikes/out/',
    ],
  },
  ...tseslint.configs.recommended,
  // Registers the .ts extension for directory arguments (eslint src build tests).
  { files: ['**/*.ts', '**/*.mts', '**/*.mjs'] },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "MemberExpression[property.name='innerHTML']", message: 'CSP: use dom.ts builders' },
        { selector: "MemberExpression[property.name='outerHTML']", message: 'CSP: use dom.ts builders' },
        { selector: "CallExpression[callee.name='eval']", message: 'CSP: no eval' },
        { selector: "NewExpression[callee.name='Function']", message: 'CSP: no new Function' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'CSP: use dom.ts builders' },
        { selector: "CallExpression[callee.property.name='fetch']", message: 'no runtime network' },
        { selector: "CallExpression[callee.name='fetch']", message: 'no runtime network' },
      ],
    },
  },
)
