import { round } from '@eats/shared';

interface Row {
  label: string;
  value: number;
  target: number | null;
  color: string;
  unit?: string;
}

/**
 * One row: label, figures, bar. Everything on a single line so four of them
 * read as a set rather than four separate widgets, and the whole summary fits
 * above the fold with room for the day's food beneath it.
 */
function BarRow({ label, value, target, color, unit = 'g' }: Row) {
  const pct = target && target > 0 ? Math.min(value / target, 1) * 100 : 0;
  const over = target !== null && value > target;

  return (
    <div className="flex items-center gap-3">
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
    </div>
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
}: {
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  goal: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
}) {
  const kcal = Math.round(totals.kcal);
  const target = goal?.calories ?? null;
  const remaining = target === null ? null : Math.round(target - kcal);
  const pct = target && target > 0 ? Math.min(kcal / target, 1) * 100 : 0;
  const over = target !== null && kcal > target;

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
          <p
            className={`nums shrink-0 text-[13px] font-medium ${
              remaining < 0 ? 'text-danger' : 'text-muted'
            }`}
          >
            {remaining < 0 ? `${Math.abs(remaining)} over` : `${remaining} left`}
          </p>
        )}
      </div>

      <div
        className="bg-line h-2 overflow-hidden rounded-full"
        role="img"
        aria-label={
          target === null
            ? `${kcal} calories, no goal set`
            : `${kcal} of ${target} calories`
        }
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: over ? 'var(--color-danger)' : 'var(--color-accent)',
          }}
        />
      </div>

      <div className="border-line space-y-2 border-t pt-3">
        <BarRow
          label="Protein"
          value={totals.proteinG}
          target={goal?.proteinG ?? null}
          color="var(--color-protein)"
        />
        <BarRow
          label="Carbs"
          value={totals.carbsG}
          target={goal?.carbsG ?? null}
          color="var(--color-carbs)"
        />
        <BarRow
          label="Fat"
          value={totals.fatG}
          target={goal?.fatG ?? null}
          color="var(--color-fat)"
        />
      </div>
    </div>
  );
}
