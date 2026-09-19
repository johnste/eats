import {
  addDays,
  MEALS,
  round,
  toDateKey,
  type LogEntryResponse,
  type Meal,
} from '@eats/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { Button, ErrorNote, Field } from './ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useLogMutations } from '../lib/queries.ts';

/**
 * Correct a logged entry, or put a copy of it on another day.
 *
 * Changing the date moves the entry; Duplicate leaves the original where it is
 * and logs the same food again at the chosen day and meal -- which is the
 * quicker path for something eaten on several days running.
 */
export function EntrySheet({
  entry,
  date,
  onClose,
}: {
  entry: LogEntryResponse;
  date: string;
  onClose: () => void;
}) {
  const [grams, setGrams] = useState(String(round(entry.grams)));
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [loggedOn, setLoggedOn] = useState(entry.loggedOn);
  const { update, copy, remove } = useLogMutations(date);

  // Fetched for the portion chips and a live preview; the server recomputes
  // the stored values from the food regardless.
  const food = useQuery({
    queryKey: ['food', entry.food.id],
    queryFn: () => api.food(entry.food.id),
  });

  const value = Number.parseFloat(grams.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0;
  const factor = valid ? value / 100 : 0;
  const moved = loggedOn !== entry.loggedOn;
  const busy = update.isPending || copy.isPending || remove.isPending;

  const error = [update.error, copy.error].find((e) => e instanceof ApiError);

  return (
    <Sheet title={entry.food.name} onClose={onClose}>
      <div className="space-y-4">
        <Field
          label="Amount"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          inputMode="decimal"
          suffix="g"
          invalid={grams !== '' && !valid}
        />

        {(food.data?.servings.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            {food.data?.servings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setGrams(String(s.grams))}
                className="border-line text-muted active:bg-surface rounded-full border px-3 py-1.5 text-[13px]"
              >
                {s.label} · {round(s.grams)} g
              </button>
            ))}
          </div>
        )}

        <fieldset>
          <legend className="text-muted mb-1.5 text-[13px] font-medium">Meal</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {MEALS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMeal(m)}
                aria-pressed={meal === m}
                className={`min-h-10 rounded-lg border text-xs capitalize ${
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

        <div>
          <Field
            label="Date"
            type="date"
            value={loggedOn}
            max={toDateKey()}
            onChange={(e) => setLoggedOn(e.target.value || entry.loggedOn)}
          />
          <div className="mt-2 flex gap-2">
            {[
              ['Yesterday', addDays(toDateKey(), -1)],
              ['Today', toDateKey()],
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => setLoggedOn(value as string)}
                className="border-line text-muted active:bg-surface rounded-full border px-3 py-1.5 text-[13px]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {food.data && (
          <dl className="bg-surface nums grid grid-cols-4 gap-2 rounded-xl p-3 text-center">
            {[
              ['kcal', Math.round(food.data.kcal100g * factor)],
              ['protein', round(food.data.protein100g * factor)],
              ['carbs', round(food.data.carbs100g * factor)],
              ['fat', round(food.data.fat100g * factor)],
            ].map(([label, v]) => (
              <div key={label}>
                <dt className="text-faint text-[11px]">{label}</dt>
                <dd className="text-ink text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {error instanceof ApiError && <ErrorNote>{error.message}</ErrorNote>}

        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={!valid || busy}
            onClick={() =>
              update.mutate(
                { id: entry.id, grams: value, meal, loggedOn },
                { onSuccess: onClose },
              )
            }
          >
            {update.isPending ? 'Saving…' : moved ? 'Move entry' : 'Save changes'}
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            disabled={!valid || busy}
            onClick={() =>
              copy.mutate(
                {
                  foodId: entry.food.id,
                  grams: value,
                  meal,
                  loggedOn,
                },
                { onSuccess: onClose },
              )
            }
          >
            {copy.isPending ? 'Copying…' : 'Duplicate to this day and meal'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
