import { useEffect } from 'react';
import { round } from '@eats/shared';
import { useCrossed, useRemembered, useSpring } from '../lib/useSpring.ts';

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

/**
 * One macro as a wireframe column, drawn in isometric line art.
 *
 * The dashed outline is the target and the solid column is what you have
 * eaten, filled with fine contour lines rather than a flat colour so it reads
 * as drawn rather than painted. A column rather than the bar it replaced
 * because three of them side by side compare at a glance, and filling up
 * towards an outline is the question being asked: how full am I.
 *
 * Over a budget the column keeps climbing past its outline, in the warning
 * colour; protein is a floor, so it climbs in its own colour instead. Reaching
 * the protein target in front of you sends out a burst of rays and a tap of
 * haptics -- the only celebration in the app, so it means something.
 */
function IsoColumn({
  label,
  value,
  target,
  scale,
  color,
  unit = 'g',
  warnOver = true,
  selected,
  onSelect,
  memory,
}: {
  label: string;
  value: number;
  target: number | null;
  /** Names this column across visits, so it springs from where it was. */
  memory: string;
  /** What a full-height column stands for: the target, or the day's largest. */
  scale: number;
  color: string;
  unit?: string;
  warnOver?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const over = warnOver && target !== null && value > target;
  const stroke = over ? 'var(--color-danger)' : color;
  const heightOf = (v: number) =>
    scale > 0 ? Math.min(v / scale, MAX_FILL) * FULL : 0;
  const before = useRemembered(memory, value);
  const h = Math.max(0, useSpring(heightOf(value), { from: heightOf(before ?? 0) }));
  const shown = useSpring(value, { from: before ?? 0 });

  // Only a floor is worth celebrating: reaching a budget is not an achievement.
  const crossed = useCrossed(value, warnOver ? null : target, before);
  useEffect(() => {
    if (crossed > 0) navigator.vibrate?.(15);
  }, [crossed]);

  // The two faces turned towards you, as one line: left corner, front corner,
  // right corner, at height z.
  const front = (z: number) => [iso(-A, A, z), iso(A, A, z), iso(A, -A, z)];
  const top = (z: number, a = A) => [
    iso(-a, a, z),
    iso(a, a, z),
    iso(a, -a, z),
    iso(-a, -a, z),
    iso(-a, a, z),
  ];
  const uprights = (z: number) =>
    [
      [-A, A],
      [A, A],
      [A, -A],
    ].map(([x, y]) => [iso(x!, y!, 0), iso(x!, y!, z)]);

  const contours: number[] = [];
  for (let z = HATCH; z < h - 1; z += HATCH) contours.push(z);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={
        target === null
          ? `${label}: ${round(value)} ${unit}`
          : `${label}: ${round(value)} of ${round(target)} ${unit}`
      }
      className="press flex min-w-0 flex-col items-center rounded-2xl pb-1"
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full max-w-28 overflow-visible"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* The plate it stands on, lit in its colour while it is the one
            the day is being read by. */}
        <polygon
          points={pts(top(0, A + 7))}
          fill={selected ? color : 'transparent'}
          fillOpacity={0.14}
          stroke={selected ? color : 'var(--color-line)'}
          strokeOpacity={selected ? 0.7 : 1}
          strokeDasharray={selected ? undefined : '2 3'}
          className="transition-[fill,stroke] duration-300"
        />

        {target !== null && (
          // White ink, like the rest of the drawing's structure: the target
          // is part of the paper, the coloured column is what you added.
          <g
            stroke="var(--color-ink)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.4}
          >
            <polyline points={pts(top(FULL))} />
            {uprights(FULL).map((l, i) => (
              <polyline key={i} points={pts(l)} />
            ))}
          </g>
        )}

        {contours.map((z) => (
          <polyline
            key={z}
            points={pts(front(z))}
            stroke={stroke}
            strokeWidth={0.8}
            opacity={0.45}
          />
        ))}

        {h > 0.5 && (
          <g stroke={stroke} strokeWidth={1.6}>
            <polygon points={pts(top(h))} fill={stroke} fillOpacity={0.22} />
            <polyline points={pts(front(0))} />
            {uprights(h).map((l, i) => (
              <polyline key={i} points={pts(l)} />
            ))}
          </g>
        )}

        {crossed > 0 && (
          <g key={crossed} stroke={color} strokeWidth={1.5}>
            {RAYS.map((angle) => {
              const [cx, cy] = iso(0, 0, h);
              const r0 = 14;
              const r1 = 26;
              const dx = Math.cos(angle);
              const dy = Math.sin(angle) * 0.6;
              return (
                <line
                  key={angle}
                  x1={cx + dx * r0}
                  y1={cy + dy * r0}
                  x2={cx + dx * r1}
                  y2={cy + dy * r1}
                  pathLength={1}
                  className="animate-ray"
                />
              );
            })}
          </g>
        )}
      </svg>

      <span
        className={`mt-1 text-[13px] transition-colors ${selected ? 'text-ink' : 'text-muted'}`}
      >
        {label}
      </span>
      <span className="nums text-ink text-[13px]">
        {/* Whole numbers while it counts, or the tenths flicker past. */}
        {Math.abs(shown - value) < 0.05 ? round(value) : Math.round(shown)}
        {target !== null && <span className="text-faint">/{round(target)}</span>}
        <span className="text-faint text-[11px]"> {unit}</span>
      </span>
    </button>
  );
}

