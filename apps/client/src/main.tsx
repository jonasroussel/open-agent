import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import './index.css';
import { i18n } from './i18n/i18n.ts';
import { queryClient } from './lib/query-client.ts';
import { router } from './router.tsx';

/** Long enough for a slow connection; past it the page shows in the system font rather than stay on the loader. */
const FONT_WAIT_MS = 3000;

function fontLoaded(): Promise<unknown> {
  // Not `Promise.withResolvers`: it needs Safari 17.4, and the client targets ES2023.
  const timeout = new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS));
  return Promise.race([document.fonts.load('1em "Figtree Variable"'), timeout]);
}

// The loading screen of `index.html` stays until the font and the first page's data (session, sidebar icons) are
// there, so nothing flickers once the app shows.
await Promise.all([fontLoaded(), router.load()]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
