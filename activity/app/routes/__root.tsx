import type { JSX, ReactNode } from 'react';

// The numerals are the hero of this interface, so their two weights are fetched before the first paint rather than swapped in after it.
import barlowSemibold from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2?url';
import barlowBold from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2?url';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';

import theme from '../theme.css?url';

// Start owns the document: there is no index.html, so this markup and Scripts are what load the client at all.
const RootDocument = ({ children }: Readonly<{ children: ReactNode }>): JSX.Element => (
  <html lang="ja">
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
        name: 'theme-color',
        content: '#1c2129',
      },
      {
        title: 'Bingo',
      },
    ],
    links: [
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: barlowSemibold,
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: barlowBold,
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: theme,
      },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});
