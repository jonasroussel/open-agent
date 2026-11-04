import { createContext, use, useEffect } from 'react';

/**
 * `rename`: the title can be edited in the top bar, and this saves it. `conversationId`: the top bar shows who the
 * conversation is shared with, and lets the owner share it. `ephemeral`: the conversation is outside the history;
 * `setEphemeral`: the top bar offers to switch, on a new conversation.
 */
export type PageTitle = {
  text: string;
  rename?: (title: string) => Promise<void>;
  conversationId?: string;
  ephemeral?: boolean;
  setEphemeral?: (ephemeral: boolean) => void;
};

export const PageTitleContext = createContext<(title: PageTitle | null) => void>(() => {});

/** Shows `title` in the top bar while the page is open. The functions must keep their identity (`useCallback`). */
export function usePageTitle(
  title: string | null,
  { rename, conversationId, ephemeral, setEphemeral }: Omit<PageTitle, 'text'> = {},
) {
  const setTitle = use(PageTitleContext);
  useEffect(() => {
    setTitle(title === null ? null : { text: title, rename, conversationId, ephemeral, setEphemeral });
    return () => setTitle(null);
  }, [title, rename, conversationId, ephemeral, setEphemeral, setTitle]);
}
