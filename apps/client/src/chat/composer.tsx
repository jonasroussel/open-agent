import { fileKindOf, FILE_ACCEPT, MAX_FILES_PER_MESSAGE, type FileKind, type LibraryFileDto } from '@open-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Camera, FolderOpen, Paperclip, Square, Upload } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { FileChip } from '@/files/file-chip.tsx';
import { FilePickerDialog } from '@/files/file-picker-dialog.tsx';
import { libraryFilesQuery, uploadFile } from '@/files/library.ts';
import { cn } from '@/lib/utils.ts';

/** On a touch screen, Enter adds a line, like in a text message; the button sends. */
const touchScreen = window.matchMedia('(pointer: coarse)').matches;

/** A file of the message being written: uploading, ready in the library, or refused. */
type Attachment = {
  key: string;
  name: string;
  kind: FileKind | null;
  preview: string | null;
  file: LibraryFileDto | null;
  error: string | null;
};

export function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string, files: LibraryFileDto[]) => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const deviceInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const uploading = attachments.some((attachment) => !attachment.file && !attachment.error);
  const ready = attachments.flatMap((attachment) => (attachment.file ? [attachment.file] : []));
  const room = MAX_FILES_PER_MESSAGE - attachments.length;
  const canSend = !busy && !uploading && (text.trim() !== '' || ready.length > 0);

  const update = (key: string, change: Partial<Attachment>) =>
    setAttachments((current) =>
      current.map((attachment) => (attachment.key === key ? { ...attachment, ...change } : attachment)),
    );

  function addFiles(files: File[]) {
    setNotice(files.length > room ? t('files.tooMany', { count: MAX_FILES_PER_MESSAGE }) : null);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const kind = fileKindOf(file.name, file.type);
      const attachment: Attachment = {
        key,
        name: file.name,
        kind,
        preview: kind === 'image' ? URL.createObjectURL(file) : null,
        file: null,
        error: kind ? null : t('errors.file_type_unsupported'),
      };
      setAttachments((current) => [...current, attachment]);
      if (!kind) continue;
      void uploadFile(file).then((result) => {
        if (!result.ok) return update(key, { error: t(`errors.${result.error}`) });
        update(key, { file: result.data });
        void queryClient.invalidateQueries({ queryKey: libraryFilesQuery.queryKey });
      });
    }
  }

  function addFromLibrary(files: LibraryFileDto[]) {
    const known = new Set(ready.map((file) => file.id));
    const added = files
      .filter((file) => !known.has(file.id))
      .map((file) => ({ key: file.id, name: file.name, kind: file.kind, preview: null, file, error: null }));
    setAttachments((current) => [...current, ...added]);
  }

  function remove(key: string) {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.key === key);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return current.filter((attachment) => attachment.key !== key);
    });
    setNotice(null);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend(text.trim(), ready);
    for (const attachment of attachments) if (attachment.preview) URL.revokeObjectURL(attachment.preview);
    setAttachments([]);
    setNotice(null);
    setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !touchScreen && !event.nativeEvent.isComposing) submit(event);
  }

  // A screenshot pasted with Ctrl+V becomes an attachment; pasted text stays text.
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'bg-card focus-within:border-ring focus-within:ring-ring/20 rounded-2xl border p-3 shadow-xs transition-shadow focus-within:ring-3',
        dragging && 'border-ring ring-ring/20 ring-3',
      )}
    >
      {attachments.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-2 px-1 pt-1'>
          {attachments.map((attachment) => (
            <FileChip
              key={attachment.key}
              name={attachment.name}
              kind={attachment.kind}
              url={attachment.file?.url ?? null}
              preview={attachment.preview}
              pending={!attachment.file && !attachment.error}
              error={attachment.error}
              onRemove={() => remove(attachment.key)}
            />
          ))}
        </div>
      )}
      {notice && <p className='text-muted-foreground mb-2 px-1 text-sm'>{notice}</p>}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        rows={1}
        autoFocus={!touchScreen}
        className='placeholder:text-muted-foreground field-sizing-content max-h-52 min-h-10 w-full resize-none bg-transparent px-1 text-base outline-none'
      />
      <div className='flex items-center justify-between'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='text-muted-foreground rounded-full'
              disabled={room <= 0}
              aria-label={t('files.attachMenu')}
            >
              <Paperclip />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='top' align='start' className='w-auto min-w-48'>
            <DropdownMenuItem onSelect={() => deviceInput.current?.click()}>
              <Upload />
              {t('files.fromDevice')}
            </DropdownMenuItem>
            {touchScreen && (
              <DropdownMenuItem onSelect={() => cameraInput.current?.click()}>
                <Camera />
                {t('files.takePhoto')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setPicking(true)}>
              <FolderOpen />
              {t('files.fromLibrary')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={deviceInput}
          type='file'
          multiple
          accept={FILE_ACCEPT}
          hidden
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <input
          ref={cameraInput}
          type='file'
          accept='image/*'
          capture='environment'
          hidden
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        {busy ? (
          <Button type='button' size='icon' className='rounded-full' onClick={onStop} aria-label={t('chat.stop')}>
            <Square className='size-3.5 fill-current' />
          </Button>
        ) : (
          <Button type='submit' size='icon' className='rounded-full' disabled={!canSend} aria-label={t('chat.send')}>
            <ArrowUp />
          </Button>
        )}
      </div>
      <FilePickerDialog open={picking} room={room} onClose={() => setPicking(false)} onPick={addFromLibrary} />
    </form>
  );
}
