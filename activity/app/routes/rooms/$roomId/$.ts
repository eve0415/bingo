import { createFileRoute } from '@tanstack/react-router';

import { forward } from '../../../proxy';

// The room's own paths are the wrapper's to define, so every one of them is carried across under the identity the parent route established.
export const Route = createFileRoute('/rooms/$roomId/$')({
  server: {
    handlers: {
      ANY: async ({ request, context }): Promise<Response> => await forward(request, context.identity),
    },
  },
});
