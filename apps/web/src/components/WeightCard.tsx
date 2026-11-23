import { addDays, projectWeight, round } from '@eats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Card, ErrorNote } from './ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys, useProfile, WEIGHT_WINDOW_DAYS } from '../lib/queries.ts';
import { useRemembered, useSpring } from '../lib/useSpring.ts';

const AVERAGE_DAYS = 7;

/**
 * Weight, as the first card on Trends: the latest reading, the change over
 * the range the page is showing, the chart, the goal, and a field for
 * today's number.
 *
 * The chart follows the page's range. What is fetched does not: at least the
 * last WEIGHT_WINDOW_DAYS are always loaded, because the 7-day average needs
 * the week before the first day shown, and the projection to the goal should
 * not lurch about because you looked at a shorter range.
 */
export function WeightCard({
  from,
  to,
  today,
}: {
  from: string;
  to: string;
  today: string;
}) {
  const qc = useQueryClient();
  // The same key the app warms on start, whenever the range allows it.
  const fetchFrom = [from, addDays(today, -WEIGHT_WINDOW_DAYS)].sort()[0] as string;

  const weights = useQuery({
    queryKey: keys.weights(fetchFrom, today),
    queryFn: () => api.weights(fetchFrom, today),
  });

  const profile = useProfile();
  const target = profile.data?.targetWeightKg ?? null;

  const all = useMemo(() => withTrend(weights.data ?? []), [weights.data]);
  const shown = all.filter((r) => r.measuredOn >= from && r.measuredOn <= to);

  // Straight off the readings rather than the plan: what the scale is
  // actually doing is the only thing that can date a goal.
  const projection = useMemo(() => {
    if (target === null) return null;
    const recent = (weights.data ?? []).filter(
      (r) => r.measuredOn >= addDays(today, -WEIGHT_WINDOW_DAYS),
    );
    return projectWeight(recent, target, today);
  }, [weights.data, target, today]);

  const latest = all.at(-1);
  const first = shown[0];
  const last = shown.at(-1);
  const change =
    first && last && shown.length > 1 ? last.weightKg - first.weightKg : null;
  const loggedToday = latest?.measuredOn === today ? latest.weightKg : null;

  // Springs from the weight last shown to the one just saved, the same way
  // the day's totals do when food is logged.
  const weightBefore = useRemembered('weight', latest?.weightKg ?? 0);
  const shownWeight = useSpring(latest?.weightKg ?? 0, {
    from: weightBefore ?? latest?.weightKg ?? 0,
  });

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="figure text-ink text-2xl font-medium">
            {latest ? (
              // Keyed on the weight, so saving a new one pops it once; only
              // when it actually changed in front of you, not on arrival.
              <span
                key={latest.weightKg}
                className={`inline-block ${
                  weightBefore !== undefined && weightBefore !== latest.weightKg
                    ? 'animate-pop'
                    : ''
                }`}
              >
                {round(shownWeight)}
              </span>
            ) : (
              '–'
            )}
            <span className="text-muted ml-1 text-sm font-normal">kg</span>
          </p>
          <p className="text-faint text-xs">
            {latest ? 'Latest weight' : 'No weight logged yet'}
          </p>
        </div>
        {change !== null && (
          <div className="text-right">
            <p
              className={`figure text-sm font-medium ${
                change > 0 ? 'text-fat' : 'text-accent'
              }`}
            >
              {change > 0 ? '+' : ''}
              {round(change)} kg
            </p>
            <p className="text-faint text-xs">over this range</p>
          </div>
        )}
      </div>

      {weights.isError && <ErrorNote>Couldn't load your weight history.</ErrorNote>}

      {shown.length > 0 && (
        <>
          {/* The daily line is mostly water; the 7-day average is the
              signal, so it is the emphasised mark and the raw points recede. */}
          <div className="-ml-2 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={shown} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="measuredOn"
                  tickFormatter={shortDate}
                  tick={{ fill: 'var(--color-faint)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis
                  // Widened to include the goal, so its line is never drawn
                  // off the top or bottom of the plot.
                  domain={
                    target === null
                      ? ['dataMin - 0.5', 'dataMax + 0.5']
                      : [
                          (min: number) => Math.min(min, target) - 0.5,
                          (max: number) => Math.max(max, target) + 0.5,
                        ]
                  }
                  tick={{ fill: 'var(--color-faint)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                  tickFormatter={(v: number) => String(Math.round(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-raised)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 12,
                    fontSize: 13,
                    color: 'var(--color-ink)',
                  }}
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value, name) => [
                    `${round(Number(value))} kg`,
                    name === 'trend' ? '7-day average' : 'Measured',
                  ]}
                />
                {target !== null && (
                  <ReferenceLine
                    y={target}
                    stroke="var(--color-accent)"
                    strokeDasharray="5 4"
                    strokeWidth={2}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="weightKg"
                  stroke="var(--color-faint)"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="trend"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="text-faint mt-2 flex justify-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="bg-accent inline-block h-0.5 w-4 rounded" aria-hidden />
              7-day average
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-faint inline-block h-px w-4" aria-hidden />
              Measured
            </span>
            {target !== null && (
              <span className="flex items-center gap-1.5">
                <span
                  className="border-accent inline-block w-4 border-t-2 border-dashed"
                  aria-hidden
                />
                Goal
              </span>
            )}
          </div>
        </>
      )}

      {target !== null && weights.data && (
        <p className="text-muted mt-3 text-[13px]">
          <span className="text-ink font-medium">
            Goal <span className="figure">{round(target)}</span> kg:
          </span>{' '}
          {projectionSentence(projection, target, weights.data.length)}
        </p>
      )}

      <TodayWeight
        loggedToday={loggedToday}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['weights'] });
          void qc.invalidateQueries({ queryKey: ['tdee'] });
        }}
        today={today}
      />
    </Card>
  );
}

