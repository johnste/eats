import { useCallback, useRef, useState } from 'react';
import type { Meal } from '@eats/shared';

/** Long enough not to fire while you are starting a scroll or a day swipe. */
const LONG_PRESS_MS = 350;
/** Move further than this before the press lands and it was never a drag. */
const MOVE_TOLERANCE = 8;
/** Within this of a screen edge, the page creeps so off-screen meals are reachable. */
const EDGE = 72;
const EDGE_SPEED = 12;

export interface MealDragState {
  entryId: string;
  label: string;
  x: number;
  y: number;
  from: Meal;
  over: Meal | null;
}

/**
 * Drag an entry from one meal to another.
 *
 * Long press to pick up, rather than drag-on-touch: this list already spends
 * vertical movement on scrolling and horizontal on changing the day, so a
 * drag has to announce itself in time rather than compete with either. A
 * press that moves before it lands is a scroll and is abandoned.
 *
 * Nothing here is the only way to move an entry -- tapping one opens a sheet
 * with the meals as buttons. That is the path that works with a keyboard and
 * a screen reader; this is a shortcut over the top of it.
 */
export function useMealDrag(onDrop: (entryId: string, meal: Meal) => void) {
  const [state, setState] = useState<MealDragState | null>(null);
  // Mirrored, so pointerup can read the current drag without putting side
  // effects in a state updater -- those run twice under StrictMode, and
  // dropping an entry twice would move it and then move it again.
  const live = useRef<MealDragState | null>(null);
  const sections = useRef(new Map<Meal, HTMLElement>());
  const dragged = useRef(false);

  const apply = useCallback((next: MealDragState | null) => {
    live.current = next;
    setState(next);
  }, []);

  const register = useCallback(
    (meal: Meal) => (el: HTMLElement | null) => {
      if (el) sections.current.set(meal, el);
      else sections.current.delete(meal);
    },
    [],
  );

  /** Measured live: the page can scroll under the finger while dragging. */
  const mealAt = (y: number): Meal | null => {
    for (const [meal, el] of sections.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return meal;
    }
    return null;
  };

  const start = (
    e: React.PointerEvent,
    entry: { id: string; label: string; meal: Meal },
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let lastY = startY;
    let raf = 0;

    // Non-passive, so it can actually stop the page moving. The finger has
    // not travelled when the press lands, so the browser has not yet
    // committed the gesture to scrolling.
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const blockMenu = (ev: Event) => ev.preventDefault();

    const cleanup = () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('touchmove', blockScroll);
      document.removeEventListener('contextmenu', blockMenu);
      document.documentElement.classList.remove('dragging');
    };

    const creep = () => {
      if (!dragging) return;
      const dy =
        lastY < EDGE ? -EDGE_SPEED : lastY > window.innerHeight - EDGE ? EDGE_SPEED : 0;
      if (dy !== 0) {
        window.scrollBy(0, dy);
        if (live.current) apply({ ...live.current, over: mealAt(lastY) });
      }
      raf = requestAnimationFrame(creep);
    };

    const begin = () => {
      dragging = true;
      navigator.vibrate?.(12);
      document.addEventListener('touchmove', blockScroll, { passive: false });
      document.addEventListener('contextmenu', blockMenu);
      document.documentElement.classList.add('dragging');
      apply({
        entryId: entry.id,
        label: entry.label,
        x: startX,
        y: startY,
        from: entry.meal,
        over: entry.meal,
      });
      raf = requestAnimationFrame(creep);
    };

    const onMove = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (!dragging) {
        const moved =
          Math.abs(ev.clientX - startX) > MOVE_TOLERANCE ||
          Math.abs(ev.clientY - startY) > MOVE_TOLERANCE;
        if (moved) cleanup();
        return;
      }
      if (live.current) {
        apply({
          ...live.current,
          x: ev.clientX,
          y: ev.clientY,
          over: mealAt(ev.clientY),
        });
      }
    };

    const onUp = () => {
      const wasDragging = dragging;
      const s = live.current;
      cleanup();
      apply(null);
      if (!wasDragging) return;

      // The click that follows a press would open the entry sheet.
      dragged.current = true;
      setTimeout(() => {
        dragged.current = false;
      }, 400);

      if (s && s.over && s.over !== s.from) {
        navigator.vibrate?.(8);
        onDrop(s.entryId, s.over);
      }
    };

    const timer = window.setTimeout(begin, LONG_PRESS_MS);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  return {
    state,
    register,
    /** Spread onto the row that should be draggable. */
    rowProps: (entry: { id: string; label: string; meal: Meal }) => ({
      onPointerDown: (e: React.PointerEvent) => start(e, entry),
    }),
    /** True once per drag, so the click it ends with can be ignored. */
    consumeClick: () => {
      if (!dragged.current) return false;
      dragged.current = false;
      return true;
    },
  };
}
