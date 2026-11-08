import { useSyncExternalStore } from 'react';

/** A phone: the sidebar is a drawer, the canvas covers the whole screen. Tailwind's `md` starts above it. */
export const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches);
}
