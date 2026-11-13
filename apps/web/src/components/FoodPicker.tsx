import { round, toDateKey, type FoodResponse, type Meal } from '@eats/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarcodeScanner } from './BarcodeScanner.tsx';
import { BottomBar, BottomBarSpacer } from './BottomBar.tsx';
import { Sheet } from './Sheet.tsx';
import { Button, Empty, ErrorNote, Field, Spinner } from './ui.tsx';
import { AddSplitButton } from './MealMenu.tsx';
import { WeightChips, WeightsInput } from './WeighIn.tsx';
import { api, ApiError } from '../lib/api.ts';
import {
  keys,
  useCompanions,
  useLogMutations,
  useProfile,
  useRecentFoods,
} from '../lib/queries.ts';
import { MEAL_LABELS } from '../lib/labels.ts';
import { usualFor, useWeighIn, type Slot } from '../lib/useWeighIn.ts';

/**
 * Search, scan, recents and the amount sheet -- everything needed to put a
 * food on the log. Results fill the screen and the controls sit in the fixed
 * bar under your thumb; which day and meal it all goes to is the page's to
 * show, and it passes them in.
 */
export function FoodPicker({
  date,
  meal,
  autoFocusToken,
  onDone,
}: {
  date: string;
  meal: Meal;
  /** Changing this refocuses the search field; undefined never focuses. */
  autoFocusToken?: string | number;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<FoodResponse | null>(null);
  const weighIn = useWeighIn(date);

  /** Back to search, empty, ready for the next thing on the plate. */
  const toSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  const { add, remove } = useLogMutations(date);
  /** Foods logged from this screen this visit, most recent last. */
  const [plate, setPlate] = useState<FoodResponse[]>([]);
  /** The last thing logged by weight, while it can still be undone. */
  const [last, setLast] = useState<{
    entryId: string;
    food: FoodResponse;
    slot: Slot;
  } | null>(null);

  /**
   * Picking a food. With nothing weighed this is the familiar amount sheet.
   * With a weight waiting, the weight is already known, so the food goes on
   * the log there and then and you are put straight back in an empty search
   * -- tapping a row in the list takes focus away from it, and the next food
   * is the next thing you will type.
   */
  const choose = (food: FoodResponse) => {
    const slot = weighIn.take(food);
    if (!slot) {
      setPicked(food);
      return;
    }
    toSearch();
    add.mutate(
      { foodId: food.id, grams: slot.grams, meal, loggedOn: date },
      {
        onSuccess: (entry) => {
          setLast({ entryId: entry.id, food, slot });
          setPlate((prev) => [...prev.filter((f) => f.id !== food.id), food]);
        },
        // Not logged, so the weight is still waiting for a food.
        onError: () => weighIn.putBack(slot),
      },
    );
  };

  /** Wrong food: off the log, and its weight back first in line. */
  const undo = () => {
    if (!last) return;
    remove.mutate(last.entryId);
    weighIn.putBack(last.slot);
    setPlate((prev) => prev.filter((f) => f.id !== last.food.id));
    setLast(null);
    toSearch();
  };

  // What you have eaten with what is already on the plate: butter and
  // cheese, once the bread is in.
  const plated = plate.map((f) => f.id);
  const companions = useCompanions(plated);
  const companionList = (companions.data ?? []).filter((f) => !plated.includes(f.id));
  const lastPlated = plate[plate.length - 1];

  // Runs again on every repeat tap, because the token changes each time.
  useEffect(() => {
    if (autoFocusToken === undefined) return;
    searchRef.current?.focus();
  }, [autoFocusToken]);

  // Ranked so what you eat at this meal is at the top of the list.
  const recent = useRecentFoods(meal);
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
      // Everything Open Food Facts did have is worth carrying over, including
      // what it was missing: landing on a blank form with no explanation is
      // the part that makes a dud scan feel like a dead end.
      navigate(
        `/foods/new?barcode=${res.prefill.barcode}` +
          `&name=${encodeURIComponent(res.prefill.name)}` +
          `&brand=${encodeURIComponent(res.prefill.brand ?? '')}` +
          `&missing=${encodeURIComponent(res.prefill.missing.join(','))}` +
          (res.prefill.servingG ? `&serving=${res.prefill.servingG}` : '') +
          `&meal=${meal}&date=${date}`,
      );
      return null;
    },
    onSuccess: (food) => food && choose(food),
  });

  const manual = () => navigate(`/foods/new?meal=${meal}&date=${date}`);

  const controls = (
    <div className="space-y-2">
      {last && (
        <p role="status" className="flex min-h-11 items-center gap-2 text-[13px]">
          <span className="text-accent" aria-hidden>
            ✓
          </span>
          <span className="text-muted min-w-0 flex-1 truncate">
            <span className="nums text-ink">{round(last.slot.grams)} g</span>{' '}
            <span className="text-ink">{last.food.name}</span> added to{' '}
            {MEAL_LABELS[meal].toLowerCase()}
          </span>
          <button
            type="button"
            onClick={undo}
            className="text-accent min-h-11 shrink-0 px-1 font-medium underline underline-offset-4"
          >
            Undo
          </button>
        </p>
      )}
      {weighIn.slots.length > 0 && <WeightChips weighIn={weighIn} onNext={toSearch} />}
      <div className="flex gap-2">
        <WeightsInput weighIn={weighIn} onNext={toSearch} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            weighIn.active ? `${round(weighIn.active.grams)} g of…` : 'Search…'
          }
          type="search"
          autoComplete="off"
          className="bg-raised border-line text-ink placeholder:text-faint focus:border-accent min-h-11 min-w-0 flex-1 rounded-full border px-4 focus:outline-none"
        />
        <Button
          variant="ghost"
          onClick={() => setScanning(true)}
          aria-label="Scan a barcode"
          className="grid w-11 shrink-0 place-items-center px-0!"
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
        <Button
          variant="ghost"
          onClick={manual}
          aria-label="Add a food that isn't listed"
          className="grid w-11 shrink-0 place-items-center px-0!"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
      </div>
    </div>
  );

  // Both, not just the debounced copy: when a pick clears the search, the
  // list should go back to recents at once rather than 300 ms later.
  const searching = query.trim().length >= 2 && debounced.trim().length >= 2;

  const results = searching ? (
    <SearchResults
      state={search}
      onPickLocal={choose}
      onPickOff={(barcode) => resolve.mutate(barcode)}
      onAddManually={manual}
    />
  ) : (
    <div className="space-y-5">
      {lastPlated && companionList.length > 0 && (
        <section>
          <h2 className="text-muted mb-2 truncate text-[13px] font-medium">
            Goes with {plated.length > 1 ? 'these' : lastPlated.name}
          </h2>
          <FoodList foods={companionList} onPick={choose} />
        </section>
      )}
      <section>
        <h2 className="text-muted mb-2 text-[13px] font-medium">
          Recent · {MEAL_LABELS[meal]} first
        </h2>
        {recent.isPending && <Spinner />}
        {recent.data?.length === 0 && (
          <Empty title="Nothing logged yet">
            Search, scan a barcode, or add a food yourself.
          </Empty>
        )}
        <FoodList foods={recent.data ?? []} onPick={choose} />
      </section>
    </div>
  );

  return (
    <>
      {resolve.isPending && <Spinner label="Looking it up…" />}
      {resolve.error instanceof ApiError && (
        <ErrorNote>{resolve.error.message}</ErrorNote>
      )}
      {add.error instanceof ApiError && <ErrorNote>{add.error.message}</ErrorNote>}

      {results}

      <BottomBarSpacer
        className={
          ['h-24', 'h-36', 'h-48'][(weighIn.slots.length > 0 ? 1 : 0) + (last ? 1 : 0)]
        }
      />
      <BottomBar>{controls}</BottomBar>

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
          initialMeal={meal}
          onClose={() => setPicked(null)}
          onDone={() => {
            setPicked(null);
            onDone();
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
  onAddManually,
}: {
  state: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.searchFoods>>>>;
  onPickLocal: (f: FoodResponse) => void;
  onPickOff: (barcode: string) => void;
  onAddManually: () => void;
}) {
  // Only consulted when nothing was found: a search that worked does not
  // need to explain itself.
  const profile = useProfile();

  if (state.isPending) return <Spinner />;
  if (state.isError) return <ErrorNote>Search failed. Try again.</ErrorNote>;
  const data = state.data;
  if (!data) return null;

  const nothing = data.local.length === 0 && data.off.length === 0;
  if (nothing)
    return (
      <Empty title="No matches">
        <p className="mb-3">Try a shorter search, or enter it yourself.</p>
        {profile.data && !(profile.data.useOff && profile.data.useSlv) && (
          <p className="text-faint mb-3 text-xs">
            Some food sources are switched off in Settings, so this searched
            {profile.data.useOff
              ? ' your own foods and Open Food Facts'
              : profile.data.useSlv
                ? ' your own foods and Livsmedelsverket'
                : ' only your own foods'}
            .
          </p>
        )}
        {/* Offered here as well as in the bar, because a search that found
            nothing is exactly when you want it. */}
        <Button variant="ghost" onClick={onAddManually}>
          Add a new food
        </Button>
      </Empty>
    );

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
          <ul className="space-y-1">
            {data.off.map((c) => (
              <li key={c.barcode}>
                <button
                  type="button"
                  onClick={() => onPickOff(c.barcode)}
                  className={ROW}
                >
                  <span className="min-w-0">
                    <span className="text-ink block truncate text-sm">{c.name}</span>
                    {c.brand && (
                      <span className="text-faint block truncate text-xs">
                        {c.brand}
                      </span>
                    )}
                  </span>
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

/**
 * One row of either list. The height is fixed because the second line is
 * optional -- a food with no brand would otherwise make a row shorter than
 * the one above it, and a list of mixed heights is hard to scan down.
 */
const ROW =
  'bg-raised border-line active:bg-surface flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-left';

function FoodList({
  foods,
  onPick,
}: {
  foods: FoodResponse[];
  onPick: (f: FoodResponse) => void;
}) {
  return (
    <ul className="space-y-1">
      {foods.map((f) => (
        <li key={f.id}>
          <button type="button" onClick={() => onPick(f)} className={ROW}>
            <span className="min-w-0">
              <span className="text-ink block truncate text-sm">{f.name}</span>
              {f.brand && (
                <span className="text-faint block truncate text-xs">{f.brand}</span>
              )}
            </span>
            <span className="nums shrink-0 text-right text-xs">
              {usualFor(f) !== null && (
                <span className="text-muted block">
                  ~{round(usualFor(f) as number)} g
                </span>
              )}
              <span className="text-faint block">{Math.round(f.kcal100g)} /100g</span>
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
  // A food with a portion saved is nearly always eaten by the portion -- one
  // slice, one tub, one scoop -- so offer that. 100 g is the fallback for
  // foods that have no portion worth naming.
  const [grams, setGrams] = useState(
    food.servings[0] ? String(round(food.servings[0].grams)) : '100',
  );
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
          // nudge up or down from, while typing replaces it outright.
          autoSelect
          inputMode="decimal"
          suffix="g"
          autoFocus
          invalid={grams !== '' && !valid}
        />

        {food.servings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {food.servings.map((s) => {
              const current = valid && Math.abs(value - s.grams) < 0.05;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={current}
                  onClick={() => setGrams(String(round(s.grams)))}
                  className={`active:bg-surface rounded-full border px-3 py-1.5 text-[13px] ${
                    current
                      ? 'border-accent bg-accent-soft text-accent font-medium'
                      : 'border-line text-muted'
                  }`}
                >
                  {s.label} · {round(s.grams)} g
                </button>
              );
            })}
          </div>
        )}

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

        <AddSplitButton
          meal={initialMeal}
          label={(m) => `Add to ${m}`}
          disabled={!valid}
          pending={add.isPending}
          onAdd={(to) =>
            add.mutate(
              { foodId: food.id, grams: value, meal: to, loggedOn: date },
              { onSuccess: onDone },
            )
          }
        />

        {/* Only your own foods are editable: the other sources are shared
            reference data, and this is where you notice a value is wrong. */}
        {food.source === 'custom' && (
          <button
            type="button"
            onClick={() => navigate(`/foods/${food.id}/edit?date=${date}`)}
            className="text-muted min-h-11 w-full text-center text-[13px] underline underline-offset-4"
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
