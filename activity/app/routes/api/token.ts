import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';

import { createSession } from '../../session';

export const Route = createFileRoute('/api/token')({
  server: {
    handlers: {
      POST: async ({ request }): Promise<Response> => createSession(env, request),
    },
  },
});
