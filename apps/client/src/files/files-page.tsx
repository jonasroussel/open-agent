import { FILE_ACCEPT, apiPath, API_ROUTES, type LibraryFileDto } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

import { KIND_ICONS } from './file-chip.tsx';
import { fileDetails } from './file-details.ts';
import { libraryFilesQuery, uploadFile } from './library.ts';

/** "My files": everything the user sent, as tiles to open again, add (button or drop), or delete. */
export function FilesPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('files.title'));
  const queryClient = useQueryClient();
  const files = useQuery(libraryFilesQuery);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LibraryFileDto | null>(null);
  const [dragging, setDragging] = useState(false);

  async function add(list: File[]) {
    setUploading(true);
    setError(null);
    for (const file of list) {
      const result = await uploadFile(file);
      if (!result.ok) setError(`${file.name} : ${t(`errors.${result.error}`)}`);
    }
    setUploading(false);
    await queryClient.invalidateQueries({ queryKey: libraryFilesQuery.queryKey });
  }

  async function remove(file: LibraryFileDto) {
    const result = await api(apiPath(API_ROUTES.file, { fileId: file.id }), { method: 'DELETE' });
    setError(result.ok ? null : t(`errors.${result.error}`));
    await queryClient.invalidateQueries({ queryKey: libraryFilesQuery.queryKey });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void add([...event.dataTransfer.files]);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'mx-auto grid w-full max-w-5xl content-start gap-6 rounded-2xl px-4 pt-6 pb-12 md:px-8',
        dragging && 'ring-ring/30 bg-secondary/40 ring-3',
      )}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground max-w-xl'>{t('files.description')}</p>
        <Button size='lg' disabled={uploading} onClick={() => input.current?.click()}>
          <Upload />
          {uploading ? t('files.adding') : t('files.add')}
        </Button>
        <input
          ref={input}
          type='file'
          multiple
          accept={FILE_ACCEPT}
          hidden
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      {error && <AlertMessage text={error} />}
      {files.isError && <AlertMessage text={t('errors.network')} />}

      {files.data?.length === 0 && (
        <div className='text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center'>
          <FolderOpen className='size-6' />
          <p>{t('files.empty')}</p>
        </div>
      )}
      {files.data && files.data.length > 0 && (
        <ul className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'>
          {files.data.map((file) => (
            <li key={file.id} className='group relative'>
              <FileTile file={file} details={fileDetails(file, i18n.language)} />
              <Button
                variant='secondary'
                size='icon'
                aria-label={t('files.deleteNamed', { name: file.name })}
                title={t('files.delete')}
                onClick={() => setToDelete(file)}
                className='bg-background/90 hover:bg-background absolute top-2 right-2 rounded-full opacity-100 shadow-xs transition-opacity group-hover:opacity-100 pointer-fine:opacity-0'
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('files.deleteTitle', { name: toDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('files.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('files.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => toDelete && void remove(toDelete)}>
              {t('files.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** An image fills its tile, a PDF shows its first page; Word and text files show their icon and their type. */
function FileTile({ file, details }: { file: LibraryFileDto; details: string }) {
  const Icon = KIND_ICONS[file.kind];
  const extension = file.name.includes('.') ? file.name.split('.').pop()! : file.kind;

  return (
    <a
      href={file.url}
      target='_blank'
      rel='noreferrer'
      className='bg-card hover:border-ring/50 block overflow-hidden rounded-xl border transition-shadow hover:shadow-md'
    >
      <div className='bg-muted relative aspect-[4/3] overflow-hidden border-b'>
        {file.previewUrl ? (
          <img
            src={file.previewUrl}
            alt=''
            loading='lazy'
            className={cn('size-full object-cover', file.kind === 'pdf' && 'bg-white object-top')}
          />
        ) : (
          <div className='text-muted-foreground flex size-full flex-col items-center justify-center gap-2'>
            <Icon className='size-10 stroke-[1.5]' />
            <span className='text-xs font-semibold tracking-wide uppercase'>{extension}</span>
          </div>
        )}
        {file.kind === 'pdf' && (
          <span className='bg-foreground/80 text-background absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold'>
            PDF
          </span>
        )}
      </div>
      <div className='grid gap-0.5 px-3 py-2.5'>
        <span className='truncate text-sm font-medium' title={file.name}>
          {file.name}
        </span>
        <span className='text-muted-foreground text-xs'>{details}</span>
      </div>
    </a>
  );
}
