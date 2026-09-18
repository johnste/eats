import { addDays, round, toDateKey } from '@eats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Card, Empty, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys } from '../lib/queries.ts';

const WINDOW_DAYS = 90;
const AVERAGE_DAYS = 7;

export function Weight() {
  const qc = useQueryClient();
  const today = toDateKey();
  const from = addDays(today, -WINDOW_DAYS);
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
      void qc.invalidateQueries({ queryKey: keys.tdee });
    },
  });

  const series = useMemo(() => withTrend(weights.data ?? []), [weights.data]);
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 400;

  const latest = series.at(-1);
  const first = series[0];
  const change =
    latest && first && series.length > 1 ? latest.weightKg - first.weightKg : null;

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Weight</h1>

      <Card className="mb-4">
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
      </Card>

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
              <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
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
          </div>
        </Card>
      )}
    </>
  );
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
