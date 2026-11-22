import {
  ASK_REPLY_EVENT,
  type A2uiComponent,
  type AskAction,
  type ChatMessage,
  type DataModel,
  type JsonValue,
} from '@open-agent/shared';
import { CornerDownRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Surface } from '@/a2ui/surface.tsx';
import { toolSurfaceOf, type ToolLinePart } from '@/a2ui/tool-surfaces.ts';

type Part = ChatMessage['parts'][number];
export type ShowUiPart = Extract<Part, { type: 'tool-show_ui' }>;
export type AskPart = Extract<Part, { type: 'tool-ask' }>;

const SAVE_DELAY_MS = 500;

/** A tool the model used, as a status line drawn by the surface renderer. */
export function ToolLine({ part }: { part: ToolLinePart }) {
  const { t, i18n } = useTranslation();
  return <Surface surface={toolSurfaceOf(part, t, i18n.language)} dataModel={{}} readOnly />;
}

/**
 * An interface the model made (`show_ui`): drawn as it is written, then usable once the answer is done. A tick or a
 * choice shows at once and is saved half a second after the last one, for the user's other devices and the others in
 * the conversation; one the server refused is undone and said so. A button sends its text as the user's message.
 */
export function ShowUi({
  part,
  messageId,
  streaming,
  onSave,
  onSend,
}: {
  part: ShowUiPart;
  messageId: string;
  streaming: boolean;
  onSave: (messageId: string, toolCallId: string, dataModel: DataModel) => Promise<boolean>;
  /** `null` while nothing may be sent (an answer on its way). */
  onSend: ((text: string) => void) | null;
}) {
  const { t } = useTranslation();
  // The user's latest change, until it is saved: it wins over the saved copy meanwhile.
  const [draft, setDraft] = useState<DataModel | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; dataModel: DataModel } | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });
  // Leaving the page (or the conversation) still saves the last change.
  useEffect(
    () => () => {
      const last = pending.current;
      if (!last) return;
      clearTimeout(last.timer);
      void save.current(messageId, part.toolCallId, last.dataModel);
    },
    [messageId, part.toolCallId],
  );

  if (part.state === 'output-error') return null;
  if (part.state !== 'output-available') {
    return (
      <Surface
        surface={part.input}
        dataModel={part.state === 'input-streaming' ? {} : (part.input.dataModel ?? {})}
        purpose='show'
        streaming={part.state === 'input-streaming'}
        readOnly
      />
    );
  }

  const change = (dataModel: DataModel) => {
    setDraft(dataModel);
    setFailed(false);
    if (pending.current) clearTimeout(pending.current.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      void onSave(messageId, part.toolCallId, dataModel).then((saved) => {
        // A later change is on its way: it decides what shows.
        if (pending.current) return;
        setDraft(null);
        setFailed(!saved);
      });
    }, SAVE_DELAY_MS);
    pending.current = { timer, dataModel };
  };

  return (
    <div className='grid min-w-0 gap-1'>
      <Surface
        surface={part.input}
        dataModel={draft ?? part.output.dataModel}
        purpose='show'
        readOnly={streaming}
        onChange={change}
        onSend={onSend}
      />
      {failed && <p className='text-destructive text-sm'>{t('a2ui.saveFailed')}</p>}
    </div>
  );
}

/**
 * A question to the user, from the pre-analysis or from the model: its surface to fill and send while it waits, then
 * what was answered. One never answered (the user wrote something else, or a second question in the same answer) does
 * not show.
 */
export function Ask({
  part,
  onAnswer,
}: {
  part: AskPart;
  /** Only for the last answer, while nothing streams, and only for whom it asks. */
  onAnswer: ((toolCallId: string, action: AskAction) => void) | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DataModel | null>(null);
  if (part.state === 'output-error') return null;
  if (part.state === 'output-available') {
    const { action } = part.output;
    if (!action) return null;
    return (
      <div className='grid gap-2.5'>
        <Surface surface={part.input} dataModel={part.input.dataModel ?? {}} purpose='ask' readOnly hideInputs />
        <p className='text-primary flex items-start gap-1.5 text-sm font-medium'>
          <CornerDownRight className='mt-0.5 size-4 shrink-0' />
          <span className='whitespace-pre-wrap'>{answerOf(part.input.components, action)}</span>
        </p>
      </div>
    );
  }

  const waiting = part.state === 'input-available' && onAnswer !== null;
  return (
    <div className='grid gap-2.5'>
      <Surface
        surface={part.input}
        dataModel={draft ?? (part.state === 'input-streaming' ? {} : (part.input.dataModel ?? {}))}
        purpose='ask'
        streaming={part.state === 'input-streaming'}
        readOnly={!waiting}
        onChange={setDraft}
        onAction={(action) => onAnswer?.(part.toolCallId, action)}
      />
      {waiting && <p className='text-muted-foreground text-xs'>{t('chat.answerHint')}</p>}
    </div>
  );
}

/**
 * What the user answered, in words: the text they typed, else what the button sent (a chip's label rather than its
 * value), else the button's label.
 */
function answerOf(components: A2uiComponent[], action: AskAction): string {
  if (action.name === ASK_REPLY_EVENT) {
    const { text } = action.context;
    return typeof text === 'string' ? text : '';
  }
  const labels = new Map<string, string>();
  for (const component of components) {
    if (component.component !== 'ChoiceChips') continue;
    for (const option of component.options) labels.set(option.value, option.label);
  }
  const words = Object.values(action.context)
    .flatMap((value): JsonValue[] => (Array.isArray(value) ? value : [value]))
    .flatMap((value) => {
      if (typeof value === 'number') return [String(value)];
      if (typeof value !== 'string' || !value.trim()) return [];
      return [labels.get(value) ?? value];
    });
  if (words.length > 0) return words.join(', ');
  const button = components.find(
    (component) => component.component === 'Button' && component.action?.event.name === action.name,
  );
  return button?.component === 'Button' ? button.label : action.name;
}
