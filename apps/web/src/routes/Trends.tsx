import { addDays, daysBetween, round, type DaySummaryResponse } from '@eats/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MACRO_META } from '../components/Macros.tsx';
import { Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { WeightCard } from '../components/WeightCard.tsx';
import { api } from '../lib/api.ts';
import { keys, useMaintenance } from '../lib/queries.ts';
import { useToday } from '../lib/useToday.ts';

/** Past this many days, one bar per day is thinner than the gap between them. */
const BARS_UPTO = 45;

/**
 * The macro chart runs out of room three times sooner, because it draws three
 * bars per day rather than one.
 *
 * On a phone the plot is about 270px. Allowing for the gap between days that
 * leaves roughly 215px of bar: at twelve days that is 6px each, and at thirty
 * it is under 3px -- narrower than the gaps around it, which reads as noise
 * rather than as three series. Beyond this it becomes lines.
 */
const MACRO_BARS_UPTO = 12;

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

export function Trends() {
  const today = useToday();
  const [days, setDays] = useState<number | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(addDays(today, -30));
  const [customTo, setCustomTo] = useState(today);

  const from = days === 'custom' ? customFrom : addDays(today, -(days - 1));
  const to = days === 'custom' ? customTo : today;
  const valid = from <= to;

  const summary = useQuery({
    queryKey: keys.summary(from, to),
    queryFn: () => api.summary(from, to),
    enabled: valid,
  });

  const maintenance = useMaintenance();
  const rows = summary.data ?? [];
  const stats = useMemo(() => summarise(rows), [rows]);
  const span = daysBetween(from, to);
  const asBars = span <= BARS_UPTO;
  const macrosAsBars = span <= MACRO_BARS_UPTO;

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-medium">Trends</h1>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <RangeButton
            key={p.days}
            active={days === p.days}
            onClick={() => setDays(p.days)}
          >
            {p.label}
          </RangeButton>
        ))}
        <RangeButton active={days === 'custom'} onClick={() => setDays('custom')}>
          Custom
        </RangeButton>
      </div>

      {days === 'custom' && (
        <Card className="mb-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field
                label="From"
                type="date"
                max={today}
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Field
                label="To"
                type="date"
                max={today}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                invalid={!valid}
              />
            </div>
          </div>
          {!valid && (
            <p className="mt-2">
              <ErrorNote>The first date has to come first.</ErrorNote>
            </p>
          )}
        </Card>
      )}

      {/* First, because it is the one with something to type: today's
          weight is a daily habit, the charts below are for looking back. */}
      {valid && (
        <div className="mb-6">
          <WeightCard from={from} to={to} today={today} />
        </div>
      )}

      {summary.isPending && valid && <Spinner />}
      {summary.isError && <ErrorNote>Couldn't load that range.</ErrorNote>}

      {summary.data && stats.logged === 0 && (
        <Empty title="Nothing logged in this range">
          Pick a longer range, or log a few days.
        </Empty>
      )}

      {summary.data && stats.logged > 0 && (
        <div className="space-y-6">
          <Card>
            {/* Averaged over days that were actually logged. Counting a blank
                day as zero would quietly drag every number down. */}
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <p className="figure text-ink text-2xl font-medium">
                  {stats.avgKcal}
                  <span className="text-muted ml-1 text-sm font-normal">kcal/day</span>
                </p>
                <p className="text-faint text-xs">
                  average over {stats.logged} logged{' '}
                  {stats.logged === 1 ? 'day' : 'days'}
                  {stats.missing > 0 && ` · ${stats.missing} not logged`}
                </p>
              </div>
            </div>

            <div className="-ml-2 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <IntakeChart rows={rows} asBars={asBars} />
              </ResponsiveContainer>
            </div>

            <Legend
              items={[
                ...(stats.goalKcal
                  ? [{ label: 'Goal', color: 'var(--color-accent)', dashed: true }]
                  : []),
                ...(maintenance
                  ? [
                      {
                        label: 'Maintenance',
                        color: 'var(--color-faint)',
                        dashed: true,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card>
            <h2 className="text-ink mb-1 text-[15px]">Macros</h2>
            <p className="text-muted mb-3 text-[13px]">
              Grams a day. Averages: {stats.avgProtein} protein, {stats.avgCarbs} carbs,{' '}
              {stats.avgFat} fat
              {stats.goal &&
                ` — targets ${round(stats.goal.proteinG)}, ${round(stats.goal.carbsG)} and ${round(stats.goal.fatG)}`}
              .
            </p>
            <div className="-ml-2 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <MacroChart rows={rows} asBars={macrosAsBars} />
              </ResponsiveContainer>
            </div>
            <Legend
              items={[
                ...MACRO_KEYS.map((k) => ({
                  label: MACRO_META[k].label,
                  color: MACRO_META[k].color,
                })),
                ...(stats.goal
                  ? [{ label: 'Target', color: 'var(--color-faint)', dashed: true }]
                  : []),
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- charts --- */

/**
 * The charts are drawn in the same line art as the columns on Today: marks
 * are an outline filled with fine horizontal rules rather than a flat block,
 * and the grid is dashed like a drafting grid. Hatching rather than a fill
 * also keeps a run of thirty bars from turning into one solid wall of colour.
 */
function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="4" height="3" patternUnits="userSpaceOnUse">
      <line
        x1="0"
        y1="0.5"
        x2="4"
        y2="0.5"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />
    </pattern>
  );
}

const grid = (
  <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
);

/** Each series draws itself in once, when the range first loads. */
const drawIn = {
  isAnimationActive: true,
  animationDuration: 700,
  animationEasing: 'ease-out',
} as const;

const axis = {
  tick: { fill: 'var(--color-faint)', fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

const tooltip = {
  contentStyle: {
    background: 'var(--color-raised)',
    border: '1px solid var(--color-line)',
    borderRadius: 12,
    fontSize: 13,
    color: 'var(--color-ink)',
  },
} as const;

function IntakeChart({
  rows,
  asBars,
}: {
  rows: DaySummaryResponse[];
  asBars: boolean;
}) {
  const goal = rows.find((r) => r.goal)?.goal?.calories ?? null;
  const maintenance = useMaintenance();
  // Pattern ids are document-wide, so each chart names its own.
  const hatch = `hatch-kcal-${useId()}`;

  const marks = (
    <>
      <defs>
        <Hatch id={hatch} color="var(--color-mark)" />
      </defs>
      {grid}
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
      {/* The scale has to reach the lines drawn on it, or a maintenance line
          above every bar is simply clipped away and never seen. */}
      <YAxis
        width={40}
        domain={[
          0,
          (max: number) => Math.ceil(Math.max(max, goal ?? 0, maintenance ?? 0) * 1.05),
        ]}
        {...axis}
      />
      <Tooltip
        {...tooltip}
        labelFormatter={(d) => longDate(String(d))}
        formatter={(v) => [`${Math.round(Number(v))} kcal`, 'Eaten']}
      />
      {maintenance !== null && (
        <ReferenceLine
          y={maintenance}
          stroke="var(--color-faint)"
          strokeDasharray="4 4"
        />
      )}
      {goal !== null && (
        <ReferenceLine
          y={goal}
          stroke="var(--color-accent)"
          strokeDasharray="5 4"
          strokeWidth={2}
        />
      )}
    </>
  );

  return asBars ? (
    <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {marks}
      <Bar
        dataKey="kcal"
        fill={`url(#${hatch})`}
        stroke="var(--color-mark)"
        strokeWidth={1.5}
        radius={[2, 2, 0, 0]}
        {...drawIn}
      />
    </BarChart>
  ) : (
    <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {marks}
      {/* connectNulls off: a day with nothing logged is a gap, not a line
          drawn straight across it. The hatched area under it is what makes
          a long range read as an amount rather than a wire. */}
      <Area
        type="monotone"
        dataKey="kcal"
        stroke="var(--color-mark)"
        strokeWidth={2}
        fill={`url(#${hatch})`}
        dot={false}
        {...drawIn}
      />
    </ComposedChart>
  );
}

const MACRO_KEYS = ['proteinG', 'carbsG', 'fatG'] as const;
type MacroKey = (typeof MACRO_KEYS)[number];

/** "proteinG" -> "proteinTarget": the day's target for that macro. */
const targetKey = (k: MacroKey) => `${k.slice(0, -1)}Target` as const;

/**
 * Grams of each macro a day, with each one's target as a dashed line in the
 * same colour.
 *
 * The target is drawn per day rather than as one flat line, because goals
 * change on a date: a range that spans a change shows the step where it
 * happened, and a day before any goal was set shows none.
 */
function MacroChart({ rows, asBars }: { rows: DaySummaryResponse[]; asBars: boolean }) {
  const data = rows.map((r) => ({
    ...r,
    proteinTarget: r.goal?.proteinG ?? null,
    carbsTarget: r.goal?.carbsG ?? null,
    fatTarget: r.goal?.fatG ?? null,
  }));

  const id = useId();
  const hatchOf = (k: MacroKey) => `hatch-${k}-${id}`;

  const nameOf = (key: string) => {
    const eaten = MACRO_KEYS.find((k) => k === key);
    if (eaten) return MACRO_META[eaten].label;
    const target = MACRO_KEYS.find((k) => targetKey(k) === key);
    return target ? `${MACRO_META[target].label} target` : key;
  };

  return (
    // Composed rather than a plain bar chart, because the targets are lines
    // drawn over the bars.
    <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      <defs>
        {MACRO_KEYS.map((k) => (
          <Hatch key={k} id={hatchOf(k)} color={MACRO_META[k].color} />
        ))}
      </defs>
      {grid}
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
      {/* The targets are series on this chart, so the scale already
          reaches them and none is clipped off the top. */}
      <YAxis width={40} {...axis} />
      <Tooltip
        {...tooltip}
        labelFormatter={(d) => longDate(String(d))}
        formatter={(v, name) => [`${round(Number(v))} g`, nameOf(String(name))]}
      />
      {MACRO_KEYS.map((k) =>
        asBars ? (
          <Bar
            key={k}
            dataKey={k}
            fill={`url(#${hatchOf(k)})`}
            stroke={MACRO_META[k].color}
            strokeWidth={1.25}
            radius={[2, 2, 0, 0]}
            {...drawIn}
          />
        ) : (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={MACRO_META[k].color}
            strokeWidth={2}
            dot={false}
            {...drawIn}
          />
        ),
      )}
      {MACRO_KEYS.map((k) => (
        <Line
          key={targetKey(k)}
          // A step, not a slope: a target holds until the day it changes.
          type="stepAfter"
          dataKey={targetKey(k)}
          stroke={MACRO_META[k].color}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      ))}
    </ComposedChart>
  );
}

/* -------------------------------------------------------------- parts --- */

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full border-2 px-4 text-[13px] font-medium ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted'
      }`}
    >
      {children}
    </button>
  );
}

/** Identity is never colour alone, so every series is named here too. */
function Legend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="text-faint mt-3 flex flex-wrap justify-center gap-4 text-[11px]">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              i.dashed
                ? 'inline-block w-4 border-t-2 border-dashed'
                : 'inline-block h-0.5 w-4 rounded'
            }
            style={i.dashed ? { borderColor: i.color } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Averages over logged days only; a blank day is absent data, not a zero. */
function summarise(rows: DaySummaryResponse[]) {
  const logged = rows.filter((r) => r.kcal !== null);
  const mean = (pick: (r: DaySummaryResponse) => number | null) =>
    logged.length === 0
      ? 0
      : logged.reduce((a, r) => a + (pick(r) ?? 0), 0) / logged.length;

  return {
    logged: logged.length,
    missing: rows.length - logged.length,
    avgKcal: Math.round(mean((r) => r.kcal)),
    avgProtein: round(mean((r) => r.proteinG)),
    avgCarbs: round(mean((r) => r.carbsG)),
    avgFat: round(mean((r) => r.fatG)),
    goalKcal: rows.find((r) => r.goal)?.goal?.calories ?? null,
    /** The most recent goal in the range: the one the averages answer to. */
    goal: rows.findLast((r) => r.goal)?.goal ?? null,
  };
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
