import {
  fileKindOf,
  FILE_ACCEPT,
  MAX_FILES_PER_MESSAGE,
  type CommandDto,
  type FileKind,
  type LibraryFileDto,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Camera, FolderOpen, Paperclip, Square, SquareSlash, Upload, X } from 'lucide-react';
import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { commandsQuery } from '@/commands/commands-query.ts';
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
  placeholder,
}: {
  busy: boolean;
  onSend: (text: string, files: LibraryFileDto[], command: CommandDto | null) => void;
  onStop: () => void;
  placeholder: string;
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
  const field = useRef<HTMLTextAreaElement>(null);
  const commands = useQuery(commandsQuery).data ?? [];
  // The command this message runs: a badge before the text, its prompt added by the server.
  const [command, setCommand] = useState<CommandDto | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // "/cor" typed at the start, before any space: the commands it may start.
  const typedName = command ? null : (/^\/(\S*)$/.exec(text)?.[1]?.toLowerCase() ?? null);
  const matches = typedName === null ? [] : commands.filter((candidate) => candidate.name.startsWith(typedName));

  const uploading = attachments.some((attachment) => !attachment.file && !attachment.error);
  const ready = attachments.flatMap((attachment) => (attachment.file ? [attachment.file] : []));
  const room = MAX_FILES_PER_MESSAGE - attachments.length;
  const canSend = !busy && !uploading && (text.trim() !== '' || ready.length > 0 || command !== null);

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
    onSend(text.trim(), ready, command);
    for (const attachment of attachments) if (attachment.preview) URL.revokeObjectURL(attachment.preview);
    setAttachments([]);
    setNotice(null);
    setText('');
    setCommand(null);
  }

  function pick(picked: CommandDto) {
    setCommand(picked);
    // Picked from "/cor": the typed name goes; picked from a button: what was typed stays.
    if (typedName !== null) setText('');
    setHighlighted(0);
    field.current?.focus();
  }

  // "/corriger " typed in full, then a space: the command is picked as if from the list.
  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    const typed = command ? null : /^\/(\S+)\s([\s\S]*)$/.exec(value);
    const named = typed && commands.find((candidate) => candidate.name === typed[1]!.toLowerCase());
    if (named) {
      setCommand(named);
      setText(typed[2]!);
      return;
    }
    setText(value);
    setHighlighted(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setHighlighted((current) => (current + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        pick(matches[Math.min(highlighted, matches.length - 1)]!);
        return;
      }
    }
    // Backspace in an empty field takes the command back, as it would a character.
    if (event.key === 'Backspace' && command && text === '') {
      setCommand(null);
      return;
    }
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
        'bg-card focus-within:border-ring focus-within:ring-ring/20 relative rounded-2xl border p-3 shadow-xs transition-shadow focus-within:ring-3',
        dragging && 'border-ring ring-ring/20 ring-3',
      )}
    >
      {typedName !== null && commands.length > 0 && (
        <div
          role='listbox'
          aria-label={t('commands.list')}
          className='bg-popover text-popover-foreground absolute bottom-full left-0 mb-2 grid w-full max-w-md gap-0.5 rounded-xl border p-1 shadow-md'
        >
          {matches.length === 0 && <p className='text-muted-foreground px-3 py-2 text-sm'>{t('commands.noMatch')}</p>}
          {matches.map((candidate, index) => (
            <button
              key={candidate.id}
              type='button'
              role='option'
              aria-selected={index === highlighted}
              // Before the field's blur: a tap on a phone would close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(candidate)}
              className={cn(
                'grid min-w-0 rounded-lg px-3 py-2 text-left',
                index === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <span className='text-sm font-medium'>/{candidate.name}</span>
              <span className='text-muted-foreground truncate text-xs'>{candidate.prompt}</span>
            </button>
          ))}
        </div>
      )}
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
      {command && (
        <div className='mb-1 flex px-1 pt-1'>
          <span className='bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-sm font-medium'>
            /{command.name}
            <button
              type='button'
              onClick={() => setCommand(null)}
              aria-label={t('commands.remove')}
              className='hover:bg-background/40 rounded-full p-0.5'
            >
              <X className='size-3.5' />
            </button>
          </span>
        </div>
      )}
      <textarea
        ref={field}
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={1}
        autoFocus={!touchScreen}
        className='placeholder:text-muted-foreground field-sizing-content max-h-52 min-h-10 w-full resize-none bg-transparent px-1 text-base outline-none'
      />
      <div className='flex items-center gap-2'>
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
        {/* In the user's order, between the paperclip and the send button; scrolled sideways when they do not fit. */}
        <div className='flex min-w-0 flex-1 [scrollbar-width:none] gap-1.5 overflow-x-auto'>
          {commands.map((candidate) => (
            <button
              key={candidate.id}
              type='button'
              onClick={() => pick(candidate)}
              title={candidate.prompt}
              aria-label={t('commands.pick', { name: candidate.name })}
              className={cn(
                'text-muted-foreground hover:text-foreground hover:bg-muted flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                command?.id === candidate.id && 'bg-secondary text-secondary-foreground border-transparent',
              )}
            >
              <SquareSlash className='size-3.5' />
              {candidate.name}
            </button>
          ))}
        </div>
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
