/** The document open in each conversation's canvas, kept on this device, so coming back to it opens it again. */
const STORAGE_KEY = 'open-canvas';
/** Enough for every recent conversation; the oldest are dropped past it. */
const MAX_REMEMBERED = 100;

function read(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function openCanvasOf(conversationId: string): string | null {
  return read()[conversationId] ?? null;
}

/** `null`: the canvas was closed there. */
export function rememberOpenCanvas(conversationId: string, documentId: string | null): void {
  const open = read();
  if ((open[conversationId] ?? null) === documentId) return;
  delete open[conversationId];
  if (documentId) open[conversationId] = documentId;
  // Insertion order: the last opened comes last, the oldest first.
  const kept = Object.entries(open).slice(-MAX_REMEMBERED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
}
