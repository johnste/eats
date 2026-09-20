import {
  guessMeal,
  MEALS,
  round,
  toDateKey,
  type FoodResponse,
  type Meal,
} from '@eats/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BarcodeScanner } from '../components/BarcodeScanner.tsx';
import { BottomBar, BottomBarSpacer } from '../components/BottomBar.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { Button, Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys, useLogMutations, useRecentFoods } from '../lib/queries.ts';

export function Add() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('date') ?? toDateKey();
  const initialMeal = (params.get('meal') as Meal | null) ?? guessMeal();

  const searchRef = useRef<HTMLInputElement>(null);
  const focusToken = params.get('focus');
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<FoodResponse | null>(null);

  // Runs again on every repeat tap, because the token changes each time.
  useEffect(() => {
    if (!focusToken) return;
    searchRef.current?.focus();
  }, [focusToken]);

  // Ranked so what you eat at this meal is at the top of the list.
  const recent = useRecentFoods(initialMeal);
  const debounced = useDebounced(query, 300);
  const search = useQuery({
    queryKey: keys.search(debounced),
    queryFn: () => api.searchFoods(debounced),
    enabled: debounced.trim().length >= 2,
  });

  // Resolving an Open Food Facts candidate is a second request: the search
  // index has names and barcodes but no nutrition data.
  const resolve = useMutation({
    mutationFn: async (barcode: string) => {
      const res = await api.barcode(barcode);
      if (res.status === 'ok') return res.food;
      navigate(
        `/foods/new?barcode=${res.prefill.barcode}` +
          `&name=${encodeURIComponent(res.prefill.name)}` +
          `&brand=${encodeURIComponent(res.prefill.brand ?? '')}` +
          `&meal=${initialMeal}&date=${date}`,
      );
      return null;
    },
    onSuccess: (food) => food && setPicked(food),
  });

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Add food</h1>

      {resolve.isPending && <Spinner label="Looking it up…" />}
      {resolve.error instanceof ApiError && (
        <ErrorNote>{resolve.error.message}</ErrorNote>
      )}

      {debounced.trim().length >= 2 ? (
        <SearchResults
          state={search}
          onPickLocal={setPicked}
          onPickOff={(barcode) => resolve.mutate(barcode)}
        />
      ) : (
        <section>
          <h2 className="text-muted mb-2 text-[13px] font-medium">
            Recent · <span className="capitalize">{initialMeal}</span> first
          </h2>
          {recent.isPending && <Spinner />}
          {recent.data?.length === 0 && (
            <Empty title="Nothing logged yet">
              Search above, or scan a barcode to get started.
            </Empty>
          )}
          <FoodList foods={recent.data ?? []} onPick={setPicked} />
        </section>
      )}

      <button
        type="button"
        onClick={() => navigate(`/foods/new?meal=${initialMeal}&date=${date}`)}
        className="text-muted mt-6 w-full text-center text-[13px] underline underline-offset-4"
      >
        Can't find it? Add it manually
      </button>

      <BottomBarSpacer />

      <BottomBar>
        <div className="flex gap-2">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods…"
            type="search"
            autoComplete="off"
            className="bg-surface border-line text-ink placeholder:text-faint focus:border-accent min-h-11 flex-1 rounded-xl border px-3 focus:outline-none"
          />
          <Button
            variant="ghost"
            onClick={() => setScanning(true)}
            aria-label="Scan a barcode"
            className="px-3"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <path
                d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
      </BottomBar>

      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onFound={(code) => {
            setScanning(false);
            resolve.mutate(code);
          }}
        />
      )}

      {picked && (
        <QuantitySheet
          food={picked}
          date={date}
          initialMeal={initialMeal}
          onClose={() => setPicked(null)}
          onDone={() => {
            setPicked(null);
            navigate(date === toDateKey() ? '/' : `/day/${date}`);
          }}
        />
      )}
    </>
  );
}

