import type { JSX, ReactNode } from 'react';

import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';

// Start owns the document: there is no index.html, so this markup and Scripts are what load the client at all.
const RootDocument = ({ children }: Readonly<{ children: ReactNode }>): JSX.Element => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: 'Bingo',
      },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});
