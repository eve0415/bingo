import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    cloudflare({
      // Start names its server environment ssr, and the two plugins must agree on it or the wrapper's imports resolve outside workerd.
      viteEnvironment: {
        name: 'ssr',
      },
      // Builds and dev-serves the wrapper alongside, which is what makes the service binding live locally.
      auxiliaryWorkers: [
        {
          configPath: '../wrapper/wrangler.jsonc',
        },
      ],
      persistState: {
        path: '../.wrangler/state',
      },
    }),
    tanstackStart({
      srcDirectory: 'app',
    }),
    react(),
  ],
});
