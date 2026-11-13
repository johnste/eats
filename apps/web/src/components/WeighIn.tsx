import { round } from '@eats/shared';
import type { WeighIn } from '../lib/useWeighIn.ts';

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
 * The weights still waiting for a food. The active one is where the next
 * food you pick goes; tap another to send it there instead.
 */
export function WeightChips({
  weighIn,
  onNext,
}: {
  weighIn: WeighIn;
  onNext: () => void;
}) {
  return (
    <ul
      aria-label="Weights waiting for a food"
      className="flex gap-1.5 overflow-x-auto"
    >
      {weighIn.slots.map((s) => {
        const active = weighIn.active?.id === s.id;
        return (
          <li
            key={s.id}
            className={`flex shrink-0 items-center rounded-full border ${
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-muted'
            }`}
          >
            <button
              type="button"
              aria-pressed={active}
              aria-label={`${round(s.grams)} grams${active ? ', next food goes here' : ''}`}
              onClick={() => {
                weighIn.activate(s.id);
                // Choosing where the next food goes is choosing to go and
                // find it.
                onNext();
              }}
              className="nums min-h-11 pr-1 pl-3 text-[13px] font-medium"
            >
              {round(s.grams)} g
            </button>
            <button
              type="button"
              aria-label={`Remove ${round(s.grams)} grams`}
              onClick={() => weighIn.removeSlot(s.id)}
              className="min-h-11 pr-3 pl-1 text-[15px] leading-none opacity-70"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
