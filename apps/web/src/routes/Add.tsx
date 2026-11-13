import { guessMeal, MEALS, type Meal } from '@eats/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { FoodPicker } from '../components/FoodPicker.tsx';
import { humanDate, MEAL_LABELS } from '../lib/labels.ts';
import { useToday } from '../lib/useToday.ts';

/**
 * Adding food: the picker, under a header that says where it is going.
 *
 * Reached from the Add tab, where the meal is a guess from the time of day,
 * and from the + on a meal, which names both day and meal. Either way the
 * header stays pinned while you scroll and search, because the one thing that
 * must not be in doubt halfway through weighing a dinner is that it is going
 * to dinner, and to today.
 */
export function Add() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = useToday();
  const date = params.get('date') ?? today;
  const named = params.get('meal');
  const meal = MEALS.includes(named as Meal) ? (named as Meal) : guessMeal();
  const focusToken = params.get('focus');

  // In the URL rather than in state, so a reload or the back button keeps it.
  const setMeal = (next: Meal) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('meal', next);
        return p;
      },
      { replace: true },
    );

  const day = humanDate(date, today);

  return (
    <>
      <header
        className="bg-surface sticky z-10 -mx-4 -mt-4 mb-4 px-4 pt-4 pb-3"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <h1 className="text-ink mb-2 text-lg font-semibold">
          Add to {MEAL_LABELS[meal].toLowerCase()}
          <span
            className={`font-normal ${date === today ? 'text-muted' : 'text-accent font-semibold'}`}
          >
            {' '}
            · {day}
          </span>
        </h1>
        <div role="group" aria-label="Meal" className="grid grid-cols-4 gap-1.5">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(m)}
              aria-pressed={meal === m}
              className={`min-h-11 rounded-lg border text-xs ${
                meal === m
                  ? 'border-accent bg-accent-soft text-accent font-medium'
                  : 'border-line text-muted'
              }`}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>
      </header>

      <FoodPicker
        date={date}
        meal={meal}
        autoFocusToken={focusToken ?? undefined}
        onDone={() => navigate(date === today ? '/' : `/day/${date}`)}
      />
    </>
  );
}
