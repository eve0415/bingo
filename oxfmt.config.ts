import { defineConfig } from 'oxfmt';

export default defineConfig({
  arrowParens: 'avoid',
  ignorePatterns: ['crates/bingo-wasm/pkg', 'crates/bingo-wasm/bindings', 'worker/coverage', 'worker/worker-configuration.d.ts'],
  printWidth: 160,
  singleQuote: true,
  sortImports: {
    groups: [['type'], ['builtin'], ['external'], ['subpath', 'internal'], ['parent'], ['sibling'], ['index']],
    order: 'asc',
  },
});
