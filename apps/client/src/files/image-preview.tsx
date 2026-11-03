import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';

export type PreviewedImage = { url: string; name: string };

/** An image at the size of the screen, over the app: closed by the cross, Escape or a tap beside it. */
export function ImagePreview({ image, onClose }: { image: PreviewedImage | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className='w-auto max-w-[calc(100vw-2rem)] gap-3 p-3 sm:max-w-[calc(100vw-4rem)]'
      >
        {image && (
          <>
            <img
              src={image.url}
              alt={image.name}
              className='max-h-[calc(100dvh-8rem)] max-w-full justify-self-center rounded-lg object-contain'
            />
            <div className='text-muted-foreground flex min-w-0 items-center justify-between gap-3 pr-1 pl-1 text-xs'>
              <DialogTitle className='truncate text-xs font-normal'>{image.name}</DialogTitle>
              <a
                href={image.url}
                download={image.name}
                className='hover:text-foreground flex shrink-0 items-center gap-1'
              >
                <Download className='size-3.5' />
                {t('files.download')}
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
