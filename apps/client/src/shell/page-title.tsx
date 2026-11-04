import { createContext, use, useEffect } from 'react';

/**
 * `rename`: the title can be edited in the top bar, and this saves it. `conversationId`: the top bar shows who the
 * conversation is shared with, and lets the owner share it.
 */
export type PageTitle = { text: string; rename?: (title: string) => Promise<void>; conversationId?: string };

export const PageTitleContext = createContext<(title: PageTitle | null) => void>(() => {});

/** Shows `title` in the top bar while the page is open. `rename` must keep its identity (`useCallback`). */
export function usePageTitle(title: string | null, rename?: (title: string) => Promise<void>, conversationId?: string) {
  const setTitle = use(PageTitleContext);
  useEffect(() => {
    setTitle(title === null ? null : { text: title, rename, conversationId });
    return () => setTitle(null);
  }, [title, rename, conversationId, setTitle]);
}
