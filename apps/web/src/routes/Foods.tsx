import type { MyFoodResponse } from '@eats/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DuplicatesCard } from '../components/DuplicatesCard.tsx';
import { Button, Empty, ErrorNote, EstimatedMark, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { keys } from '../lib/queries.ts';

type Filter = 'all' | 'estimated' | 'unused';

const FILTERS: { key: Filter; label: string; keep: (f: MyFoodResponse) => boolean }[] =
  [
    { key: 'all', label: 'All', keep: () => true },
    // The guesses are the ones worth a second look when a label turns up.
    { key: 'estimated', label: 'Estimated', keep: (f) => f.estimated },
    // Never eaten, so safe to delete if they were a mistake.
    { key: 'unused', label: 'Never logged', keep: (f) => f.entries === 0 },
  ];

/**
 * The foods you have added -- by hand, from a scanned label, or by an agent
 * logging for you -- in one place to look over, correct and tidy up.
 *
 * Only your own foods: Livsmedelsverket and Open Food Facts are shared
 * reference data, and their numbers are not yours to change.
 */
export function Foods() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const mine = useQuery({ queryKey: keys.myFoods, queryFn: api.myFoods });

  const foods = mine.data ?? [];
  const needle = query.trim().toLowerCase();
  const keep = FILTERS.find((f) => f.key === filter)!.keep;
  const shown = foods.filter(
    (f) =>
      keep(f) &&
      (needle === '' ||
        f.name.toLowerCase().includes(needle) ||
        (f.brand ?? '').toLowerCase().includes(needle)),
  );

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-ink text-lg font-semibold">Your foods</h1>
        <Button variant="ghost" onClick={() => navigate('/foods/new?from=foods')}>
          New food
        </Button>
      </div>
      <p className="text-muted mb-4 text-[13px]">
        Everything you or an agent has added. Tap one to correct it.
      </p>

      <DuplicatesCard />

      {mine.isPending && <Spinner />}
      {mine.isError && <ErrorNote>Couldn't load your foods.</ErrorNote>}

      {mine.data && foods.length === 0 && (
        <Empty title="Nothing added yet">
          Foods you add yourself, or that an agent logs for you, are listed here.
        </Empty>
      )}

      {foods.length > 0 && (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Find one of your foods…"
            autoComplete="off"
            aria-label="Find one of your foods"
            className="bg-raised border-line text-ink placeholder:text-faint focus:border-accent mb-2 min-h-11 w-full rounded-full border px-4 focus:outline-none"
          />
          <div role="group" aria-label="Show" className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const count = foods.filter(f.keep).length;
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={`min-h-11 rounded-full border px-3.5 text-[13px] ${
                    active
                      ? 'border-accent bg-accent-soft text-accent font-medium'
                      : 'border-line text-muted'
                  }`}
                >
                  {f.label} <span className="nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="text-faint py-6 text-center text-[13px]">
              None of your foods match.
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {shown.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/foods/${f.id}/edit?from=foods`)}
                    className="active:bg-surface flex min-h-12 w-full flex-col justify-center py-1.5 text-left"
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
                      <span className="text-ink truncate">
                        {f.name}
                        <EstimatedMark show={f.estimated} />
                      </span>
                      {f.brand && (
                        <span className="text-faint min-w-0 shrink-[2] truncate">
                          {f.brand}
                        </span>
                      )}
                    </span>
                    <span className="text-faint nums text-[11px]">
                      {Math.round(f.kcal100g)} kcal per 100 g ·{' '}
                      {f.entries === 0
                        ? 'never logged'
                        : `logged ${f.entries === 1 ? 'once' : `${f.entries} times`}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
