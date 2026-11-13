import { MEALS, parseWeight, round, type Meal } from '@eats/shared';
import { useState } from 'react';
import { Button, ErrorNote } from './ui.tsx';
import { ApiError } from '../lib/api.ts';
import { useLogMutations } from '../lib/queries.ts';
import type { WeighIn } from '../lib/useWeighIn.ts';

/**
 * Where weights go in: a numeric field, and the weights still waiting for a
 * food as chips beside it. The active chip is the one the next food you pick
 * will take; tap another to send the next pick there instead.
 */
export function WeightsField({ weighIn }: { weighIn: WeighIn }) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={weighIn.text}
        onChange={(e) => weighIn.setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter is the separator every keypad has; Android's number pad
          // often has no space key at all.
          if (e.key === 'Enter') {
            e.preventDefault();
            weighIn.commit();
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
        className="bg-raised border-line text-ink placeholder:text-faint focus:border-accent nums min-h-11 w-28 shrink-0 rounded-full border px-4 focus:outline-none"
      />
      {weighIn.slots.length > 0 ? (
        <ul
          aria-label="Weights waiting for a food"
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
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
                  onClick={() => weighIn.activate(s.id)}
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
      ) : (
        <p className="text-faint min-w-0 flex-1 text-xs leading-snug">
          Weighed several things? Type each weight, then pick its food.
        </p>
      )}
    </div>
  );
}

/**
 * The weighed foods, ready to go on the log together. Each weight can still
 * be corrected, and tapping a name takes the food off and puts its weight
 * back, first in line, so the next pick replaces it.
 */
export function WeighInReview({
  weighIn,
  date,
  initialMeal,
  onAdded,
}: {
  weighIn: WeighIn;
  date: string;
  initialMeal: Meal;
  onAdded: () => void;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const { addMany } = useLogMutations(date);

  const rows = weighIn.rows.map((r) => {
    const g = parseWeight(r.grams);
    return {
      ...r,
      g,
      kcal: g === null ? null : Math.round((r.food.kcal100g * g) / 100),
    };
  });
  const valid = rows.every((r) => r.g !== null);
  const total = rows.reduce((sum, r) => sum + (r.kcal ?? 0), 0);

  return (
    <section aria-label="Ready to add" className="mb-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-muted text-[13px] font-medium">Ready to add</h2>
        <span className="nums text-ink text-[13px] font-semibold">{total} kcal</span>
      </div>

      <ul className="divide-line divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-12 items-center gap-2">
            <label className="relative shrink-0">
              <span className="sr-only">Grams of {r.food.name}</span>
              <input
                value={r.grams}
                onChange={(e) => weighIn.setRowGrams(r.id, e.target.value)}
                onFocus={(e) => e.target.select()}
                inputMode="decimal"
                aria-invalid={r.g === null || undefined}
                className={`bg-raised text-ink nums focus:border-accent min-h-11 w-[4.5rem] rounded-xl border pr-6 pl-2.5 text-right text-sm focus:outline-none ${
                  r.g === null ? 'border-danger' : 'border-line'
                }`}
              />
              <span className="text-faint pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                g
              </span>
            </label>
            <button
              type="button"
              onClick={() => weighIn.unpair(r.id)}
              aria-label={`${r.food.name}: pick a different food for this weight`}
              className="min-h-11 min-w-0 flex-1 text-left"
            >
              <span className="text-ink block truncate text-sm">{r.food.name}</span>
            </button>
            <span className="nums text-faint shrink-0 text-xs">
              {r.kcal === null ? '–' : `${r.kcal} kcal`}
            </span>
            <button
              type="button"
              onClick={() => weighIn.removeRow(r.id)}
              aria-label={`Remove ${r.food.name}`}
              className="text-faint min-h-11 min-w-9 shrink-0 text-lg leading-none"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="text-faint mt-1 text-[11px]">
        Tap a name to pick a different food.
      </p>

      <fieldset className="mt-3">
        <legend className="sr-only">Meal</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(m)}
              aria-pressed={meal === m}
              className={`min-h-11 rounded-lg border text-xs capitalize ${
                meal === m
                  ? 'border-accent bg-accent-soft text-accent font-medium'
                  : 'border-line text-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>

      {addMany.error instanceof ApiError && (
        <p className="mt-3">
          <ErrorNote>{addMany.error.message}</ErrorNote>
        </p>
      )}

      <Button
        className="mt-3 w-full"
        disabled={!valid || addMany.isPending}
        onClick={() =>
          addMany.mutate(
            {
              entries: rows.map((r) => ({
                foodId: r.food.id,
                grams: r.g as number,
                meal,
                loggedOn: date,
              })),
            },
            {
              onSuccess: () => {
                weighIn.clearRows();
                onAdded();
              },
            },
          )
        }
      >
        {addMany.isPending ? 'Adding…' : `Add ${rows.length} to ${meal}`}
      </Button>
    </section>
  );
}
