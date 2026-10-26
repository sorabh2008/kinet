import js from '@eslint/js';

// Node globals are listed inline rather than pulling in the `globals` package,
// which is only a transitive dependency here.
const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'setImmediate', 'AbortController', 'AbortSignal', 'fetch', 'TextDecoder', 'structuredClone', 'performance']
    .map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['node_modules/**', 'templates/**', 'docs/**', '.kinet/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
