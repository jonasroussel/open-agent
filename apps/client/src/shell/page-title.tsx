import { createContext, use, useEffect } from 'react';

/** `rename`: the title can be edited in the top bar, and this saves it. */
export type PageTitle = { text: string; rename?: (title: string) => Promise<void> };

export const PageTitleContext = createContext<(title: PageTitle | null) => void>(() => {});

/** Shows `title` in the top bar while the page is open. `rename` must keep its identity (`useCallback`). */
export function usePageTitle(title: string | null, rename?: (title: string) => Promise<void>) {
  const setTitle = use(PageTitleContext);
  useEffect(() => {
    setTitle(title === null ? null : { text: title, rename });
    return () => setTitle(null);
  }, [title, rename, setTitle]);
}
