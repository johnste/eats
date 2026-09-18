import { useRef, type TouchEvent } from 'react';

/** Far enough to be deliberate, and more horizontal than vertical. */
const MIN_DISTANCE = 60;
const MAX_OFF_AXIS = 0.6;

/**
 * Horizontal swipe detection for stepping between days.
 *
 * Deliberately ignores anything that looks like a vertical scroll: the day
 * view is a long scrolling list, and a swipe handler that fires on a slightly
 * angled flick would change the date while you were trying to read it.
 */
export function useSwipe(handlers: { onLeft?: () => void; onRight?: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const from = start.current;
      const touch = e.changedTouches[0];
      start.current = null;
      if (!from || !touch) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS) return;

      // Swiping left moves forward in time, matching the arrow on that side.
      if (dx < 0) handlers.onLeft?.();
      else handlers.onRight?.();
    },
  };
}
