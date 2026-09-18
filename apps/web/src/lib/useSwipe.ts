import { useRef, useState, type TouchEvent } from 'react';

/** Past this, releasing commits the move. Also the point the hint reaches full strength. */
const COMMIT_DISTANCE = 70;
/** Movement before we decide whether this is a horizontal swipe or a scroll. */
const AXIS_LOCK = 10;
/** How far a blocked direction is allowed to give before it stops. */
const RUBBER_BAND = 0.25;

export type SwipeDirection = 'left' | 'right' | null;

export interface SwipeState {
  /** Current horizontal displacement in px, already damped. */
  offset: number;
  /** True while a finger is down and moving horizontally. */
  dragging: boolean;
  /** Which way the finger is heading, once the axis has locked. */
  direction: SwipeDirection;
  /** 0 to 1: how close this drag is to committing. */
  progress: number;
  /** Whether releasing now would actually navigate. */
  willCommit: boolean;
}

/**
 * Horizontal swipe with live feedback.
 *
 * The axis locks after a few pixels so a vertical scroll is never hijacked --
 * the day view is a long list, and a swipe that fired on an angled flick would
 * change the date while you were reading it. A direction that cannot be
 * travelled still moves, but only slightly, so the gesture registers as
 * refused rather than ignored.
 */
export function useSwipe(handlers: {
  onLeft?: () => void;
  onRight?: () => void;
  canLeft?: boolean;
  canRight?: boolean;
}) {
  const { canLeft = true, canRight = true } = handlers;
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');
  const [state, setState] = useState<SwipeState>({
    offset: 0,
    dragging: false,
    direction: null,
    progress: 0,
    willCommit: false,
  });

  const reset = () => {
    axis.current = 'undecided';
    start.current = null;
    setState({
      offset: 0,
      dragging: false,
      direction: null,
      progress: 0,
      willCommit: false,
    });
  };

  return {
    swipe: state,
    handlers: {
      onTouchStart: (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        start.current = { x: touch.clientX, y: touch.clientY };
        axis.current = 'undecided';
      },

      onTouchMove: (e: TouchEvent) => {
        const from = start.current;
        const touch = e.touches[0];
        if (!from || !touch) return;

        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;

        if (axis.current === 'undecided') {
          if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
          axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        }
        if (axis.current !== 'horizontal') return;

        // Swiping left moves forward in time, matching the arrow on that side.
        const blocked = dx < 0 ? !canLeft : !canRight;
        const offset = blocked ? dx * RUBBER_BAND : dx;
        const progress = Math.min(Math.abs(offset) / COMMIT_DISTANCE, 1);

        setState({
          offset,
          dragging: true,
          direction: dx < 0 ? 'left' : 'right',
          progress,
          willCommit: !blocked && Math.abs(dx) >= COMMIT_DISTANCE,
        });
      },

      onTouchEnd: () => {
        const { willCommit, direction } = state;
        reset();
        if (!willCommit) return;
        if (direction === 'left') handlers.onLeft?.();
        else if (direction === 'right') handlers.onRight?.();
      },

      onTouchCancel: reset,
    },
  };
}
