import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Start's entry imports resolve through its own plugin, so the pool boots the deployed worker rather than a stand-in for it.
    tanstackStart({
      srcDirectory: 'app',
    }),
    react(),
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.jsonc',
      },
      miniflare: {
        bindings: {
          SESSION_HMAC_SECRET: 'test-session-secret',
          DISCORD_CLIENT_ID: 'test-client-id',
          DISCORD_CLIENT_SECRET: 'test-client-secret',
          DISCORD_BOT_TOKEN: 'test-bot-token',
        },
        serviceBindings: {
          WRAPPER: {
            name: 'wrapper-stub',
          },
        },
        // Stands in for the wrapper worker and reports what actually crossed the binding, which is what the header tests assert on.
        // It runs in workerd rather than beside the pool so that it can complete a real upgrade, which is the one response a proxy can only pass along.
        workers: [
          {
            name: 'wrapper-stub',
            modules: true,
            script: `export default {
              fetch(request) {
                const path = new URL(request.url).pathname;
                const identity = request.headers.get('x-bingo-verified-identity');
                if (request.headers.get('Upgrade') !== 'websocket') return Response.json({ identity, path });
                const pair = new WebSocketPair();
                pair[1].accept();
                pair[1].send(JSON.stringify({ identity, path }));
                return new Response(null, { status: 101, webSocket: pair[0] });
              },
            };`,
          },
        ],
      },
    }),
  ],
  test: {
    coverage: {
      provider: 'istanbul',
      // Everything the worker serves is reached through the tests; the browser handshake alone needs a DOM.
      include: ['app/**/*.ts'],
      exclude: ['app/discord.ts', 'app/routeTree.gen.ts'],
      reporter: [
        [
          'text',
          {
            skipFull: false,
          },
        ],
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