/**
 * Today's number, inline. Not focused on its own: this card shares a page
 * with the intake charts now, and opening Trends to look at a chart should
 * not throw a keyboard over it.
 */
function TodayWeight({
  today,
  loggedToday,
  onSaved,
}: {
  today: string;
  loggedToday: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: (weightKg: number) => api.addWeight({ measuredOn: today, weightKg }),
    onSuccess: () => {
      setValue('');
      onSaved();
    },
  });

  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 400;

  return (
    <>
      <form
        className="border-line mt-4 flex items-center gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate(parsed);
        }}
      >
        <label className="text-muted shrink-0 text-[13px]" htmlFor="today-weight">
          Today
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            id="today-weight"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            inputMode="decimal"
            autoComplete="off"
            placeholder={loggedToday === null ? 'kg' : `${round(loggedToday)} logged`}
            aria-invalid={(value !== '' && !valid) || undefined}
            className={`bg-raised text-ink nums placeholder:text-faint focus:border-accent min-h-11 w-full rounded-full border px-4 focus:outline-none ${
              value !== '' && !valid ? 'border-danger' : 'border-line'
            }`}
          />
        </div>
        <Button type="submit" disabled={!valid || save.isPending} className="shrink-0">
          {save.isPending ? 'Saving…' : loggedToday === null ? 'Save' : 'Update'}
        </Button>
      </form>
      {save.error instanceof ApiError && (
        <p className="mt-2">
          <ErrorNote>{save.error.message}</ErrorNote>
        </p>
      )}
    </>
  );
}

function projectionSentence(
  p: ReturnType<typeof projectWeight> | null,
  target: number,
  entries: number,
): string {
  if (!p || p.status === 'insufficient') {
    return entries === 0 ? 'log a few weights.' : 'need more data.';
  }

  const rate = `${Math.abs(round(p.kgPerWeek, 2))} kg/week`;

  if (p.status === 'reached') return 'reached.';
  if (p.status === 'flat') return 'holding steady, no date yet.';
  if (p.status === 'wrong-way') {
    return `${p.kgPerWeek > 0 ? 'gaining' : 'losing'} ${rate}, heading away from it.`;
  }

  const days = p.daysToTarget ?? 0;
  if (days > 730) return `over two years at ${rate}.`;
  return `${shortDate(p.reachedOn as string)} at ${rate}, about ${humanSpan(days)} away.`;
}

function humanSpan(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.4)} months`;
}

/** Trailing mean over the last `AVERAGE_DAYS` entries, once enough exist. */
function withTrend(rows: { measuredOn: string; weightKg: number }[]) {
  return rows.map((row, i) => {
    const window = rows.slice(Math.max(0, i - AVERAGE_DAYS + 1), i + 1);
    return {
      ...row,
      trend:
        window.length >= Math.min(AVERAGE_DAYS, 3)
          ? window.reduce((a, r) => a + r.weightKg, 0) / window.length
          : null,
    };
  });
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
