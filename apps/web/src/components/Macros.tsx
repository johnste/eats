import { round } from '@eats/shared';

/**
 * Calories against the day's goal. The number is the headline; the ring is
 * secondary, which is why the figure sits inside it rather than beside it.
 */
export function CalorieRing({
  kcal,
  goal,
}: {
  kcal: number;
  goal: number | null;
}) {
  const size = 132;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal && goal > 0 ? kcal / goal : 0;
  const over = ratio > 1;
  // Past the goal the ring stays full and the remainder line turns red; a ring
  // that wrapped around would read as "nearly none eaten".
  const dash = circumference * Math.min(ratio, 1);
  const remaining = goal ? Math.round(goal - kcal) : null;

  return (
    <div className="flex items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 -rotate-90"
        role="img"
        aria-label={
          goal
            ? `${Math.round(kcal)} of ${goal} calories`
            : `${Math.round(kcal)} calories, no goal set`
        }
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={over ? 'var(--color-danger)' : 'var(--color-accent)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-[stroke-dasharray] duration-500"
          />
        )}
      </svg>

      <div className="min-w-0">
        <p className="nums text-ink text-4xl leading-none font-semibold tabular-nums">
          {Math.round(kcal)}
        </p>
        <p className="text-muted mt-1 text-sm">
          {goal ? <>of {goal} kcal</> : 'kcal today'}
        </p>
        {remaining !== null && (
          <p
            className={`nums mt-2 text-[13px] font-medium ${
              remaining < 0 ? 'text-danger' : 'text-muted'
            }`}
          >
            {remaining < 0
              ? `${Math.abs(remaining)} over`
              : `${remaining} left`}
          </p>
        )}
      </div>
    </div>
  );
}

const MACROS = [
  { key: 'proteinG', label: 'Protein', color: 'var(--color-protein)' },
  { key: 'carbsG', label: 'Carbs', color: 'var(--color-carbs)' },
  { key: 'fatG', label: 'Fat', color: 'var(--color-fat)' },
] as const;

/**
 * Three bars with the value always written out. The text is not decoration:
 * the light-mode carb hue sits below 3:1 against the surface, so the label is
 * what carries the value for anyone who can't resolve the fill.
 */
export function MacroBars({
  totals,
  goal,
}: {
  totals: { proteinG: number; carbsG: number; fatG: number };
  goal: { proteinG: number; carbsG: number; fatG: number } | null;
}) {
  return (
    <ul className="space-y-3">
      {MACROS.map(({ key, label, color }) => {
        const value = totals[key];
        const target = goal?.[key] ?? null;
        const pct = target && target > 0 ? Math.min(value / target, 1) * 100 : 0;
        const over = target !== null && value > target;

        return (
          <li key={key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-muted flex items-center gap-2 text-[13px] font-medium">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ background: color }}
                />
                {label}
              </span>
              <span className="nums text-ink text-[13px]">
                {round(value)}
                {target !== null && (
                  <span className="text-faint"> / {round(target)}</span>
                )}
                <span className="text-faint"> g</span>
              </span>
            </div>
            <div className="bg-line h-1.5 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${pct}%`,
                  background: over ? 'var(--color-danger)' : color,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
