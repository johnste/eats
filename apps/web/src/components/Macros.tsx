import { round } from '@eats/shared';

/**
 * Which measure the day is currently being read in terms of. Chosen in the
 * summary and applied down the whole screen, so "where is my protein coming
 * from" is answered by the list you are already looking at.
 */
export type MacroFocus = 'kcal' | 'proteinG' | 'carbsG' | 'fatG';

export const MACRO_META: Record<
  MacroFocus,
  { label: string; color: string; unit: string }
> = {
  kcal: { label: 'Calories', color: 'var(--color-mark)', unit: 'kcal' },
  proteinG: { label: 'Protein', color: 'var(--color-protein)', unit: 'g' },
  carbsG: { label: 'Carbs', color: 'var(--color-carbs)', unit: 'g' },
  fatG: { label: 'Fat', color: 'var(--color-fat)', unit: 'g' },
};

/**
 * Where a food's energy comes from, as one small strip.
 *
 * Split by calories rather than by grams: a gram of fat carries nine and a
 * gram of carbohydrate four, so grams would draw an oat as mostly carbohydrate
 * and an olive oil as mostly nothing.
 *
 * There is no legend here because the summary at the top of the same screen
 * is one -- it names all three in these colours. The label carries the
 * numbers for anyone who cannot use the colours.
 */
export function MacroSplit({
  proteinG,
  carbsG,
  fatG,
  className = '',
}: {
  proteinG: number;
  carbsG: number;
  fatG: number;
  className?: string;
}) {
  const parts = [
    { key: 'proteinG' as const, kcal: proteinG * 4 },
    { key: 'carbsG' as const, kcal: carbsG * 4 },
    { key: 'fatG' as const, kcal: fatG * 9 },
  ];
  const total = parts.reduce((a, p) => a + p.kcal, 0);
  if (total <= 0) return null;

  const shares = parts.map((p) => ({ ...p, pct: Math.round((p.kcal / total) * 100) }));

  return (
    <span
      role="img"
      aria-label={shares
        .map((p) => `${p.pct}% ${MACRO_META[p.key].label.toLowerCase()}`)
        .join(', ')}
      // gap-0.5 is the 2px of surface between segments that keeps two
      // adjacent fills from reading as one.
      className={`flex h-1 gap-0.5 overflow-hidden ${className}`}
    >
      {shares
        .filter((p) => p.pct > 0)
        .map((p) => (
          <span
            key={p.key}
            className="block rounded-full"
            style={{ flexGrow: p.pct, background: MACRO_META[p.key].color }}
          />
        ))}
    </span>
  );
}

interface Row {
  label: string;
  value: number;
  target: number | null;
  color: string;
  unit?: string;
  /**
   * Whether passing the target is worth flagging. Calories, carbs and fat
   * are budgets; protein is a floor, and going past it is the point rather
   * than a problem, so it keeps its own colour all the way up.
   */
  warnOver?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * One row: label, figures, bar. Everything on a single line so four of them
 * read as a set rather than four separate widgets, and the whole summary fits
 * above the fold with room for the day's food beneath it.
 */
function BarRow({
  label,
  value,
  target,
  color,
  unit = 'g',
  warnOver = true,
  selected,
  onSelect,
}: Row) {
  const pct = target && target > 0 ? Math.min(value / target, 1) * 100 : 0;
  const over = warnOver && target !== null && value > target;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors ${
        selected ? 'bg-raised' : ''
      }`}
    >
      <span className="text-muted w-14 shrink-0 text-[13px]">{label}</span>

      <span className="nums text-ink w-[5.5rem] shrink-0 text-right text-[13px]">
        {round(value)}
        {target !== null && <span className="text-faint">/{round(target)}</span>}
        <span className="text-faint text-[11px]"> {unit}</span>
      </span>

      <span className="bg-line h-1.5 flex-1 overflow-hidden rounded-full">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: over ? 'var(--color-danger)' : color }}
        />
      </span>
    </button>
  );
}

/**
 * Calories are the headline, so they keep a large figure and a full-width bar;
 * the macros sit underneath as a compact set. A bar rather than a ring because
 * four measures compared against four targets read better stacked and aligned
 * than as one circle plus three unlike things.
 */
export function DaySummary({
  totals,
  goal,
  maintenance,
  focus,
  onFocus,
}: {
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  goal: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  /** What holds your weight steady; null when it cannot be worked out. */
  maintenance: number | null;
  focus: MacroFocus;
  onFocus: (focus: MacroFocus) => void;
}) {
  const kcal = Math.round(totals.kcal);
  const target = goal?.calories ?? null;
  const remaining = target === null ? null : Math.round(target - kcal);
  const pct = target && target > 0 ? Math.min(kcal / target, 1) * 100 : 0;
  const overGoal = target !== null && kcal > target;
  const overMaintenance = maintenance !== null && kcal > maintenance;

  // Passing the goal is not the failure; passing maintenance is. A day over
  // target but under maintenance still moves the weight in the right
  // direction, just more slowly, so it is reported rather than flagged.
  // Without a maintenance figure there is no second line to fall back on,
  // and over target is all that can be said.
  const alarmed = maintenance === null ? overGoal : overMaintenance;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="nums text-ink text-3xl leading-none font-semibold">
          {kcal}
          <span className="text-muted ml-1.5 text-sm font-normal">
            {target === null ? 'kcal' : `/ ${target} kcal`}
          </span>
        </p>
        {remaining !== null && (
          <div className="shrink-0 text-right">
            <p
              className={`nums text-[13px] font-medium ${
                alarmed ? 'text-danger' : 'text-muted'
              }`}
            >
              {remaining < 0 ? `${Math.abs(remaining)} over goal` : `${remaining} left`}
            </p>
            {overGoal && maintenance !== null && (
              <p
                className={`nums text-[11px] ${
                  overMaintenance ? 'text-danger' : 'text-faint'
                }`}
              >
                {overMaintenance
                  ? `${kcal - maintenance} over maintenance`
                  : `${maintenance - kcal} under maintenance`}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onFocus('kcal')}
        aria-pressed={focus === 'kcal'}
        // Padding, not a taller bar: the mark stays 8px while the thing
        // your thumb has to find is 44.
        // 18px either side of an 8px bar is exactly 44.
        className="block w-full py-[18px]"
        aria-label={
          target === null
            ? `${kcal} calories, no goal set`
            : `${kcal} of ${target} calories` +
              (overGoal && maintenance !== null
                ? overMaintenance
                  ? `, ${kcal - maintenance} over maintenance`
                  : `, still ${maintenance - kcal} under maintenance`
                : '')
        }
      >
        <span
          className={`bg-line block h-2 w-full overflow-hidden rounded-full ${
            focus === 'kcal'
              ? 'ring-accent/30 ring-1 ring-offset-4 ring-offset-surface'
              : ''
          }`}
        >
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: alarmed ? 'var(--color-danger)' : 'var(--color-mark)',
            }}
          />
        </span>
      </button>

      <div className="border-line space-y-2 border-t pt-3">
        {(['proteinG', 'carbsG', 'fatG'] as const).map((key) => (
          <BarRow
            key={key}
            label={MACRO_META[key].label}
            value={totals[key]}
            target={goal?.[key] ?? null}
            color={MACRO_META[key].color}
            warnOver={key !== 'proteinG'}
            selected={focus === key}
            onSelect={() => onFocus(key)}
          />
        ))}
      </div>
    </div>
  );
}
