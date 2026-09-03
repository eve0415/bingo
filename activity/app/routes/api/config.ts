import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';

import { activityConfig } from '../../session';

export const Route = createFileRoute('/api/config')({
  server: {
    handlers: {
      GET: (): Response => activityConfig(env),
    },
  },
});
