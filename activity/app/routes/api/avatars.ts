import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';

import { guildAvatars } from '../../avatars';

export const Route = createFileRoute('/api/avatars')({
  server: {
    handlers: {
      GET: async ({ request }): Promise<Response> => await guildAvatars(env, request),
    },
  },
});
