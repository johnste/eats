import { addDays, projectWeight, round, toDateKey } from '@eats/shared';
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
import { BottomBar, BottomBarSpacer } from '../components/BottomBar.tsx';
import { Button, Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys, useProfile, WEIGHT_WINDOW_DAYS } from '../lib/queries.ts';

const AVERAGE_DAYS = 7;

export function Weight() {
  const qc = useQueryClient();
  const today = toDateKey();
  const from = addDays(today, -WEIGHT_WINDOW_DAYS);
  const [value, setValue] = useState('');

  const weights = useQuery({
    queryKey: keys.weights(from, today),
    queryFn: () => api.weights(from, today),
  });

  const save = useMutation({
    mutationFn: (weightKg: number) => api.addWeight({ measuredOn: today, weightKg }),
    onSuccess: () => {
      setValue('');
      void qc.invalidateQueries({ queryKey: keys.weights(from, today) });
      void qc.invalidateQueries({ queryKey: ['tdee'] });
    },
  });

  const profile = useProfile();
  const target = profile.data?.targetWeightKg ?? null;

  const series = useMemo(() => withTrend(weights.data ?? []), [weights.data]);

  // Straight off the readings rather than the plan: what the scale is
  // actually doing is the only thing that can date a goal.
  const projection = useMemo(
    () => (target === null ? null : projectWeight(weights.data ?? [], target, today)),
    [weights.data, target, today],
  );
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 400;

  const latest = series.at(-1);
  const first = series[0];
  const change =
    latest && first && series.length > 1 ? latest.weightKg - first.weightKg : null;

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Weight</h1>

      {weights.isPending && <Spinner />}
      {weights.isError && <ErrorNote>Couldn't load your weight history.</ErrorNote>}

      {weights.data && series.length === 0 && (
        <Empty title="No weights recorded">
          Log a few and a trend will appear here.
        </Empty>
      )}

      {series.length > 0 && (
        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="nums text-ink text-2xl font-semibold">
                {round(latest!.weightKg)}
                <span className="text-muted ml-1 text-sm font-normal">kg</span>
              </p>
              <p className="text-faint text-xs">Latest</p>
            </div>
            {change !== null && (
              <div className="text-right">
                <p
                  className={`nums text-sm font-medium ${
                    change > 0 ? 'text-fat' : 'text-accent'
                  }`}
                >
                  {change > 0 ? '+' : ''}
                  {round(change)} kg
                </p>
                <p className="text-faint text-xs">over {series.length} entries</p>
              </div>
            )}
          </div>

          {/* The daily line is mostly water; the 7-day average is the signal,
              so it is the emphasised mark and the raw points recede. */}
          <div className="h-56 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
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

          <div className="text-faint mt-3 flex justify-center gap-4 text-[11px]">
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
        </Card>
      )}

      {weights.data && (
        <div className="mt-4">
          <GoalCard
            target={target}
            projection={projection}
            entries={weights.data.length}
          />
        </div>
      )}

      <BottomBarSpacer />

      <BottomBar>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate(parsed);
          }}
        >
          <div className="flex-1">
            <Field
              label="Today's weight"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              suffix="kg"
              placeholder="—"
              invalid={value !== '' && !valid}
            />
          </div>
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
        {save.error instanceof ApiError && (
          <p className="mt-2">
            <ErrorNote>{save.error.message}</ErrorNote>
          </p>
        )}
      </BottomBar>
    </>
  );
}

/**
 * The goal, and when the readings say it arrives. Read-only: the goal itself
 * is part of your profile, so it is set in Settings with the rest of it.
 *
 * Every outcome gets a sentence. A projection that cannot be made is more
 * useful said plainly than hidden -- "you are holding steady" is the answer
 * to "when do I get there" when the trend is flat.
 */
function GoalCard({
  target,
  projection,
  entries,
}: {
  target: number | null;
  projection: ReturnType<typeof projectWeight> | null;
  entries: number;
}) {
  if (target === null) {
    return (
      <Card>
        <h2 className="text-ink mb-1 text-[15px]">Goal weight</h2>
        <p className="text-muted text-[13px]">
          Set one under Settings &rarr; About you, and it will be marked on the chart
          with an estimate of when your current trend reaches it.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="nums text-ink text-2xl font-semibold">
            {round(target)}
            <span className="text-muted ml-1 text-sm font-normal">kg</span>
          </p>
          <p className="text-faint text-xs">Goal</p>
        </div>
      </div>
      <p className="text-muted mt-3 text-[13px] leading-relaxed">
        {projectionSentence(projection, target, entries)}
      </p>
    </Card>
  );
}

function projectionSentence(
  p: ReturnType<typeof projectWeight> | null,
  target: number,
  entries: number,
): string {
  if (!p || p.status === 'insufficient') {
    return entries === 0
      ? 'Log a few weights.'
      : 'A week of readings and an estimate appears.';
  }

  const rate = `${Math.abs(round(p.kgPerWeek, 2))} kg/week`;

  if (p.status === 'reached') return 'Reached.';
  if (p.status === 'flat') return 'Holding steady — no date yet.';
  if (p.status === 'wrong-way') {
    return `${p.kgPerWeek > 0 ? 'Gaining' : 'Losing'} ${rate} — heading away from ${round(target)} kg.`;
  }

  const days = p.daysToTarget ?? 0;
  if (days > 730) return `Over two years at ${rate}.`;
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
