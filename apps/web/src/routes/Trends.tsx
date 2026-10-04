import { addDays, daysBetween, round, type DaySummaryResponse } from '@eats/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MACRO_META } from '../components/Macros.tsx';
import { Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { keys, useMaintenance } from '../lib/queries.ts';
import { useToday } from '../lib/useToday.ts';

/** Past this many days, one bar per day is thinner than the gap between them. */
const BARS_UPTO = 45;

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
  const asBars = daysBetween(from, to) <= BARS_UPTO;

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Trends</h1>

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

      {summary.isPending && valid && <Spinner />}
      {summary.isError && <ErrorNote>Couldn't load that range.</ErrorNote>}

      {summary.data && stats.logged === 0 && (
        <Empty title="Nothing logged in this range">
          Pick a longer range, or log a few days.
        </Empty>
      )}

      {summary.data && stats.logged > 0 && (
        <div className="space-y-4">
          <Card>
            {/* Averaged over days that were actually logged. Counting a blank
                day as zero would quietly drag every number down. */}
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <p className="nums text-ink text-2xl font-semibold">
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
              {stats.avgFat} fat.
            </p>
            <div className="-ml-2 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <MacroChart rows={rows} asBars={asBars} />
              </ResponsiveContainer>
            </div>
            <Legend
              items={(['proteinG', 'carbsG', 'fatG'] as const).map((k) => ({
                label: MACRO_META[k].label,
                color: MACRO_META[k].color,
              }))}
            />
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- charts --- */

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

  const marks = (
    <>
      <CartesianGrid stroke="var(--color-line)" vertical={false} />
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
      <Bar dataKey="kcal" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
    </BarChart>
  ) : (
    <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {marks}
      {/* connectNulls off: a day with nothing logged is a gap, not a line
          drawn straight across it. */}
      <Line
        type="monotone"
        dataKey="kcal"
        stroke="var(--color-accent)"
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

function MacroChart({ rows, asBars }: { rows: DaySummaryResponse[]; asBars: boolean }) {
  const keysOf = ['proteinG', 'carbsG', 'fatG'] as const;
  const shared = (
    <>
      <CartesianGrid stroke="var(--color-line)" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
      <YAxis width={40} {...axis} />
      <Tooltip
        {...tooltip}
        labelFormatter={(d) => longDate(String(d))}
        formatter={(v, name) => [
          `${round(Number(v))} g`,
          MACRO_META[name as (typeof keysOf)[number]].label,
        ]}
      />
    </>
  );

  return asBars ? (
    <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {shared}
      {keysOf.map((k) => (
        <Bar key={k} dataKey={k} fill={MACRO_META[k].color} radius={[3, 3, 0, 0]} />
      ))}
    </BarChart>
  ) : (
    <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {shared}
      {keysOf.map((k) => (
        <Line
          key={k}
          type="monotone"
          dataKey={k}
          stroke={MACRO_META[k].color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
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
      className={`min-h-9 rounded-full border-2 px-3 text-[13px] font-medium ${
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
