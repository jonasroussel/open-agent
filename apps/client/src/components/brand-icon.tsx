import { cn } from '@/lib/utils';

/** The app icon (the same drawing as `public/icon.svg`), inline so its tile follows the theme's primary color. */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 512 512' className={cn('shrink-0', className)} aria-hidden='true'>
      <rect width='512' height='512' rx='112' fill='var(--primary)' />
      <g stroke='var(--primary-foreground)' strokeWidth='22' strokeLinecap='round'>
        <line x1='236' y1='276' x2='140' y2='372' />
        <line x1='236' y1='276' x2='140' y2='176' />
        <line x1='236' y1='276' x2='360' y2='160' />
      </g>
      <circle cx='236' cy='276' r='52' fill='var(--primary-foreground)' />
      <circle cx='140' cy='372' r='28' fill='var(--primary)' stroke='var(--primary-foreground)' strokeWidth='20' />
      <circle cx='140' cy='176' r='28' fill='var(--primary)' stroke='var(--primary-foreground)' strokeWidth='20' />
      <circle cx='368' cy='152' r='56' fill='var(--primary)' />
      <path
        d='M368 88 Q368 152 432 152 Q368 152 368 216 Q368 152 304 152 Q368 152 368 88Z'
        fill='var(--primary-foreground)'
      />
    </svg>
  );
}
