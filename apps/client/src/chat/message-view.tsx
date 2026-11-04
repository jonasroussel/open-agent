import { fileKindOf, MAX_ASK_OPTIONS, type ChatMessage, type MemoryNotice, type WebResult } from '@open-agent/shared';
import { Link } from '@tanstack/react-router';
import {
  AppWindow,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronRight,
  CornerDownRight,
  Copy,
  FileText,
  Globe,
  Lightbulb,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandIcon } from '@/components/brand-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { FileChip } from '@/files/file-chip.tsx';
import { cn } from '@/lib/utils.ts';

import { ContextToolLine, isContextToolPart } from './context-tool-line.tsx';
import { isMadeFilePart, MadeFile } from './made-file.tsx';
import { Markdown } from './markdown-loader.ts';

function partsText(message: ChatMessage, type: 'text' | 'reasoning'): string {
  return message.parts
    .flatMap((part) => (part.type === type ? [part.text] : []))
    .join('\n\n')
    .trim();
}

/**
 * The user's message: its files, then an indigo bubble on the right, which can be copied, edited (the answers after
 * it are redone), or remembered.
 */
export function UserMessage({
  message,
  canEdit,
  onEdit,
  onRemember,
  onUndoMemory,
}: {
  message: ChatMessage;
  canEdit: boolean;
  onEdit: (text: string) => void;
  /** `null` back: the memory already holds it. Only once the message is saved, so not while its answer streams. */
  onRemember: (() => Promise<MemoryNotice | null | 'failed'>) | null;
  onUndoMemory: (notice: MemoryNotice) => Promise<UndoOutcome>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  // What "Remember" gave, shown under the message for this visit: the memory page keeps the rule itself.
  const [remembered, setRemembered] = useState<MemoryNotice | 'pending' | 'known' | 'failed' | null>(null);
  const text = partsText(message, 'text');
  const files = message.parts.flatMap((part) => (part.type === 'file' ? [part] : []));
  const command = message.metadata?.command;

  async function remember() {
    if (!onRemember) return;
    setRemembered('pending');
    const result = await onRemember();
    setRemembered(result ?? 'known');
  }

  async function undo(notice: MemoryNotice): Promise<UndoOutcome> {
    const outcome = await onUndoMemory(notice);
    if (outcome === 'undone') setRemembered({ ...notice, undone: true });
    return outcome;
  }

  if (draft !== null) {
    return (
      <div className='ml-auto grid w-full max-w-[85%] gap-2'>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className='field-sizing-content max-h-72 min-h-20 text-base'
          autoFocus
        />
        <div className='flex justify-end gap-2'>
          <Button variant='ghost' onClick={() => setDraft(null)}>
            {t('chat.cancel')}
          </Button>
          <Button
            disabled={!draft.trim() && files.length === 0}
            onClick={() => {
              onEdit(draft.trim());
              setDraft(null);
            }}
          >
            {t('chat.resend')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='group flex flex-col items-end gap-1'>
      {files.length > 0 && (
        <div className='flex max-w-[85%] flex-wrap justify-end gap-2'>
          {files.map((file) => (
            <FileChip
              key={file.url}
              name={file.filename ?? ''}
              kind={fileKindOf(file.filename ?? '', file.mediaType)}
              url={file.url}
            />
          ))}
        </div>
      )}
      {(text || command) && (
        <div className='bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap'>
          {command && (
            <span
              className={cn(
                'bg-primary-foreground/15 inline-flex rounded-full px-2 py-0.5 text-sm font-medium',
                text && 'mr-1.5',
              )}
            >
              /{command.name}
            </span>
          )}
          {text}
        </div>
      )}
      <MessageActions>
        {text && <CopyButton text={text} />}
        {canEdit && (
          <ActionButton label={t('chat.edit')} onClick={() => setDraft(text)}>
            <Pencil />
          </ActionButton>
        )}
        {text && onRemember && (
          <ActionButton label={t('chat.remember')} onClick={() => void remember()} disabled={remembered === 'pending'}>
            <BookmarkPlus />
          </ActionButton>
        )}
      </MessageActions>
      {typeof remembered === 'object' && remembered !== null && (
        <MemoryNoticeLine notice={remembered} onUndo={() => undo(remembered)} />
      )}
      {remembered === 'known' && <p className='text-muted-foreground text-sm'>{t('memory.alreadyKnown')}</p>}
      {remembered === 'failed' && <p className='text-destructive text-sm'>{t('memory.rememberFailed')}</p>}
    </div>
  );
}

/** The assistant's answer: Markdown in a grey bubble, next to the app's icon, and what it remembered under it. */
export function AssistantMessage({
  message,
  streaming,
  onRegenerate,
  onUndoMemory,
  onOpenDocument,
  onAnswer,
}: {
  message: ChatMessage;
  streaming: boolean;
  onRegenerate: (() => void) | null;
  onUndoMemory: (notice: MemoryNotice) => Promise<UndoOutcome>;
  onOpenDocument: (id: string) => void;
  /** Only for the last answer, while nothing streams: the user may still answer its questions. */
  onAnswer: ((toolCallId: string, answer: string) => void) | null;
}) {
  const { t } = useTranslation();
  const text = partsText(message, 'text');
  const deepThinking = message.metadata?.route === 'reasoning';
  const notices = message.parts.flatMap((part) => (part.type === 'data-memory' ? [part.data] : []));
  const searches = message.parts.flatMap((part) => (part.type === 'tool-web_search' ? [part] : []));
  const lookups = message.parts.filter(isContextToolPart);
  const lookingUp = lookups.some((part) => part.state === 'input-streaming' || part.state === 'input-available');
  // A failed try the model then made right is no news for the user.
  const made = message.parts
    .filter(isMadeFilePart)
    .filter(
      (part, index, all) =>
        part.state !== 'output-error' ||
        !all.slice(index + 1).some((later) => later.type === part.type && later.state === 'output-available'),
    );
  const documents = message.parts.flatMap((part) =>
    part.type === 'tool-create_document' || part.type === 'tool-update_document' ? [part] : [],
  );
  const questions = message.parts.flatMap((part) => (part.type === 'tool-ask_user' ? [part] : []));
  const asking = questions.some((part) => part.state !== 'output-available');
  return (
    <div className='group flex gap-3'>
      <BrandIcon className='mt-1 size-7' />
      <div className='flex min-w-0 flex-1 flex-col items-start gap-2'>
        {/* `grid-cols-1` is `minmax(0, 1fr)`: a long code line scrolls in its block instead of widening the bubble. */}
        <div className='bg-muted grid max-w-full min-w-0 grid-cols-1 gap-2 rounded-2xl rounded-tl-md px-4 py-3'>
          {/* A question comes before the work its answer led to. */}
          {questions.map((part) => (
            <Question key={part.toolCallId} part={part} onAnswer={onAnswer} />
          ))}
          {deepThinking && <Reasoning text={partsText(message, 'reasoning')} thinking={streaming && !text} />}
          {searches.map((search) => (
            <WebSearchLine
              key={search.toolCallId}
              query={search.input?.query ?? ''}
              results={search.state === 'output-available' ? search.output.results : null}
              failed={search.state === 'output-error'}
            />
          ))}
          {lookups.map((part) => (
            <ContextToolLine key={part.toolCallId} part={part} />
          ))}
          {documents.map((part) => (
            <DocumentCard key={part.toolCallId} part={part} onOpen={onOpenDocument} />
          ))}
          {made.map((part) => (
            <MadeFile key={part.toolCallId} part={part} />
          ))}
          {text ? (
            <Suspense fallback={<p className='text-[15px] leading-relaxed whitespace-pre-wrap'>{text}</p>}>
              <Markdown text={text} streaming={streaming} />
            </Suspense>
          ) : (
            !deepThinking &&
            streaming &&
            documents.length === 0 &&
            made.length === 0 &&
            !asking &&
            !lookingUp && <Dots />
          )}
        </div>
        {notices.map((notice) => (
          <MemoryNoticeLine key={notice.changeId} notice={notice} onUndo={() => onUndoMemory(notice)} />
        ))}
        {!streaming && (
          <MessageActions>
            <CopyButton text={text} />
            {onRegenerate && (
              <ActionButton label={t('chat.regenerate')} onClick={onRegenerate}>
                <RotateCcw />
              </ActionButton>
            )}
          </MessageActions>
        )}
      </div>
    </div>
  );
}

type QuestionPart = Extract<ChatMessage['parts'][number], { type: 'tool-ask_user' }>;

/**
 * A question to the user, from the pre-analysis or from the model: answers to tap while it waits, then the one given.
 * A question the model was not allowed to ask (a second one in the same answer) does not show.
 */
function Question({
  part,
  onAnswer,
}: {
  part: QuestionPart;
  onAnswer: ((toolCallId: string, answer: string) => void) | null;
}) {
  const { t } = useTranslation();
  if (part.state === 'input-streaming' || !part.input) return null;
  const answer = part.state === 'output-available' ? part.output.answer : undefined;
  if (answer === null) return null;
  const waiting = answer === undefined && onAnswer !== null;
  return (
    <div className='grid gap-2.5'>
      <p className='text-[15px] leading-relaxed whitespace-pre-wrap'>{part.input.question}</p>
      {waiting && (part.input.options?.length ?? 0) > 0 && (
        <div className='flex flex-wrap gap-2'>
          {part.input.options!.slice(0, MAX_ASK_OPTIONS).map((option) => (
            <Button
              key={option}
              variant='outline'
              size='sm'
              className='bg-background h-auto min-h-8 rounded-full py-1.5 text-left whitespace-normal'
              onClick={() => onAnswer(part.toolCallId, option)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      {waiting && <p className='text-muted-foreground text-xs'>{t('chat.answerHint')}</p>}
      {answer !== undefined && (
        <p className='text-primary flex items-start gap-1.5 text-sm font-medium'>
          <CornerDownRight className='mt-0.5 size-4 shrink-0' />
          <span className='whitespace-pre-wrap'>{answer}</span>
        </p>
      )}
    </div>
  );
}

type DocumentPart = Extract<ChatMessage['parts'][number], { type: 'tool-create_document' | 'tool-update_document' }>;

/** A document the answer wrote in the canvas: its title and version; it opens the canvas. */
function DocumentCard({ part, onOpen }: { part: DocumentPart; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const input = part.input as Partial<{ id: string; kind: 'document' | 'html'; title: string }> | undefined;
  const output = part.state === 'output-available' ? part.output : null;
  const id = output?.id ?? input?.id ?? null;
  const kind = output?.kind ?? input?.kind ?? 'document';
  const writing = part.state === 'input-streaming' || part.state === 'input-available';
  const Icon = kind === 'html' ? AppWindow : FileText;
  let status = t('canvas.version', { version: output?.version });
  if (writing) status = part.type === 'tool-create_document' ? t('canvas.writing') : t('canvas.updating');
  if (part.state === 'output-error') status = t('canvas.writeFailed');

  return (
    <button
      type='button'
      disabled={!id}
      onClick={() => id && onOpen(id)}
      className='bg-background hover:border-ring/50 flex max-w-full min-w-0 items-center gap-3 justify-self-start rounded-xl border px-3 py-2.5 text-left transition-colors'
    >
      <span className='bg-secondary text-secondary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' />
      </span>
      <span className='grid min-w-0'>
        <span className='truncate text-sm font-medium'>{output?.title ?? input?.title ?? t('canvas.untitled')}</span>
        <span className={cn('text-muted-foreground text-xs', writing && 'animate-pulse')}>{status}</span>
      </span>
    </button>
  );
}

/** How an undo ended: done, refused because the rule moved since, or failed for another reason. */
export type UndoOutcome = 'undone' | 'changed' | 'unchanged';

/** "Remembered: …" under the answer to the remark: the rule on its own lines, then Undo and a link to the memory. */
function MemoryNoticeLine({ notice, onUndo }: { notice: MemoryNotice; onUndo: () => Promise<UndoOutcome> }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  // An undo the server refused is said as such: the rule is not back, so nothing may show it as undone.
  const [changed, setChanged] = useState(false);
  const labels = {
    add: () => t('memory.added', { after: notice.after }),
    update: () => t('memory.updated', { before: notice.before, after: notice.after }),
    delete: () => t('memory.deleted', { before: notice.before }),
  };
  const label = labels[notice.operation]();
  // Where the Undo button was once it is spent: undone, or refused because the rule moved since.
  let conclusion: ReactNode = null;
  if (notice.undone) conclusion = <span className='text-muted-foreground'>{t('memory.undone')}</span>;
  else if (changed) conclusion = <span className='text-muted-foreground'>{t('errors.memory_changed')}</span>;
  return (
    <div
      className={cn(
        'border-primary/20 bg-secondary/40 flex max-w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        notice.undone && 'opacity-60',
      )}
    >
      <BookmarkCheck className='text-secondary-foreground mt-0.5 size-4 shrink-0' />
      <div className='grid min-w-0 gap-2'>
        <p className={cn('text-secondary-foreground leading-relaxed', notice.undone && 'line-through')}>{label}</p>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
          {conclusion ?? (
            <button
              type='button'
              disabled={pending}
              onClick={() => {
                setPending(true);
                void onUndo()
                  .then((outcome) => setChanged(outcome === 'changed'))
                  .finally(() => setPending(false));
              }}
              className='text-secondary-foreground font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50'
            >
              {t('memory.undo')}
            </button>
          )}
          <Link to='/memory' className='text-muted-foreground hover:text-foreground'>
            {t('memory.seeAll')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Deep thinking" line of an answer that needed it: pulsing while the model thinks, and its thoughts folded
 * underneath for the curious.
 */
function Reasoning({ text, thinking }: { text: string; thinking: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className='text-muted-foreground text-sm'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        disabled={!text}
        aria-expanded={open}
        className='hover:text-foreground flex items-center gap-1.5 disabled:hover:text-inherit'
      >
        <Lightbulb className={cn('size-4', thinking && 'animate-pulse')} />
        <span className={cn(thinking && 'animate-pulse')}>{thinking ? t('chat.thinking') : t('chat.thought')}</span>
        {text && <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && <p className='mt-2 border-l-2 pl-3 whitespace-pre-wrap'>{text}</p>}
    </div>
  );
}

/** A search the model made: pulsing while it runs, then the sites it read, as links (one per site). */
function WebSearchLine({ query, results, failed }: { query: string; results: WebResult[] | null; failed: boolean }) {
  const { t } = useTranslation();
  const searching = !results && !failed;
  const sites = new Map<string, WebResult>();
  for (const result of results ?? []) {
    const site = new URL(result.url).hostname.replace(/^www\./, '');
    if (!sites.has(site)) sites.set(site, result);
  }
  let label = t('chat.searched', { query });
  if (searching) label = t('chat.searching', { query });
  if (failed) label = t('chat.searchFailed');

  return (
    <div className='text-muted-foreground grid gap-2 text-sm'>
      <div className={cn('flex items-center gap-1.5', searching && 'animate-pulse')}>
        <Globe className='size-4 shrink-0' />
        <span className='min-w-0'>{label}</span>
      </div>
      {sites.size > 0 && (
        <ul className='flex flex-wrap gap-1.5'>
          {[...sites].map(([site, result]) => (
            <li key={site}>
              <a
                href={result.url}
                target='_blank'
                rel='noreferrer'
                title={result.title}
                className='bg-background hover:text-foreground block max-w-48 truncate rounded-full border px-2.5 py-0.5 text-xs'
              >
                {site}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dots() {
  return (
    <div className='flex items-center gap-1 py-1.5' aria-busy='true'>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className='bg-muted-foreground/60 size-1.5 animate-bounce rounded-full'
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

/** While the answer has not started (the pre-analysis runs): three dots in an empty bubble. */
export function PendingAnswer() {
  return (
    <div className='flex gap-3'>
      <BrandIcon className='mt-1 size-7' />
      <div className='bg-muted rounded-2xl rounded-tl-md px-4 py-2.5'>
        <Dots />
      </div>
    </div>
  );
}

/** Shown on hover with a mouse; always visible on a touch screen, which has no hover. */
function MessageActions({ children }: { children: ReactNode }) {
  return (
    <div className='text-muted-foreground flex gap-0.5 opacity-100 transition-opacity group-hover:opacity-100 pointer-fine:opacity-0'>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button variant='ghost' size='icon-sm' aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <ActionButton
      label={copied ? t('chat.copied') : t('chat.copy')}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </ActionButton>
  );
}
