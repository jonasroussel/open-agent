import type { ChatMessage } from '@open-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useIsMobile } from '@/hooks/use-mobile.ts';

import { CanvasPanel } from './canvas-panel.tsx';
import { artifactQuery, liveDocumentOf, writtenDocumentOf, type LiveDocument } from './canvas-query.ts';
import { rememberOpenCanvas } from './open-canvas.ts';

/**
 * The document open beside the page of conversation `pageId` (`?doc=`), and the way to open, switch or close it.
 * Opening, switching or closing it, here or by the model, is remembered for when the user comes back.
 */
export function useCanvas(pageId: string) {
  const navigate = useNavigate();
  const { doc } = useSearch({ strict: false }) as { doc?: string };
  useEffect(() => rememberOpenCanvas(pageId, doc ?? null), [pageId, doc]);
  const openDocument = useCallback(
    (id: string | null) =>
      void navigate({ to: '/c/$conversationId', params: { conversationId: pageId }, search: id ? { doc: id } : {} }),
    [navigate, pageId],
  );
  return { doc, openDocument };
}

/** One conversation's document being written, shown in the canvas as it comes. */
export type DocumentFollow = {
  live: LiveDocument | null;
  /** The document just written is now loaded at its saved version. */
  liveSaved: () => void;
  /** The user closed the canvas: it stays closed for the rest of this answer. */
  close: () => void;
};

/** Follows the documents the model writes in one conversation: the canvas opens on them, then on their saved version. */
export function useDocumentFollow(
  messages: ChatMessage[],
  busy: boolean,
  openDocument: (id: string | null) => void,
): DocumentFollow {
  const queryClient = useQueryClient();
  const answering = busy ? messages.at(-1) : undefined;
  // On a phone the canvas covers the whole screen: it opens only when the user taps a document, never by itself.
  const followsWriting = !useIsMobile();
  const writing = followsWriting ? liveDocumentOf(answering) : null;
  // Closing the canvas while the model writes keeps it closed for that answer only.
  const [closedDuring, setClosedDuring] = useState<string | null>(null);
  const liveClosed = answering !== undefined && closedDuring === answering.id;
  // A document written during this answer opens once saved; one only seen in the history does not.
  const followLive = useRef(false);
  // From the end of the writing until its saved version is loaded, the canvas keeps the document as written: closing
  // for a frame, then "Loading…", flashed on a phone.
  const [handingOff, setHandingOff] = useState(false);

  // Set while rendering: the panel must hold the document from the very render the writing ends in.
  if (writing && !liveClosed && !handingOff) setHandingOff(true);
  useEffect(() => {
    if (writing && !liveClosed) followLive.current = true;
  }, [writing, liveClosed]);
  const written = writtenDocumentOf(messages.at(-1));
  const writtenId = written?.id ?? null;
  useEffect(() => {
    if (!writtenId || !followLive.current) return;
    followLive.current = false;
    void queryClient.invalidateQueries({ queryKey: artifactQuery(writtenId).queryKey });
    openDocument(writtenId);
  }, [writtenId, queryClient, openDocument]);
  const liveSaved = useCallback(() => setHandingOff(false), []);

  const close = () => {
    followLive.current = false;
    setHandingOff(false);
    if (answering) setClosedDuring(answering.id);
  };
  const live = (writing && !liveClosed ? writing : null) ?? (handingOff ? written : null);
  return { live, liveSaved, close };
}

const noop = () => {};

/**
 * The one canvas of a page: the document open there, or the one being written in any of the page's conversations
 * (a comparison has two).
 */
export function ConversationCanvas({
  doc,
  follows,
  openDocument,
}: {
  doc: string | undefined;
  follows: DocumentFollow[];
  openDocument: (id: string | null) => void;
}) {
  const shown = follows.find((follow) => follow.live !== null);
  const live = shown?.live ?? null;
  if (live === null && doc === undefined) return null;

  const close = () => {
    for (const follow of follows) follow.close();
    openDocument(null);
  };
  return (
    <CanvasPanel
      documentId={doc ?? live?.id ?? null}
      live={live}
      onLiveSaved={shown?.liveSaved ?? noop}
      onClose={close}
    />
  );
}
