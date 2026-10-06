import {
  addDays,
  MEALS,
  round,
  toDateKey,
  type LogEntryResponse,
  type Meal,
} from '@eats/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EntrySheet } from '../components/EntrySheet.tsx';
import { FoodPicker } from '../components/FoodPicker.tsx';
import {
  DaySummary,
  MACRO_META,
  MacroSplit,
  type MacroFocus,
} from '../components/Macros.tsx';
import { Card, Empty, ErrorNote, Spinner } from '../components/ui.tsx';
import {
  useDay,
  useLogMutations,
  useMaintenance,
  usePrefetchAdjacentDays,
} from '../lib/queries.ts';
import { useMealDrag } from '../lib/useMealDrag.ts';
import { useSwipe } from '../lib/useSwipe.ts';
import { useToday } from '../lib/useToday.ts';

const COLLAPSED_KEY = 'eats:collapsed-meals';

/**
 * Which meals are folded shut. Kept in localStorage: "I don't need to see
 * what's in breakfast" is a standing preference, not something to redo every
 * time the app opens.
 */
function loadCollapsed(): Meal[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((m): m is Meal => MEALS.includes(m as Meal))
      : [];
  } catch {
    // Unavailable or corrupt. Not worth failing a screen over.
    return [];
  }
}

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function humanDate(date: string, today: string): string {
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
  // Live, so an app resumed the next morning is not still showing yesterday.
  const today = useToday();
  const date = params.date ?? today;
  const day = useDay(date);
  const maintenance = useMaintenance();
  const { remove, update } = useLogMutations(date);

  // Dragging an entry onto another meal. The sheet behind a tap does the
  // same thing and is the accessible route; this is the shortcut.
  const drag = useMealDrag((entryId, meal) => {
    const entry = day.data
      ? Object.values(day.data.meals)
          .flat()
          .find((e) => e.id === entryId)
      : undefined;
    if (!entry) return;
    update.mutate({ id: entryId, grams: entry.grams, meal, loggedOn: date });
  });

  // Swiping should land on data that is already here, not on a spinner.
  usePrefetchAdjacentDays(date);

  // Deleting is one tap away from a list you scroll with your thumb, so the
  // first tap only arms it. Nothing is removed until the second.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<LogEntryResponse | null>(null);
  // Which meal has the add panel open, if any. One at a time: two open
  // panels would push the day off the screen and neither would be in view.
  const [adding, setAdding] = useState<Meal | null>(null);
  const [collapsed, setCollapsed] = useState<Meal[]>(loadCollapsed);

  const setFolded = (meal: Meal, folded: boolean) =>
    setCollapsed((prev) => {
      const next = folded
        ? [...new Set([...prev, meal])]
        : prev.filter((m) => m !== meal);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Preference lost on reload, which beats the screen falling over.
      }
      return next;
    });
  // Which measure the meal sections are reported in. Calories by default,
  // because that is the question most days.
  const [focus, setFocus] = useState<MacroFocus>('kcal');

  // Swiping to another day keeps this component mounted, so an open panel
  // would follow you there and add to the wrong date.
  useEffect(() => {
    setAdding(null);
  }, [date]);

  // Disarm on its own, so a stray tap does not leave a live delete button
  // sitting under your finger.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const go = (delta: number) => {
    // Nothing to log in the future, so forward stops at today.
    if (delta > 0 && date >= today) return;
    const next = addDays(date, delta);
    navigate(next === today ? '/' : `/day/${next}`);
  };

  const canForward = date < today;
  const { swipe, handlers } = useSwipe({
    onLeft: () => go(1),
    onRight: () => go(-1),
    canLeft: canForward,
    canRight: true,
    // A drag owns the gesture while it lasts, or the day would change
    // underneath the entry being moved.
    enabled: drag.state === null,
  });

  // Pulling from the right edge reveals the previous day, and vice versa.
  const peekDate = swipe.direction === 'right' ? addDays(date, -1) : addDays(date, 1);

  return (
    <div {...handlers} className="swipe-area relative">
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
            {humanDate(peekDate, today)}
          </span>
        </div>
      )}

      <div
        data-swiping={swipe.dragging || undefined}
        style={{
          // Omitted entirely when the view is at rest. A transform that is
          // always present, even as translateX(0px), keeps the whole page in
          // its own layer for the browser to maintain while you scroll.
          ...(swipe.offset !== 0 ? { transform: `translateX(${swipe.offset}px)` } : {}),
          // The glow sits on the side the incoming day comes from: pulling
          // right reveals yesterday on the left, so the left edge lights.
          // color-mix carries the strength so the hue stays a single token
          // rather than being duplicated per opacity step.
          ...(swipe.dragging && swipe.progress > 0
            ? {
                ['--swipe-glow' as string]: `${
                  swipe.direction === 'right' ? -18 : 18
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
              {humanDate(date, today)}
            </h1>
            {humanDate(date, today) !== date && (
              <p className="text-faint nums text-[11px]">{date}</p>
            )}
          </div>
          <StepButton
            label="Next day"
            onClick={() => go(1)}
            d="M9 18l6-6-6-6"
            disabled={date >= today}
          />
        </header>

        {day.isPending && <Spinner />}
        {day.isError && <ErrorNote>Couldn't load this day.</ErrorNote>}

        {day.data && (
          <div className="space-y-6">
            <Card>
              <DaySummary
                totals={day.data.totals}
                goal={day.data.goal}
                maintenance={maintenance}
                focus={focus}
                onFocus={setFocus}
              />
            </Card>

            <Card>
              {(Object.keys(MEAL_LABELS) as Meal[]).map((meal) => {
                const entries = day.data.meals[meal] ?? [];
                const meta = MACRO_META[focus];
                // Summed from the entries' own snapshots, so a meal total always
                // equals the numbers listed beneath it.
                const total = round(
                  entries.reduce((a, e) => a + e[focus], 0),
                  focus === 'kcal' ? 0 : 1,
                );
                const split = {
                  proteinG: entries.reduce((a, e) => a + e.proteinG, 0),
                  carbsG: entries.reduce((a, e) => a + e.carbsG, 0),
                  fatG: entries.reduce((a, e) => a + e.fatG, 0),
                };

                const folded = collapsed.includes(meal) && entries.length > 0;

                const targeted = drag.state !== null && drag.state.over === meal;

                return (
                  <section
                    key={meal}
                    ref={drag.register(meal)}
                    // Bleeds into the gutter so the drop highlight reads as
                    // a region rather than a stripe behind the text.
                    className={`-mx-3 rounded-2xl px-3 py-4 transition-colors ${
                      targeted && drag.state?.from !== meal ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* Heading wrapping a button is the accordion pattern:
                          the heading stays a heading for anything outlining
                          the page, and the button is what gets pressed. */}
                      <h2 className="shrink-0 text-sm font-semibold">
                        <button
                          type="button"
                          onClick={() => setFolded(meal, !folded)}
                          disabled={entries.length === 0}
                          aria-expanded={entries.length > 0 ? !folded : undefined}
                          aria-controls={`${meal}-entries`}
                          className="text-ink flex items-center gap-1 py-1"
                        >
                          {MEAL_LABELS[meal]}
                          {entries.length > 0 && (
                            <svg
                              viewBox="0 0 24 24"
                              className={`text-faint size-3 transition-transform ${
                                folded ? '' : 'rotate-180'
                              }`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          )}
                        </button>
                      </h2>
                      {entries.length > 0 && (
                        <MacroSplit {...split} className="w-14 shrink-0" />
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {entries.length > 0 && (
                          <span
                            className="nums text-xs font-medium"
                            style={{ color: meta.color }}
                          >
                            {total} {meta.unit}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={
                            adding === meal
                              ? `Close adding to ${MEAL_LABELS[meal]}`
                              : `Add to ${MEAL_LABELS[meal]}`
                          }
                          aria-expanded={adding === meal}
                          onClick={() => {
                            if (adding !== meal) setFolded(meal, false);
                            setAdding(adding === meal ? null : meal);
                          }}
                          className={`grid size-7 place-items-center rounded-full text-base leading-none transition-transform ${
                            adding === meal
                              ? 'bg-accent text-surface rotate-45'
                              : 'text-accent bg-accent-soft'
                          }`}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {entries.length > 0 && !folded && (
                      <ul id={`${meal}-entries`} className="mt-1.5 space-y-0.5">
                        {entries.map((entry) => (
                          <li
                            key={entry.id}
                            className={`group flex items-center gap-2 py-1 transition-opacity ${
                              drag.state?.entryId === entry.id ? 'opacity-40' : ''
                            }`}
                          >
                            <button
                              type="button"
                              {...drag.rowProps({
                                id: entry.id,
                                label: entry.food.name,
                                meal,
                              })}
                              onClick={() => {
                                // The press that ended a drag must not also
                                // open the sheet behind it.
                                if (drag.consumeClick()) return;
                                setEditing(entry);
                              }}
                              className="min-w-0 flex-1 touch-none text-left select-none"
                            >
                              <span className="text-ink block truncate text-[13px] leading-tight">
                                {entry.food.name}
                              </span>
                              <span className="text-faint nums block truncate text-[11px]">
                                {round(entry.grams)} g
                                {entry.food.brand && ` · ${entry.food.brand}`}
                              </span>
                            </button>
                            {/* Its own column rather than part of the name
                                block: a fixed width here is what lines the
                                strips up down the list, and the row's
                                items-center is what centres them against the
                                figure. */}
                            <MacroSplit
                              proteinG={entry.proteinG}
                              carbsG={entry.carbsG}
                              fatG={entry.fatG}
                              className="w-10 shrink-0"
                            />
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
                                  <span
                                    className="nums w-14 text-right text-[13px]"
                                    style={{
                                      color:
                                        focus === 'kcal'
                                          ? 'var(--color-muted)'
                                          : meta.color,
                                    }}
                                  >
                                    {round(entry[focus], focus === 'kcal' ? 0 : 1)}
                                    <span className="text-faint text-[11px]">
                                      {' '}
                                      {meta.unit}
                                    </span>
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

                    {adding === meal && (
                      <div className="mt-4">
                        <FoodPicker
                          date={date}
                          meal={meal}
                          variant="inline"
                          // A fresh token each time the panel opens, so the
                          // keyboard comes up on every tap of + rather than
                          // only the first.
                          autoFocusToken={`${meal}-${adding}`}
                          onDone={() => setAdding(null)}
                        />
                      </div>
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

      {drag.state && (
        <div
          aria-hidden
          className="bg-raised border-accent text-ink pointer-events-none fixed z-50 max-w-[60vw] truncate rounded-xl border-2 px-3 py-2 text-[13px] font-medium shadow-lg"
          style={{
            left: drag.state.x,
            top: drag.state.y,
            transform: 'translate(-50%, -140%)',
          }}
        >
          {drag.state.label}
        </div>
      )}

      {editing && (
        <EntrySheet entry={editing} date={date} onClose={() => setEditing(null)} />
      )}
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
