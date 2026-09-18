import { MEALS, round, toDateKey, type FoodResponse, type Meal } from '@eats/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Sheet } from '../components/Sheet.tsx';
import { Button, Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys, useLogMutations, useRecentFoods } from '../lib/queries.ts';
import { detectLoop, ScanError, startCamera, stopCamera } from '../lib/scanner.ts';

export function Add() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('date') ?? toDateKey();
  const initialMeal = (params.get('meal') as Meal | null) ?? guessMeal();

  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<FoodResponse | null>(null);

  const recent = useRecentFoods();
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

      <div className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search foods…"
          type="search"
          autoComplete="off"
          className="bg-raised border-line text-ink placeholder:text-faint focus:border-accent min-h-11 flex-1 rounded-xl border px-3 focus:outline-none"
        />
        <Button
          variant="ghost"
          onClick={() => setScanning(true)}
          aria-label="Scan a barcode"
          className="px-3"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8" strokeLinecap="round" />
          </svg>
        </Button>
      </div>

      {resolve.isPending && <Spinner label="Looking it up…" />}
      {resolve.error instanceof ApiError && <ErrorNote>{resolve.error.message}</ErrorNote>}

      {debounced.trim().length >= 2 ? (
        <SearchResults
          state={search}
          onPickLocal={setPicked}
          onPickOff={(barcode) => resolve.mutate(barcode)}
        />
      ) : (
        <section>
          <h2 className="text-muted mb-2 text-[13px] font-medium">Recent</h2>
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
  if (nothing) return <Empty title="No matches">Try a shorter search, or add it manually.</Empty>;

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
              {f.brand && <span className="text-faint block truncate text-xs">{f.brand}</span>}
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

        <dl className="bg-surface nums grid grid-cols-4 gap-2 rounded-xl p-3 text-center">
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
      </div>
    </Sheet>
  );
}

function BarcodeScanner({
  onClose,
  onFound,
}: {
  onClose: () => void;
  onFound: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let stopDetecting: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        stream = await startCamera(video);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        stopDetecting = detectLoop(video, onFound);
      } catch (err) {
        setError(
          err instanceof ScanError ? err.message : "The camera couldn't be started.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopDetecting?.();
      stopCamera(stream);
    };
  }, [onFound]);

  return (
    <Sheet title="Scan a barcode" onClose={onClose}>
      {error ? (
        <div className="space-y-4">
          <ErrorNote>{error}</ErrorNote>
          <p className="text-faint text-[13px]">
            You can still search by name, or add the food manually.
          </p>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full object-cover"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/70"
            />
          </div>
          <p className="text-faint text-center text-[13px]">
            Hold the barcode inside the frame.
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** Lunch at midday, dinner in the evening -- saves a tap most of the time. */
function guessMeal(): Meal {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
