import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export const getRouter = (): ReturnType<typeof createRouter> =>
  createRouter({
    routeTree,
    scrollRestoration: true,
  });
