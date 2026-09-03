import { createFileRoute } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';

import { identify } from '../../../proxy';

// Every path under a room is identified here rather than in the routes beneath it, so a route added later cannot be the one that forgets.
const identified = createMiddleware({
  type: 'request',
}).server(async ({ request, next }) => {
  const identity = await identify(request);
  if (identity instanceof Response) return identity;
  return await next({
    context: {
      identity,
    },
  });
});

export const Route = createFileRoute('/rooms/$roomId')({
  server: {
    middleware: [identified],
  },
});
