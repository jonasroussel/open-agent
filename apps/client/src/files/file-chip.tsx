import type { FileKind } from '@open-agent/shared';
import { FileImage, FileText, FileType, LoaderCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils.ts';

export const KIND_ICONS = { image: FileImage, pdf: FileText, word: FileType, text: FileText } satisfies Record<
  FileKind,
  unknown
>;

/**
 * An image shows itself; other files show their kind's icon and their name, or the icon alone in lists that already
 * write the name. Both open the file in a new tab.
 */
export function FileChip({
  name,
  kind,
  url,
  preview,
  pending = false,
  error = null,
  iconOnly = false,
  onRemove,
}: {
  name: string;
  kind: FileKind | null;
  url: string | null;
  /** A local picture of an image still uploading. */
  preview?: string | null;
  pending?: boolean;
  error?: string | null;
  iconOnly?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = kind ? KIND_ICONS[kind] : FileText;
  const picture = kind === 'image' ? (url ?? preview) : null;

  let body: ReactNode;
  if (picture) {
    body = <img src={picture} alt={name} className='size-16 rounded-lg border object-cover' />;
  } else if (iconOnly) {
    body = (
      <span className='bg-card flex size-16 items-center justify-center rounded-lg border'>
        <Icon className='text-muted-foreground size-6' />
      </span>
    );
  } else {
    body = (
      <span
        className={cn(
          'bg-card flex h-16 max-w-56 items-center gap-2 rounded-lg border px-3 text-sm',
          error && 'border-destructive/50',
        )}
      >
        <Icon className='text-muted-foreground size-5 shrink-0' />
        <span className='grid min-w-0'>
          <span className='truncate font-medium'>{name}</span>
          {error && <span className='text-destructive truncate text-xs'>{error}</span>}
        </span>
      </span>
    );
  }

  return (
    <div className='relative'>
      {url ? (
        <a href={url} target='_blank' rel='noreferrer' title={name}>
          {body}
        </a>
      ) : (
        body
      )}
      {pending && (
        <span className='bg-background/60 absolute inset-0 flex items-center justify-center rounded-lg'>
          <LoaderCircle className='size-5 animate-spin' />
        </span>
      )}
      {onRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={t('files.remove', { name })}
          className='bg-foreground text-background absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full'
        >
          <X className='size-3' />
        </button>
      )}
    </div>
  );
}
