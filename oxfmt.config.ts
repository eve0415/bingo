import { defineConfig } from 'oxfmt';

export default defineConfig({
  arrowParens: 'avoid',
  ignorePatterns: [
    '**/.tanstack',
    '**/.wrangler',
    'activity/dist',
    'wrapper/dist',
    'activity/app/routeTree.gen.ts',
    'crates/bingo-wasm/pkg',
    'crates/bingo-wasm/bindings',
    '**/coverage',
    'activity/worker-configuration.d.ts',
    'wrapper/worker-configuration.d.ts',
  ],
  printWidth: 160,
  singleQuote: true,
  sortImports: {
    groups: [['type'], ['builtin'], ['external'], ['subpath', 'internal'], ['parent'], ['sibling'], ['index']],
    order: 'asc',
  },
});
