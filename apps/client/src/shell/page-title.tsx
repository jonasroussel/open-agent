import { createContext, use, useEffect } from 'react';

export const PageTitleContext = createContext<(title: string | null) => void>(() => {});

/** Shows `title` in the top bar while the page is open. */
export function usePageTitle(title: string | null) {
  const setTitle = use(PageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}
