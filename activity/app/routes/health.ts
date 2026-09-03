import { createFileRoute } from '@tanstack/react-router';

import { forward } from '../proxy';

// Unauthenticated on purpose: it reports whether the binding is reachable, which is true of no particular player.
export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      ANY: async ({ request }): Promise<Response> => await forward(request, null),
    },
  },
});
