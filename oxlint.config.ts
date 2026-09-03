import { defineConfig } from 'oxlint';

export default defineConfig({
  categories: {
    correctness: 'error',
    nursery: 'error',
    pedantic: 'error',
    perf: 'error',
    restriction: 'error',
    style: 'error',
    suspicious: 'error',
  },
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
  options: {
    denyWarnings: true,
    maxWarnings: 0,
    reportUnusedDisableDirectives: 'error',
    typeAware: true,
    typeCheck: true,
  },
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'node', 'promise'],
  rules: {
    'array-callback-return': ['error', { checkForEach: true }],
    curly: ['error', 'multi-line'],
    'func-style': ['error', 'expression', { allowArrowFunctions: true }],
    'no-bitwise': ['error', { allow: ['~'], int32Hint: true }],
    'sort-imports': ['error', { allowSeparatedGroups: true, ignoreDeclarationSort: true }],
    'typescript/return-await': ['error', 'error-handling-correctness-only'],
    'typescript/strict-boolean-expressions': ['error', { allowNullableString: true }],
    'unicorn/filename-case': ['error', { cases: { camelCase: true, kebabCase: true } }],
    'unicorn/numeric-separators-style': ['error', { onlyIfContainsSeparator: true }],
    // TypeScript type checking reports unresolved names while understanding Worker and test globals.
    'no-undef': 'off',
    // Worker APIs and optional properties use undefined as a distinct, intentional value.
    'no-undefined': 'off',
    // Ternaries are the idiomatic expression form and banning them conflicts with unicorn/prefer-ternary.
    'no-ternary': 'off',
    // Promise-returning wrappers must be async for TypeScript, which conflicts with require-await when they delegate directly.
    'require-await': 'off',
    // Async/await is the native control-flow model for Worker, Durable Object, and test APIs.
    'oxc/no-async-await': 'off',
    // Optional chaining expresses nullable request and protocol fields without duplicated lookups.
    'oxc/no-optional-chaining': 'off',
    // Object spread preserves immutable DTO updates and discriminated-union shapes.
    'oxc/no-rest-spread-properties': 'off',
    // Oxfmt deliberately separates type and value imports into different groups.
    'no-duplicate-imports': 'off',
    // Separate declarations keep dependent values readable and avoid one-var's coupled statement scope.
    'one-var': 'off',
    // Declaration order follows dependencies, which alphabetical sort-vars can place in the temporal dead zone.
    'sort-vars': 'off',
    // Wire DTO and schema object key order is intentional and must not be alphabetized.
    'sort-keys': 'off',
    // Protocol values, HTTP statuses, and test fixtures carry domain meaning without one constant per literal.
    'no-magic-numbers': 'off',
    // Generic parameters and established protocol aliases conventionally use one-character names.
    'id-length': 'off',
    // Platform callback signatures and mutable collections cannot be made deeply readonly by this rule.
    'typescript/prefer-readonly-parameter-types': 'off',
    // Typed storage and wasm decoders expose caller-selected generated DTOs from serialized boundaries.
    'typescript/no-unnecessary-type-parameters': 'off',
    // Cloudflare SQL row shapes need type aliases to satisfy its Record constraint without an index signature.
    'typescript/consistent-type-definitions': 'off',
    // Named exports are the source-module API and should remain colocated with their declarations.
    'import/no-named-export': 'off',
    // A module with one named API should not change export style when a second API is added or removed.
    'import/prefer-default-export': 'off',
    // Colocated exports keep types and implementations adjacent instead of maintaining a detached export list.
    'import/group-exports': 'off',
    // Exported declarations belong beside their implementation rather than at the end of large modules.
    'import/exports-last': 'off',
    // Worker tests import the source modules under their parent directory.
    'import/no-relative-parent-imports': 'off',
    // Durable Object handlers and integration scenarios are cohesive even when they exceed generic size limits.
    'max-statements': 'off',
    // Durable Object handlers and integration scenarios are cohesive even when they exceed generic size limits.
    'max-lines-per-function': 'off',
    // The stateful Worker integration suite is intentionally colocated in one file.
    'max-lines': 'off',
    // Cloudflare lifecycle callbacks define parameter counts that application code does not control.
    'max-params': 'off',
    // JSON and Web APIs distinguish null from an absent or undefined value.
    'unicorn/no-null': 'off',
    // JWT base64url input is ASCII, where charCodeAt guarantees a number and codePointAt does not.
    'unicorn/prefer-code-point': 'off',
    // The JSON round-trip intentionally rejects and normalizes values before crossing the wasm boundary.
    'unicorn/prefer-structured-clone': 'off',
    // The wasm-bindgen API exports initSync, which node/no-sync mistakes for a blocking Node API.
    'node/no-sync': 'off',
    // Oxfmt lowercases numeric literals, so this rule's uppercase fix would be undone on every lint run.
    'unicorn/number-literal-case': 'off',
  },
  overrides: [
    {
      files: ['activity/test/**/*.ts', 'wrapper/test/**/*.ts'],
      plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'node', 'promise', 'vitest'],
      rules: {
        // Stateful Durable Object operations in integration tests must run sequentially.
        'no-await-in-loop': 'off',
        // Stateful integration scenarios verify several coupled effects without increasing the fixed test count.
        'vitest/max-expects': 'off',
        // Protocol integration scenarios assert branch-specific state while retaining one end-to-end test case.
        'vitest/no-conditional-in-test': 'off',
        // Vitest already enforces the suite-level timeout configured by the runner.
        'vitest/require-test-timeout': 'off',
        // A Promise constructor is required to adapt WebSocket event callbacks to the test's async queue.
        'promise/avoid-new': 'off',
        // Vitest spies need a module namespace object so they can replace exported functions.
        'import/no-namespace': 'off',
        // Worker frames are emitted from the typed ServerMessage protocol before tests parse their JSON.
        'typescript/no-unsafe-return': 'off',
        // One boundary test intentionally asserts that a synchronous callback returns void.
        'typescript/no-confusing-void-expression': 'off',
      },
    },
    {
      files: [
        'oxlint.config.ts',
        'oxfmt.config.ts',
        'activity/src/server.ts',
        'activity/vite.config.ts',
        'activity/vitest.config.ts',
        'crates/bingo-wasm/wasm.d.ts',
        'wrapper/vite.config.ts',
        'wrapper/vitest.config.ts',
        'wrapper/src/index.ts',
      ],
      rules: {
        // Tool configs, the Worker entrypoint, and wasm modules require default-export interfaces.
        'import/no-default-export': 'off',
      },
    },
    {
      files: ['wrapper/vitest.config.ts'],
      rules: {
        // Vitest configuration runs in Node rather than the Worker runtime.
        'import/no-nodejs-modules': 'off',
      },
    },
    {
      files: ['wrapper/src/engine.ts', 'wrapper/src/room.ts', 'wrapper/test/**/*.ts'],
      rules: {
        // The wasm bridge and its integration suite intentionally import the complete generated protocol surface.
        'import/max-dependencies': 'off',
      },
    },
    {
      files: ['wrapper/src/room.ts'],
      rules: {
        // The only unsafe returns are typed decoders for values written by this Worker or validated by Rust.
        'typescript/no-unsafe-return': 'off',
      },
    },
  ],
});
