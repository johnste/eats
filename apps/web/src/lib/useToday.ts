import { toDateKey } from '@eats/shared';
import { useEffect, useState } from 'react';

/**
 * Today's date, kept current.
 *
 * Read once during render it is right only until midnight. Installed on a
 * phone nothing ever closes the app -- it is resumed, not reloaded -- so a
 * screen first rendered yesterday evening still calls yesterday "Today" this
 * morning, and food added from it lands on the wrong date.
 *
 * Coming back to the app is the moment this is most likely to be wrong, so
 * that is the signal it leans on; the midnight timer only covers the app
 * being watched as the day turns, and a backgrounded timer is throttled
 * anyway.
 */
export function useToday(): string {
  const [today, setToday] = useState(toDateKey);

  useEffect(() => {
    // Returning the same string bails out of the re-render, so this is free
    // on every check that finds nothing changed.
    const check = () => setToday((prev) => (toDateKey() === prev ? prev : toDateKey()));

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    let timer: number;
    const atMidnight = () => {
      const now = new Date();
      const next = new Date(now);
      // Half a second past, so the clock has definitely rolled over.
      next.setHours(24, 0, 0, 500);
      timer = window.setTimeout(() => {
        check();
        atMidnight();
      }, next.getTime() - now.getTime());
    };
    atMidnight();

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      clearTimeout(timer);
    };
  }, []);

  return today;
}