// Geometry for the columns, in viewBox units. A is half the footprint, FULL
// the height of a column at its target, and MAX_FILL how far past the target
// one may climb before it stops: far enough to see, not so far that one
// blowout dwarfs the other two.
const A = 15;
const FULL = 58;
const MAX_FILL = 1.3;
const HATCH = 4;
const VIEW_W = 96;
const VIEW_H = 128;
const BASE_Y = 104;
const COS30 = Math.cos(Math.PI / 6);
const RAYS = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);

/** A point on the ground plane (x, y) at height z, projected isometrically. */
function iso(x: number, y: number, z: number): [number, number] {
  return [VIEW_W / 2 + (x - y) * COS30, BASE_Y + (x + y) * 0.5 - z];
}

const pts = (points: [number, number][]) =>
  points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

const MACROS = ['proteinG', 'carbsG', 'fatG'] as const;

/**
 * Calories are the headline, so they keep a large figure and a full-width bar;
 * the macros stand underneath as three columns. Calories stay a bar because
 * they are one budget read left to right, where the macros are three things
 * compared with each other.
 *
 * The figure counts up to its new total and the bar springs to it, so logging
 * something shows you what it did rather than just the result.
 */
export function DaySummary({
  date,
  totals,
  goal,
  maintenance,
  focus,
  onFocus,
}: {
  date: string;
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
  const shownKcal = useSpring(kcal, { from: useRemembered(`${date}:kcal`, kcal) ?? 0 });
  // From the springing figure, so the bar and the number move as one; the
  // overshoot past 100% is clipped by the track and reads as a bump.
  const pct =
    target && target > 0 ? Math.max(0, Math.min(shownKcal / target, 1.04)) * 100 : 0;
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
        <p className="nums text-ink text-4xl leading-none font-medium">
          {Math.max(0, Math.round(shownKcal))}
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
            className="block h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: alarmed ? 'var(--color-danger)' : 'var(--color-mark)',
            }}
          />
        </span>
      </button>

      <div className="grid grid-cols-3 gap-2">
        {MACROS.map((key) => (
          <IsoColumn
            key={key}
            label={MACRO_META[key].label}
            value={totals[key]}
            target={goal?.[key] ?? null}
            // Without targets the columns are drawn against each other, so
            // they still say which of the three the day leaned on.
            scale={goal?.[key] ?? Math.max(...MACROS.map((k) => totals[k]), 1)}
            color={MACRO_META[key].color}
            warnOver={key !== 'proteinG'}
            selected={focus === key}
            onSelect={() => onFocus(key)}
            memory={`${date}:${key}`}
          />
        ))}
      </div>
    </div>
  );
}
