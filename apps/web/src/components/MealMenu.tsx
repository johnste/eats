import { MEALS, type Meal } from '@eats/shared';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MEAL_LABELS } from '../lib/labels.ts';

/**
 * Meals behind a small menu rather than as a row of four buttons: the meal
 * is nearly always the one already chosen, so the other three can wait one
 * tap away instead of taking a row of the screen each time.
 */

const lower = (m: Meal) => MEAL_LABELS[m].toLowerCase();

/** Closes on a tap outside or Escape, the two ways people expect to leave. */
function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

function MenuList({
  items,
  placement,
  className = '',
}: {
  items: { key: string; label: ReactNode; onSelect: () => void }[];
  placement: 'above' | 'below';
  className?: string;
}) {
  return (
    <ul
      role="menu"
      className={`bg-raised border-line absolute z-30 min-w-44 overflow-hidden rounded-xl border py-1 shadow-lg ${
        placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-1'
      } ${className}`}
    >
      {items.map((item) => (
        <li key={item.key} role="none">
          <button
            type="button"
            role="menuitem"
            onClick={item.onSelect}
            className="text-ink active:bg-surface flex min-h-11 w-full items-center px-4 text-left text-sm"
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The meal as a word in a sentence that opens a menu of the others. */
export function MealSwitch({
  meal,
  onChange,
}: {
  meal: Meal;
  onChange: (m: Meal) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Meal: ${MEAL_LABELS[meal]}. Change`}
        onClick={() => setOpen(!open)}
        className="text-accent inline-flex min-h-11 items-center gap-0.5 underline decoration-dotted underline-offset-4"
      >
        {lower(meal)}
        <Chevron />
      </button>
      {open && (
        <MenuList
          placement="below"
          items={MEALS.filter((m) => m !== meal).map((m) => ({
            key: m,
            label: MEAL_LABELS[m],
            onSelect: () => {
              setOpen(false);
              onChange(m);
            },
          }))}
        />
      )}
    </span>
  );
}

/**
 * "Add 3 to dinner", with the other meals behind the arrow beside it -- for
 * the time the page guessed dinner and this was a snack.
 */
export function AddSplitButton({
  meal,
  label,
  onAdd,
  disabled,
  pending,
}: {
  meal: Meal;
  /** What the button says for a given meal, e.g. m => `Add 3 to ${m}`. */
  label: (meal: string) => string;
  onAdd: (meal: Meal) => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const off = disabled || pending;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        disabled={off}
        onClick={() => onAdd(meal)}
        className="bg-accent text-surface min-h-11 flex-1 rounded-l-full pr-3 pl-5 text-[15px] font-medium active:brightness-95 disabled:opacity-50"
      >
        {pending ? 'Adding…' : label(lower(meal))}
      </button>
      <button
        type="button"
        disabled={off}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to a different meal"
        onClick={() => setOpen(!open)}
        className="bg-accent text-surface border-surface/30 grid min-h-11 w-12 place-items-center rounded-r-full border-l active:brightness-95 disabled:opacity-50"
      >
        <Chevron />
      </button>
      {open && (
        <MenuList
          placement="above"
          className="right-0"
          items={MEALS.filter((m) => m !== meal).map((m) => ({
            key: m,
            label: label(lower(m)),
            onSelect: () => {
              setOpen(false);
              onAdd(m);
            },
          }))}
        />
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
