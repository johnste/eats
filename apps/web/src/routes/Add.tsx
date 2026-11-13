import { guessMeal, MEALS, type Meal } from '@eats/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { FoodPicker } from '../components/FoodPicker.tsx';
import { MealSwitch } from '../components/MealMenu.tsx';
import { humanDate } from '../lib/labels.ts';
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
        className="bg-surface sticky z-10 -mx-4 -mt-4 mb-2 px-4 pt-2"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* The heading reads as a sentence; the meal menu sits beside it
            rather than inside it, so a screen reader announces the heading
            as "Add to lunch, Today" and not as a list of every meal. */}
        <div className="text-ink flex flex-wrap items-baseline gap-x-1.5 text-lg font-semibold">
          <h1>
            Add to
            <span className="sr-only">
              {' '}
              {meal}, {day}
            </span>
          </h1>
          <MealSwitch meal={meal} onChange={setMeal} />
          <span
            aria-hidden
            className={date === today ? 'text-muted font-normal' : 'text-accent'}
          >
            · {day}
          </span>
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
