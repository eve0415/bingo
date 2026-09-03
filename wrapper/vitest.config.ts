import type { Plugin } from 'vite';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const externalizeWasm = (): Plugin => ({
  name: 'externalize-wasm',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!source.endsWith('.wasm')) return null;
    const resolved = await this.resolve(source, importer, { skipSelf: true });
    if (!resolved) return null;
    return {
      id: `/@fs${resolved.id}`,
      external: true,
    };
  },
});

// The bridge output is generated, so build it before starting the Worker or this test pool.
export default defineConfig({
  plugins: [
    externalizeWasm(),
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.json',
      },
      miniflare: {
        modulesRules: [
          {
            type: 'CompiledWasm',
            include: ['**/*.wasm'],
          },
        ],
      },
    }),
  ],
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      reporter: [
        [
          'text',
          {
            skipFull: false,
          },
        ],
        'json',
        'json-summary',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
