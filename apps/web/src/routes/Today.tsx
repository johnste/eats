import { addDays, round, toDateKey, type Meal } from '@eats/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DaySummary } from '../components/Macros.tsx';
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

  // Deleting is one tap away from a list you scroll with your thumb, so the
  // first tap only arms it. Nothing is removed until the second.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Disarm on its own, so a stray tap does not leave a live delete button
  // sitting under your finger.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

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
      {/* Which day you would land on, held still while the glow does the work. */}
      {swipe.dragging && swipe.direction && swipe.progress > 0.15 && (
        <div
          aria-hidden
          className={`pointer-events-none absolute top-1 z-20 ${
            swipe.direction === 'right' ? 'left-0' : 'right-0'
          }`}
          style={{ opacity: swipe.progress }}
        >
          <span
            className={`text-[11px] font-medium ${
              swipe.willCommit ? 'text-accent' : 'text-faint'
            }`}
          >
            {humanDate(peekDate)}
          </span>
        </div>
      )}

      <div
        style={{
          transform: `translateX(${swipe.offset}px)`,
          // Spread the glow away from the edge being pulled in, and fade it up
          // with the drag. color-mix carries the strength so the hue stays a
          // single token rather than being duplicated per opacity step.
          ...(swipe.dragging && swipe.progress > 0
            ? {
                ['--swipe-glow' as string]: `${
                  swipe.direction === 'right' ? 18 : -18
                }px 0 28px -10px color-mix(in oklch, ${
                  swipe.willCommit ? 'var(--color-accent)' : 'var(--color-faint)'
                } ${Math.round(swipe.progress * 85)}%, transparent)`,
              }
            : {}),
        }}
        className={`relative z-10 ${
          swipe.dragging ? '' : 'transition-transform duration-200'
        }`}
      >
      <header className="mb-3 flex items-center justify-between">
        <StepButton label="Previous day" onClick={() => go(-1)} d="M15 18l-6-6 6-6" />
        <div className="text-center">
          <h1 className="text-ink text-[17px] leading-tight font-semibold">
            {humanDate(date)}
          </h1>
          {humanDate(date) !== date && (
            <p className="text-faint nums text-[11px]">{date}</p>
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
          <Card>
            <DaySummary totals={day.data.totals} goal={day.data.goal} />
          </Card>

          <Card className="divide-line divide-y p-0">
            {(Object.keys(MEAL_LABELS) as Meal[]).map((meal) => {
              const entries = day.data.meals[meal] ?? [];
              const kcal = Math.round(entries.reduce((a, e) => a + e.kcal, 0));

              return (
                <section key={meal} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-ink text-sm font-semibold">
                      {MEAL_LABELS[meal]}
                    </h2>
                    <div className="flex items-center gap-2">
                      {entries.length > 0 && (
                        <span className="nums text-faint text-xs">{kcal} kcal</span>
                      )}
                      <button
                        type="button"
                        aria-label={`Add to ${MEAL_LABELS[meal]}`}
                        onClick={() => navigate(`/add?meal=${meal}&date=${date}`)}
                        className="text-accent bg-accent-soft grid size-7 place-items-center rounded-full text-base leading-none"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {entries.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {entries.map((entry) => (
                        <li
                          key={entry.id}
                          className="group flex items-center justify-between gap-3 py-1"
                        >
                          <div className="min-w-0">
                            <p className="text-ink truncate text-[13px] leading-tight">
                              {entry.food.name}
                            </p>
                            <p className="text-faint nums text-[11px]">
                              {round(entry.grams)} g
                              {entry.food.brand && ` · ${entry.food.brand}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {confirming === entry.id ? (
                              <>
                                <button
                                  type="button"
                                  aria-label={`Cancel removing ${entry.food.name}`}
                                  onClick={() => setConfirming(null)}
                                  className="text-muted px-2 py-1 text-[13px]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  // autoFocus so the confirm is what a keyboard
                                  // or screen reader lands on next.
                                  autoFocus
                                  aria-label={`Confirm removing ${entry.food.name}`}
                                  onClick={() => {
                                    setConfirming(null);
                                    remove.mutate(entry.id);
                                  }}
                                  className="bg-danger text-surface rounded-full px-3 py-1 text-[13px] font-medium"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="nums text-muted text-[13px]">
                                  {Math.round(entry.kcal)}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${entry.food.name}`}
                                  onClick={() => setConfirming(entry.id)}
                                  className="text-faint active:text-danger grid size-7 place-items-center rounded-full"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="size-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    aria-hidden
                                  >
                                    <path d="M18 6L6 18M6 6l12 12" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </Card>

          {day.data.totals.kcal === 0 && !day.data.goal && (
            <Empty title="No goal set yet">
              Set one in Settings to see how the day is tracking.
            </Empty>
          )}

          <p className="text-faint pt-0.5 text-center text-[11px]">
            Swipe to change day
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
