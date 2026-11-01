import type { LibraryFileDto } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';

import { FileChip } from './file-chip.tsx';
import { fileDetails } from './file-details.ts';
import { libraryFilesQuery } from './library.ts';

/** "From my files": pick files already sent once, to use them again in this message. */
export function FilePickerDialog({
  open,
  room,
  onClose,
  onPick,
}: {
  open: boolean;
  /** How many more files this message can take. */
  room: number;
  onClose: () => void;
  onPick: (files: LibraryFileDto[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const files = useQuery({ ...libraryFilesQuery, enabled: open });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const shown = (files.data ?? []).filter((file) => file.name.toLowerCase().includes(search.trim().toLowerCase()));

  function toggle(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((other) => other !== id);
      return current.length < room ? [...current, id] : current;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        onOpenAutoFocus={() => {
          setPicked([]);
          setSearch('');
        }}
        className='sm:max-w-lg'
      >
        <DialogHeader>
          <DialogTitle>{t('files.pickTitle')}</DialogTitle>
          <DialogDescription>{t('files.pickDescription', { count: room })}</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('files.search')} />
        <ul className='-mx-2 grid max-h-80 gap-1.5 overflow-y-auto'>
          {files.data?.length === 0 && (
            <li className='text-muted-foreground px-2 py-6 text-center'>{t('files.empty')}</li>
          )}
          {shown.map((file) => {
            const selected = picked.includes(file.id);
            return (
              <li key={file.id}>
                <button
                  type='button'
                  onClick={() => toggle(file.id)}
                  aria-pressed={selected}
                  className={cn(
                    'hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
                    selected && 'bg-secondary hover:bg-secondary',
                  )}
                >
                  <span className='pointer-events-none'>
                    <FileChip
                      name={file.name}
                      kind={file.kind}
                      url={file.kind === 'image' ? file.url : null}
                      iconOnly
                    />
                  </span>
                  <span className='grid min-w-0 flex-1'>
                    <span className='truncate font-medium'>{file.name}</span>
                    <span className='text-muted-foreground text-sm'>{fileDetails(file, i18n.language)}</span>
                  </span>
                  {selected && <Check className='text-primary size-5' />}
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('files.cancel')}
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onPick((files.data ?? []).filter((file) => picked.includes(file.id)));
              onClose();
            }}
          >
            {t('files.attach', { count: picked.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
