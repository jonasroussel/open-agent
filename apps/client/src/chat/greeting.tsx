import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type Period = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type Occasion = 'monday' | 'friday' | 'weekend';

/** The part of the day on the device's clock. */
export function periodOf(now: Date): Period {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/** A day worth a word of its own: Monday morning, Friday's end of the day, the weekend's daytime. */
export function occasionOf(now: Date, period: Period): Occasion | null {
  const day = now.getDay();
  if (day === 1 && period === 'morning') return 'monday';
  if (day === 5 && (period === 'afternoon' || period === 'evening')) return 'friday';
  if ((day === 0 || day === 6) && period !== 'night') return 'weekend';
  return null;
}

/**
 * The empty conversation's greeting and question, for the time of day, drawn from a few of each. Drawn once per
 * empty conversation, so it does not change while the user types.
 */
export function Greeting() {
  const { t } = useTranslation();
  const [draw] = useState(() => ({ now: new Date(), greeting: Math.random(), prompt: Math.random() }));
  const period = periodOf(draw.now);
  const occasion = occasionOf(draw.now, period);
  const greetings = [
    ...t(`home.greetings.${period}`, { returnObjects: true }),
    ...(occasion ? t(`home.occasions.${occasion}`, { returnObjects: true }) : []),
  ];
  const prompts = t(`home.prompts.${period}`, { returnObjects: true });

  return (
    <>
      <h2 className='text-2xl font-semibold tracking-tight'>
        {greetings[Math.floor(draw.greeting * greetings.length)]}
      </h2>
      <p className='text-muted-foreground text-lg'>{prompts[Math.floor(draw.prompt * prompts.length)]}</p>
    </>
  );
}
