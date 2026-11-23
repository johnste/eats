import { useEffect, useRef, useState } from 'react';

const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that springs towards `target` rather than jumping to it.
 *
 * A real spring rather than a CSS transition because what moves here is not a
 * CSS property: it is a figure being counted up, or the height of a column
 * drawn in SVG, and both need the in-between values to draw.
 *
 * Starts at `from` (0 by default) so the first paint counts up too; pass the
 * target itself to have it appear in place. Underdamped on purpose -- the
 * small overshoot is the "juice" -- and settles within about half a second.
 * With reduced motion it is simply the target.
 */
export function useSpring(
  target: number,
  {
    from = 0,
    stiffness = 170,
    damping = 18,
  }: {
    from?: number;
    stiffness?: number;
    damping?: number;
  } = {},
) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : from));
  const state = useRef({ x: reducedMotion() ? target : from, v: 0 });

  useEffect(() => {
    if (reducedMotion()) {
      state.current = { x: target, v: 0 };
      setValue(target);
      return;
    }

    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      // Capped, so a frame after the tab was in the background does not fling
      // the value off by the whole time it was away.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const s = state.current;
      const accel = stiffness * (target - s.x) - damping * s.v;
      s.v += accel * dt;
      s.x += s.v * dt;

      const settled =
        Math.abs(target - s.x) < 0.01 * Math.max(1, Math.abs(target)) &&
        Math.abs(s.v) < 0.05 * Math.max(1, Math.abs(target));
      if (settled) {
        s.x = target;
        s.v = 0;
        setValue(target);
        return;
      }
      setValue(s.x);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, stiffness, damping]);

  return value;
}

const remembered = new Map<string, number>();

/**
 * What `value` was the last time anything showed it under `key`, even in a
 * component that has since unmounted.
 *
 * Logging food happens on another screen, so Today is mounted afresh with the
 * new totals already in hand. Starting its springs from what it last showed,
 * rather than from zero, is what lets you watch the food you just added land.
 * Undefined the first time a key is seen.
 */
export function useRemembered(key: string, value: number) {
  const [before] = useState(() => remembered.get(key));
  useEffect(() => {
    remembered.set(key, value);
  }, [key, value]);
  return before;
}

/**
 * Whether `value` has just passed `threshold` going up. `previous` is what it
 * was before this component mounted, if anything showed it; without one the
 * first render never counts, so opening a day you already hit your protein on
 * does not celebrate it again. Only crossing it in front of you does.
 */
export function useCrossed(value: number, threshold: number | null, previous?: number) {
  const prev = useRef<number | null>(previous ?? null);
  const [crossed, setCrossed] = useState(0);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === null || threshold === null || threshold <= 0) return;
    if (before < threshold && value >= threshold) setCrossed((n) => n + 1);
  }, [value, threshold]);
  return crossed;
}