function SearchResults({
  state,
  onPickLocal,
  onPickOff,
}: {
  state: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.searchFoods>>>>;
  onPickLocal: (f: FoodResponse) => void;
  onPickOff: (barcode: string) => void;
}) {
  if (state.isPending) return <Spinner />;
  if (state.isError) return <ErrorNote>Search failed. Try again.</ErrorNote>;
  const data = state.data;
  if (!data) return null;

  const nothing = data.local.length === 0 && data.off.length === 0;
  if (nothing)
    return <Empty title="No matches">Try a shorter search, or add it manually.</Empty>;

  return (
    <div className="space-y-5">
      {data.local.length > 0 && (
        <section>
          <h2 className="text-muted mb-2 text-[13px] font-medium">Your foods</h2>
          <FoodList foods={data.local} onPick={onPickLocal} />
        </section>
      )}
      {data.off.length > 0 && (
        <section>
          <h2 className="text-muted mb-2 text-[13px] font-medium">Open Food Facts</h2>
          <ul className="space-y-1.5">
            {data.off.map((c) => (
              <li key={c.barcode}>
                <button
                  type="button"
                  onClick={() => onPickOff(c.barcode)}
                  className="bg-raised border-line active:bg-surface w-full rounded-xl border px-3 py-2.5 text-left"
                >
                  <p className="text-ink truncate text-sm">{c.name}</p>
                  {c.brand && <p className="text-faint truncate text-xs">{c.brand}</p>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.offUnavailable && (
        <p className="text-faint text-xs">
          Open Food Facts didn't respond, so only your own foods are shown.
        </p>
      )}
    </div>
  );
}

function FoodList({
  foods,
  onPick,
}: {
  foods: FoodResponse[];
  onPick: (f: FoodResponse) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {foods.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onClick={() => onPick(f)}
            className="bg-raised border-line active:bg-surface flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left"
          >
            <span className="min-w-0">
              <span className="text-ink block truncate text-sm">{f.name}</span>
              {f.brand && (
                <span className="text-faint block truncate text-xs">{f.brand}</span>
              )}
            </span>
            <span className="nums text-faint shrink-0 text-xs">
              {Math.round(f.kcal100g)} /100g
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function QuantitySheet({
  food,
  date,
  initialMeal,
  onClose,
  onDone,
}: {
  food: FoodResponse;
  date: string;
  initialMeal: Meal;
  onClose: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [grams, setGrams] = useState('100');
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const { add } = useLogMutations(date);

  const value = Number.parseFloat(grams.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0;
  const factor = valid ? value / 100 : 0;

  return (
    <Sheet title={food.name} onClose={onClose}>
      <div className="space-y-4">
        <Field
          label="Amount"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          // Selected rather than cleared, so the number is still there to
          // nudge down from -- but typing replaces it, because 100 g is
          // almost never what you actually ate.
          autoSelect
          inputMode="decimal"
          suffix="g"
          autoFocus
          invalid={grams !== '' && !valid}
        />

        {food.servings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {food.servings.map((s) => (
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

        <div className="bg-surface space-y-2 rounded-xl p-3">
          <p className="text-muted text-center text-[11px] font-medium">
            {valid ? `In ${round(value)} g` : 'Enter an amount'}
          </p>
          <dl className="nums grid grid-cols-4 gap-2 text-center">
            {[
              ['kcal', Math.round(food.kcal100g * factor)],
              ['protein', round(food.protein100g * factor)],
              ['carbs', round(food.carbs100g * factor)],
              ['fat', round(food.fat100g * factor)],
            ].map(([label, v]) => (
              <div key={label}>
                <dt className="text-faint text-[11px]">{label}</dt>
                <dd className="text-ink text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {/* The basis for the figures above. Without it there is no way to
              tell whether 297 kcal is the food or the portion. */}
          <p className="text-faint nums border-line border-t pt-2 text-center text-[11px]">
            Per 100 g: {Math.round(food.kcal100g)} kcal · {round(food.protein100g)} g
            protein · {round(food.carbs100g)} g carbs · {round(food.fat100g)} g fat
          </p>
        </div>

        {add.error instanceof ApiError && <ErrorNote>{add.error.message}</ErrorNote>}

        <Button
          className="w-full"
          disabled={!valid || add.isPending}
          onClick={() =>
            add.mutate(
              { foodId: food.id, grams: value, meal, loggedOn: date },
              { onSuccess: onDone },
            )
          }
        >
          {add.isPending ? 'Adding…' : 'Add to log'}
        </Button>

        {/* Only your own foods are editable: the other sources are shared
            reference data, and this is where you notice a value is wrong. */}
        {food.source === 'custom' && (
          <button
            type="button"
            onClick={() => navigate(`/foods/${food.id}/edit?date=${date}`)}
            className="text-muted w-full text-center text-[13px] underline underline-offset-4"
          >
            Edit this food
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Lunch at midday, dinner in the evening -- saves a tap most of the time. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
