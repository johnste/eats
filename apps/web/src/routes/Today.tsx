import { addDays, round, toDateKey, type Meal } from '@eats/shared';
import { useNavigate, useParams } from 'react-router';
import { CalorieRing, MacroBars } from '../components/Macros.tsx';
import { Card, Empty, ErrorNote, Spinner } from '../components/ui.tsx';
import { useDay, useLogMutations } from '../lib/queries.ts';
import { useSwipe } from '../lib/useSwipe.ts';

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function humanDate(date: string): string {
  const today = toDateKey();
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function Today() {
  const params = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const date = params.date ?? toDateKey();
  const day = useDay(date);
  const { remove } = useLogMutations(date);

  const go = (delta: number) => {
    // Nothing to log in the future, so forward stops at today.
    if (delta > 0 && date >= toDateKey()) return;
    const next = addDays(date, delta);
    navigate(next === toDateKey() ? '/' : `/day/${next}`);
  };

  const canForward = date < toDateKey();
  const { swipe, handlers } = useSwipe({
    onLeft: () => go(1),
    onRight: () => go(-1),
    canLeft: canForward,
    canRight: true,
  });

  // Pulling from the right edge reveals the previous day, and vice versa.
  const peekDate = swipe.direction === 'right' ? addDays(date, -1) : addDays(date, 1);

  return (
    <div {...handlers} className="relative">
      {/* The day you are heading towards, revealed from the edge you are
          pulling from. Opacity tracks the drag so the gesture reads as
          continuous rather than as a threshold that silently trips. */}
      {swipe.dragging && swipe.direction && (
        <div
          aria-hidden
          className={`pointer-events-none absolute top-0 z-10 flex h-12 items-center ${
            swipe.direction === 'right' ? 'left-0' : 'right-0'
          }`}
          style={{ opacity: swipe.progress }}
        >
          <span
            className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              swipe.willCommit
                ? 'bg-accent text-surface'
                : 'bg-raised border-line text-muted border'
            }`}
          >
            {swipe.direction === 'right' ? '← ' : ''}
            {humanDate(peekDate)}
            {swipe.direction === 'left' ? ' →' : ''}
          </span>
        </div>
      )}

      <div
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={swipe.dragging ? undefined : 'transition-transform duration-200'}
      >
      <header className="mb-4 flex items-center justify-between">
        <StepButton label="Previous day" onClick={() => go(-1)} d="M15 18l-6-6 6-6" />
        <div className="text-center">
          <h1 className="text-ink text-lg font-semibold">{humanDate(date)}</h1>
          {humanDate(date) !== date && (
            <p className="text-faint nums text-xs">{date}</p>
          )}
        </div>
        <StepButton
          label="Next day"
          onClick={() => go(1)}
          d="M9 18l6-6-6-6"
          disabled={date >= toDateKey()}
        />
      </header>

      {day.isPending && <Spinner />}
      {day.isError && <ErrorNote>Couldn't load this day.</ErrorNote>}

      {day.data && (
        <div className="space-y-4">
          <Card className="space-y-5">
            <CalorieRing kcal={day.data.totals.kcal} goal={day.data.goal?.calories ?? null} />
            <MacroBars totals={day.data.totals} goal={day.data.goal} />
          </Card>

          {(Object.keys(MEAL_LABELS) as Meal[]).map((meal) => {
            const entries = day.data.meals[meal] ?? [];
            const kcal = Math.round(entries.reduce((a, e) => a + e.kcal, 0));
            return (
              <Card key={meal}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-ink text-[15px] font-semibold">
                    {MEAL_LABELS[meal]}
                  </h2>
                  <div className="flex items-center gap-3">
                    {entries.length > 0 && (
                      <span className="nums text-faint text-[13px]">{kcal} kcal</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Add to ${MEAL_LABELS[meal]}`}
                      onClick={() => navigate(`/add?meal=${meal}&date=${date}`)}
                      className="text-accent border-accent/30 grid size-8 place-items-center rounded-full border text-lg leading-none"
                    >
                      +
                    </button>
                  </div>
                </div>

                {entries.length === 0 ? (
                  <p className="text-faint text-[13px]">Nothing logged.</p>
                ) : (
                  <ul className="divide-line divide-y">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-ink truncate text-sm">{entry.food.name}</p>
                          <p className="text-faint nums text-xs">
                            {round(entry.grams)} g
                            {entry.food.brand && ` · ${entry.food.brand}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="nums text-muted text-sm">
                            {Math.round(entry.kcal)}
                            <span className="text-faint text-xs"> kcal</span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${entry.food.name}`}
                            onClick={() => remove.mutate(entry.id)}
                            className="text-faint hover:text-danger grid size-8 place-items-center rounded-full"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              aria-hidden
                            >
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}

          {day.data.totals.kcal === 0 && !day.data.goal && (
            <Empty title="No goal set yet">
              Set one in Settings to see how the day is tracking.
            </Empty>
          )}

          <p className="text-faint pt-1 text-center text-[11px]">
            Swipe left or right to change day
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

function StepButton({
  label,
  d,
  onClick,
  disabled,
}: {
  label: string;
  d: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="text-muted grid size-10 place-items-center rounded-full disabled:opacity-25"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={d} />
      </svg>
    </button>
  );
}
