import type { DataModel } from '@open-agent/shared';

import type { ChatMessage } from './conversation.ts';

type Part = ChatMessage['parts'][number];

export type SurfaceStateChange =
  | { ok: true; message: ChatMessage }
  /** `not_found`: no such part. `invalid_request`: a part without a state to save (a question, a failed surface). */
  | { ok: false; reason: 'not_found' | 'invalid_request' };

/** The message with a `show_ui` surface's new state, which the model reads as the tool's output. */
export function withSurfaceState(message: ChatMessage, toolCallId: string, dataModel: DataModel): SurfaceStateChange {
  const part = message.parts.find((candidate) => 'toolCallId' in candidate && candidate.toolCallId === toolCallId);
  if (!part) return { ok: false, reason: 'not_found' };
  if (part.type !== 'tool-show_ui' || part.state !== 'output-available')
    return { ok: false, reason: 'invalid_request' };
  return {
    ok: true,
    message: {
      ...message,
      parts: message.parts.map((candidate): Part =>
        candidate === part ? { ...part, output: { dataModel } } : candidate,
      ),
    },
  };
}

/**
 * The history an answer ends with, keeping the surface states saved while it was being written: a participant may have
 * ticked an item meanwhile, and the answer's copy of the history is older.
 */
export function withSavedSurfaceStates(history: readonly ChatMessage[], saved: readonly ChatMessage[]): ChatMessage[] {
  const states = new Map(
    saved.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === 'tool-show_ui' && part.state === 'output-available' ? [[part.toolCallId, part.output]] : [],
      ),
    ),
  );
  return history.map((message) => ({
    ...message,
    parts: message.parts.map((part): Part => {
      if (part.type !== 'tool-show_ui' || part.state !== 'output-available') return part;
      const output = states.get(part.toolCallId);
      return output ? { ...part, output } : part;
    }),
  }));
}
