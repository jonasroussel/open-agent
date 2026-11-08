import { API_ROUTES, apiPath, type ChatMessage, type ImageAspect } from '@open-agent/shared';
import { Download, ImageIcon, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KIND_ICONS } from '@/files/file-chip.tsx';
import { fileSize } from '@/files/file-details.ts';
import { ImagePreview } from '@/files/image-preview.tsx';
import { cn } from '@/lib/utils.ts';

type Part = ChatMessage['parts'][number];

const MAKING_TOOLS = {
  'tool-generate_image': true,
  'tool-create_spreadsheet': true,
  'tool-create_pdf': true,
  'tool-create_chart': true,
  'tool-create_qr_code': true,
} as const;

export type MadeFilePart = Extract<Part, { type: keyof typeof MAKING_TOOLS }>;
type MakingTool = MadeFilePart['type'] extends `tool-${infer Name}` ? Name : never;

export function isMadeFilePart(part: Part): part is MadeFilePart {
  return part.type in MAKING_TOOLS;
}

/**
 * Drawn images have the shape the model asked for, known before they arrive. The bubble takes the width of what it
 * holds: a landscape one needs its own width, a percentage of an empty bubble is nothing.
 */
const DRAWN_SHAPES: Record<ImageAspect, string> = {
  '16:9': 'aspect-video w-[36rem] max-w-full',
  '9:16': 'aspect-[9/16] h-[28rem] max-h-[70vh]',
};

/**
 * A file the answer made, kept in "My files": an image shows itself, another file is a card that downloads it. A
 * drawing in progress holds the place of the image to come, so the answer does not jump when it arrives.
 */
export function MadeFile({ part }: { part: MadeFilePart }) {
  const { t, i18n } = useTranslation();
  const tool = part.type.slice(5) as MakingTool;
  const drawnShape = part.type === 'tool-generate_image' ? DRAWN_SHAPES[part.input?.aspect ?? '16:9'] : null;

  if (part.state === 'output-error') {
    return (
      <p className='text-muted-foreground flex items-start gap-1.5 text-sm'>
        <TriangleAlert className='mt-0.5 size-4 shrink-0' />
        {t(`made.failed.${tool}`)}
      </p>
    );
  }

  if (part.state !== 'output-available') {
    if (drawnShape) {
      return (
        <div
          className={cn(
            'bg-background text-muted-foreground mx-auto flex animate-pulse items-center justify-center gap-2 rounded-xl border text-sm',
            drawnShape,
          )}
        >
          <ImageIcon className='size-4' />
          {t(`made.making.${tool}`)}
        </div>
      );
    }
    return (
      <p className='text-muted-foreground flex animate-pulse items-center gap-1.5 text-sm'>
        <LoaderCircle className='size-4 shrink-0 animate-spin' />
        {t(`made.making.${tool}`)}
      </p>
    );
  }

  const file = part.output;
  const url = apiPath(API_ROUTES.file, { fileId: file.id });

  if (file.kind === 'image') {
    return <MadeImage url={url} name={file.name} shape={drawnShape ?? 'max-h-[28rem] max-w-full'} />;
  }

  const Icon = KIND_ICONS[file.kind];
  // A PDF opens in the browser's viewer, which can save or share it; other files download.
  const opens = file.kind === 'pdf';
  return (
    <a
      href={url}
      {...(opens ? { target: '_blank', rel: 'noreferrer' } : { download: file.name })}
      className='bg-background hover:border-ring/50 flex w-fit max-w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors'
    >
      <span className='bg-secondary text-secondary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' />
      </span>
      <span className='grid min-w-0'>
        <span className='truncate text-sm font-medium'>{file.name}</span>
        <span className='text-muted-foreground text-xs'>
          {fileSize(file.size, i18n.language)} · {t('made.inLibrary')}
        </span>
      </span>
      <Download className='text-muted-foreground ml-2 size-4 shrink-0' />
    </a>
  );
}

/** Centered in the answer; a tap shows it over the app, at the size of the screen. */
function MadeImage({ url, name, shape }: { url: string; name: string; shape: string }) {
  const { t } = useTranslation();
  const [previewing, setPreviewing] = useState(false);
  return (
    <figure className='mx-auto grid w-fit max-w-full justify-items-center gap-1.5'>
      <button
        type='button'
        onClick={() => setPreviewing(true)}
        aria-label={t('files.open', { name })}
        className='max-w-full cursor-zoom-in'
      >
        <img src={url} alt={name} className={cn('bg-background rounded-xl border object-contain', shape)} />
      </button>
      <figcaption className='text-muted-foreground flex max-w-full min-w-0 items-center gap-3 text-xs'>
        <span className='truncate'>{name}</span>
        <a href={url} download={name} className='hover:text-foreground flex shrink-0 items-center gap-1'>
          <Download className='size-3.5' />
          {t('files.download')}
        </a>
      </figcaption>
      <ImagePreview image={previewing ? { url, name } : null} onClose={() => setPreviewing(false)} />
    </figure>
  );
}
