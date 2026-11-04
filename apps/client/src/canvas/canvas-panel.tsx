import { type ArtifactResponse } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { AppWindow, Check, ChevronDown, Code, Copy, Download, Eye, FileText, Printer, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { i18n } from '@/i18n/i18n.ts';
import { cn } from '@/lib/utils.ts';

import { artifactQuery, artifactVersionQuery, saveArtifact, type LiveDocument } from './canvas-query.ts';
import { downloadHtml, downloadWord, printDocument } from './export.ts';

const loadEditor = () => import('./document-editor.tsx');
const DocumentEditor = lazy(loadEditor);
const noop = () => {};

/** Typing pauses this long before the edit is saved. */
const SAVE_DELAY_MS = 1200;

/**
 * The canvas, next to the conversation (over it on a phone): the document the model is writing, as it comes, or a
 * saved document to edit like in Word, with its versions and exports. An HTML page shows live, sandboxed.
 */
export function CanvasPanel({
  documentId,
  live,
  onLiveSaved,
  onClose,
}: {
  documentId: string | null;
  live: LiveDocument | null;
  /** The document just written is now loaded at its saved version: the canvas shows that one from now on. */
  onLiveSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const saved = useQuery({ ...artifactQuery(documentId ?? ''), enabled: documentId !== null });
  const liveSaved = live?.version !== undefined && (saved.data?.artifact.version ?? 0) >= live.version;
  const showLive = live !== null && !liveSaved && (live.id === null || live.id === documentId || documentId === null);

  // Fetched while the model writes, so the saved document does not wait for it.
  useEffect(() => void loadEditor(), []);
  useEffect(() => {
    if (liveSaved) onLiveSaved();
  }, [liveSaved, onLiveSaved]);

  return (
    <aside className='bg-background fixed inset-0 z-50 flex flex-col md:static md:z-auto md:w-[52%] md:max-w-3xl md:min-w-0 md:border-l'>
      {showLive ? (
        <LiveView live={live} onClose={onClose} />
      ) : (
        documentId && <SavedView key={documentId} id={documentId} onClose={onClose} />
      )}
      {!showLive && !documentId && <p className='text-muted-foreground p-6'>{t('canvas.empty')}</p>}
    </aside>
  );
}

function PanelHeader({
  icon,
  title,
  status,
  children,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  status: React.ReactNode;
  children?: React.ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className='flex h-12 shrink-0 items-center gap-2 border-b px-3'>
      <span className='text-muted-foreground'>{icon}</span>
      <div className='grid min-w-0 flex-1'>
        <h2 className='truncate text-sm font-semibold'>{title}</h2>
        <span className='text-muted-foreground truncate text-xs'>{status}</span>
      </div>
      {children}
      <Button variant='ghost' size='icon' onClick={onClose} aria-label={t('canvas.close')} title={t('canvas.close')}>
        <X />
      </Button>
    </header>
  );
}

/**
 * While the model writes: read-only, in the same editor as the saved document, so the end of the writing changes
 * nothing on screen. Then, until its saved version is loaded, the document as written.
 */
function LiveView({ live, onClose }: { live: LiveDocument; onClose: () => void }) {
  const { t } = useTranslation();
  const html = live.kind === 'html';
  return (
    <>
      <PanelHeader
        icon={html ? <AppWindow className='size-4' /> : <FileText className='size-4' />}
        title={live.title ?? t('canvas.untitled')}
        status={<span className='animate-pulse'>{live.version ? t('canvas.saving') : t('canvas.writing')}</span>}
        onClose={onClose}
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {html ? (
          <pre className='p-4 font-mono text-xs whitespace-pre-wrap'>{live.content}</pre>
        ) : (
          <Suspense fallback={<p className='px-6 py-6 whitespace-pre-wrap md:px-10'>{live.content}</p>}>
            <DocumentEditor markdown={live.content} editable={false} onChange={noop} onReady={noop} />
          </Suspense>
        )}
      </div>
    </>
  );
}

type SaveState = 'saved' | 'saving' | 'conflict' | 'failed';

/** A saved document: edited and saved as the user types, or an old version shown to bring back. */
function SavedView({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const opened = useQuery(artifactQuery(id));
  // An old version picked while `latest` was the newest: a newer version, written meanwhile, shows instead.
  const [picked, setPicked] = useState<{ number: number; latest: number } | null>(null);
  const viewing = picked !== null && picked.latest === opened.data?.artifact.version ? picked.number : null;
  const view = (number: number | null) =>
    setPicked(number === null || !opened.data ? null : { number, latest: opened.data.artifact.version });
  const old = useQuery({ ...artifactVersionQuery(id, viewing ?? 0), enabled: viewing !== null });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [htmlTab, setHtmlTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  // What the editor holds: the version it was loaded from, and the text the user typed since. Taken from the cache at
  // once when it is there, so a document opens without a "Loading…" frame.
  const [loaded, setLoaded] = useState<{ version: number; content: string } | null>(() =>
    opened.data ? { version: opened.data.artifact.version, content: opened.data.content } : null,
  );
  const draft = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new version written by the model (or loaded first) replaces the editor's text; the user's own saves do not.
  useEffect(() => {
    const data = opened.data;
    if (!data || loaded?.version === data.artifact.version) return;
    const ours = loaded !== null && data.versions[0]?.author === 'user' && draft.current !== null;
    setLoaded({ version: data.artifact.version, content: ours ? (draft.current ?? data.content) : data.content });
  }, [opened.data, loaded]);

  const save = useCallback(
    // `restoredFrom`: an old version brought back, so the model learns its later changes were undone.
    async (content: string, restoredFrom?: number) => {
      const base = queryClient.getQueryData<ArtifactResponse>(artifactQuery(id).queryKey);
      if (!base) return;
      setSaveState('saving');
      const result = await saveArtifact(id, { content, baseVersion: base.artifact.version, restoredFrom });
      if (!result.ok) {
        setSaveState(result.error === 'artifact_changed' ? 'conflict' : 'failed');
        draft.current = null;
        if (result.error === 'artifact_changed') {
          setLoaded(null);
          void queryClient.invalidateQueries({ queryKey: artifactQuery(id).queryKey });
        }
        return;
      }
      queryClient.setQueryData<ArtifactResponse>(
        artifactQuery(id).queryKey,
        (current) => current && { ...current, artifact: result.data.artifact, content },
      );
      setLoaded({ version: result.data.artifact.version, content });
      void queryClient.invalidateQueries({ queryKey: artifactQuery(id).queryKey });
      setSaveState('saved');
    },
    [id, queryClient],
  );

  const onChange = useCallback(
    (content: string) => {
      draft.current = content;
      setSaveState('saving');
      clearTimeout(timer.current ?? undefined);
      timer.current = setTimeout(() => void save(content), SAVE_DELAY_MS);
    },
    [save],
  );

  // Leaving the document saves what was typed last.
  useEffect(
    () => () => {
      if (timer.current && draft.current !== null) {
        clearTimeout(timer.current);
        void save(draft.current);
      }
    },
    [save],
  );

  if (!opened.data || !loaded) {
    return (
      <PanelHeader
        icon={<FileText className='size-4' />}
        title={opened.isError ? t('canvas.missing') : t('canvas.loading')}
        status=''
        onClose={onClose}
      />
    );
  }

  const { artifact, versions } = opened.data;
  const html = artifact.kind === 'html';
  const shownContent = viewing === null ? loaded.content : (old.data?.content ?? '');
  const statusLabel = {
    saved: t('canvas.saved', { version: artifact.version }),
    saving: t('canvas.saving'),
    conflict: t('canvas.conflict'),
    failed: t('canvas.saveFailed'),
  }[saveState];
  const timeFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  async function restore() {
    if (viewing === null || !old.data) return;
    await save(old.data.content, viewing);
    draft.current = null;
    setLoaded(null);
    view(null);
  }

  async function copy() {
    await navigator.clipboard.writeText(viewing === null ? (editor?.getMarkdown() ?? shownContent) : shownContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <PanelHeader
        icon={html ? <AppWindow className='size-4' /> : <FileText className='size-4' />}
        title={artifact.title}
        status={viewing === null ? statusLabel : t('canvas.viewingOld', { version: viewing })}
        onClose={onClose}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='sm' className='text-muted-foreground'>
              {`v${viewing ?? artifact.version}`}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-56'>
            <DropdownMenuLabel>{t('canvas.versions')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(viewing ?? artifact.version)}
              onValueChange={(value) => view(Number(value) === artifact.version ? null : Number(value))}
            >
              {versions.map((version) => (
                <DropdownMenuRadioItem key={version.number} value={String(version.number)}>
                  {version.restoredFrom
                    ? t('canvas.restoredByUser', { version: version.number, from: version.restoredFrom })
                    : t(version.author === 'model' ? 'canvas.byModel' : 'canvas.byUser', { version: version.number })}
                  <span className='text-muted-foreground ml-auto pl-4 text-xs'>
                    {timeFormat.format(new Date(version.createdAt))}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' aria-label={t('canvas.export')} title={t('canvas.export')}>
              <Download />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-56'>
            {html ? (
              <DropdownMenuItem onSelect={() => downloadHtml(shownContent, artifact.title)}>
                <Download />
                {t('canvas.downloadHtml')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  disabled={!editor}
                  onSelect={() => editor && void downloadWord(editor.getJSON(), artifact.title)}
                >
                  <FileText />
                  {t('canvas.downloadWord')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!editor}
                  onSelect={() => editor && printDocument(editor.getHTML(), artifact.title)}
                >
                  <Printer />
                  {t('canvas.print')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {html ? t('canvas.copyCode') : t('canvas.copyText')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PanelHeader>

      {viewing !== null && (
        <div className='bg-secondary text-secondary-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 text-sm'>
          <span className='flex-1'>{t('canvas.oldVersion', { version: viewing })}</span>
          <Button size='sm' onClick={() => void restore()} disabled={!old.data}>
            {t('canvas.restore')}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => view(null)}>
            {t('canvas.backToLatest')}
          </Button>
        </div>
      )}

      {html && (
        <div className='flex shrink-0 gap-1 border-b px-3 py-1.5'>
          {(['preview', 'code'] as const).map((tab) => (
            <Button
              key={tab}
              size='sm'
              variant={htmlTab === tab ? 'secondary' : 'ghost'}
              onClick={() => setHtmlTab(tab)}
            >
              {tab === 'preview' ? <Eye /> : <Code />}
              {t(tab === 'preview' ? 'canvas.preview' : 'canvas.code')}
            </Button>
          ))}
        </div>
      )}

      <div className={cn('min-h-0 flex-1', html && htmlTab === 'preview' ? 'flex' : 'overflow-y-auto')}>
        {html && htmlTab === 'preview' && (
          // No `allow-same-origin`: the page runs its scripts but can never reach the app or its cookies.
          <iframe
            title={artifact.title}
            srcDoc={shownContent}
            sandbox='allow-scripts allow-modals allow-forms'
            className='size-full flex-1 bg-white'
          />
        )}
        {html && htmlTab === 'code' && <pre className='p-4 font-mono text-xs whitespace-pre-wrap'>{shownContent}</pre>}
        {!html && (
          <Suspense fallback={<p className='text-muted-foreground p-6'>{t('canvas.loading')}</p>}>
            <DocumentEditor
              markdown={shownContent}
              editable={viewing === null}
              onChange={onChange}
              onReady={setEditor}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
