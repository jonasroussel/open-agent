import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * The app's icon, a lighthouse on sand. Inline and flat for small sizes (the sidebar, the answers), where the
 * detailed drawing of `public/icon.svg` would blur; `detailed` shows that one, for large places (64 px and up).
 */
export function BrandIcon({ className, detailed = false }: { className?: string; detailed?: boolean }) {
  // Several icons on one page: each needs its own clip.
  const clip = useId();
  if (detailed) return <img src='/icon.svg' alt='' className={cn('shrink-0', className)} />;
  return (
    <svg viewBox='0 0 512 512' className={cn('shrink-0', className)} aria-hidden='true'>
      <clipPath id={clip}>
        <rect width='512' height='512' rx='112' />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width='512' height='512' fill='#f2e3c6' />
        <path d='M262 122 L560 -10 L560 300 L262 186 Z' fill='#f08a24' opacity='0.9' />
        <circle cx='242' cy='62' r='15' fill='#2a2c6e' />
        <path d='M172 126 L242 66 L312 126 Z' fill='#2a2c6e' />
        <rect x='192' y='122' width='100' height='66' rx='12' fill='#f08a24' />
        <rect x='164' y='186' width='156' height='32' rx='12' fill='#2a2c6e' />
        <path d='M184.3 216 L299.7 216 L311.8 306 L172.2 306 Z' fill='#2a2c6e' />
        <path d='M164.1 366 L319.9 366 L346 560 L138 560 Z' fill='#2a2c6e' />
      </g>
      <rect x='6' y='6' width='500' height='500' rx='106' fill='none' stroke='#dcc79f' strokeWidth='12' />
    </svg>
  );
}
