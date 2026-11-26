import { round } from '@eats/shared';
import type { WeighIn } from '../lib/useWeighIn.ts';
import { Button, EstimatedMark } from './ui.tsx';

/**
 * Where weights go in. Small enough to share a row with search: the numbers
 * it holds move out into chips as soon as each one is finished.
 */
export function WeightsInput({
  weighIn,
  onNext,
}: {
  weighIn: WeighIn;
  /** Done typing weights: go and find the foods. */
  onNext: () => void;
}) {
  return (
    <input
      value={weighIn.text}
      onChange={(e) => weighIn.setText(e.target.value)}
      onKeyDown={(e) => {
        // Enter is the separator every keypad has; Android's number pad
        // often has no space key at all.
        if (e.key === 'Enter') {
          e.preventDefault();
          // Enter after a number finishes it; Enter on an empty field
          // means that was the last one, so on to search.
          if (weighIn.text.trim() === '') onNext();
          else weighIn.commit();
        } else if (e.key === 'Backspace' && weighIn.text === '') {
          weighIn.removeLastSlot();
        }
      }}
      onBlur={() => weighIn.commit()}
      inputMode="decimal"
      enterKeyHint="next"
      autoComplete="off"
      aria-label="Weights in grams, separated by spaces"
      placeholder="45 13 12"
      className="bg-raised border-line text-ink placeholder:text-faint focus:border-accent nums min-h-11 w-24 shrink-0 rounded-full border px-3 focus:outline-none"
    />
  );
}

/**
 * The plate being put together: each weight on its own row with the food it
 * is going to be, or a gap where one is still to be picked. The active row
 * is where the next food you pick goes; tap any row to send it there
 * instead, which also swaps out a food picked by mistake.
 *
 * Nothing here is on the log yet. The button under the list adds the lot at
 * once, and only when every weight has its food.
 */
export function WeighList({
  weighIn,
  mealLabel,
  pending,
  onNext,
  onConfirm,
}: {
  weighIn: WeighIn;
  /** "breakfast", for the button. */
  mealLabel: string;
  pending: boolean;
  onNext: () => void;
  onConfirm: () => void;
}) {
  const open = weighIn.slots.filter((s) => !s.food).length;
  return (
    <div className="space-y-2">
      <ul
        aria-label="Weighed, not added yet"
        className="divide-line max-h-[35vh] divide-y overflow-y-auto"
      >
        {weighIn.slots.map((s) => {
          const active = weighIn.active?.id === s.id;
          return (
            <li
              key={s.id}
              className={`flex items-center rounded-lg ${active ? 'bg-accent-soft' : ''}`}
            >
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  weighIn.activate(s.id);
                  // Choosing where the next food goes is choosing to go and
                  // find it.
                  onNext();
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2 text-left text-sm"
              >
                <span
                  className={`nums w-14 shrink-0 text-right font-medium ${
                    active ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {round(s.grams)} g
                </span>
                {s.food ? (
                  <span className="text-ink truncate">
                    {s.food.name}
                    <EstimatedMark show={s.food.estimated} />
                  </span>
                ) : (
                  <span className={active ? 'text-accent' : 'text-faint'}>
                    {active ? 'Pick a food…' : 'No food yet'}
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Remove ${round(s.grams)} g${s.food ? ` of ${s.food.name}` : ''}`}
                onClick={() => weighIn.removeSlot(s.id)}
                className="text-muted grid size-11 shrink-0 place-items-center text-[15px] leading-none"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        className="w-full"
        disabled={!weighIn.ready || pending}
        onClick={onConfirm}
      >
        {open > 0
          ? `Pick ${open === 1 ? 'one more food' : `${open} more foods`}`
          : `Add ${weighIn.slots.length === 1 ? 'it' : `all ${weighIn.slots.length}`} to ${mealLabel}`}
      </Button>
    </div>
  );
}
