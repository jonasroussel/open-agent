import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';

export type PreviewedImage = { url: string; name: string };

/** An image at the size of the screen, over the app: closed by the cross, Escape or a tap beside it. */
export function ImagePreview({ image, onClose }: { image: PreviewedImage | null; onClose: () => void }) {
  const { t } = useTranslation();
  // The image stays while the dialog fades out: emptied at once, it vanished without its closing animation.
  const [shown, setShown] = useState(image);
  if (image && image.url !== shown?.url) setShown(image);
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        // `w-max`: centered with `left: 50%`, an `auto` width only gets the half of the screen right of the center.
        className='w-max max-w-[calc(100vw-1rem)] gap-3 p-2 sm:max-w-[calc(100vw-4rem)] sm:p-3'
      >
        {shown && (
          <>
            <img
              src={shown.url}
              alt={shown.name}
              className='max-h-[calc(100dvh-8rem)] max-w-full justify-self-center rounded-lg object-contain'
            />
            {/* On the image: its own background keeps it readable over a light picture. */}
            <DialogClose asChild>
              <Button
                variant='secondary'
                size='icon-sm'
                aria-label={t('files.closePreview')}
                className='bg-background/80 hover:bg-background absolute top-4 right-4 rounded-full shadow-sm backdrop-blur-sm sm:top-5 sm:right-5'
              >
                <X />
              </Button>
            </DialogClose>
            <div className='text-muted-foreground flex min-w-0 items-center justify-between gap-3 pr-1 pl-1 text-xs'>
              <DialogTitle className='truncate text-xs font-normal'>{shown.name}</DialogTitle>
              <a
                href={shown.url}
                download={shown.name}
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
