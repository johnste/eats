import {
  ACTIVITY_LEVEL_KEYS,
  SEXES,
  WEIGHT_GOALS,
  type WeightGoal,
  type ActivityLevel,
  type GoalBody,
  type Sex,
} from '@eats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Button, Card, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { keys, useGoals, useMe, useProfile } from '../lib/queries.ts';

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Active',
  very_active: 'Very active',
};

export function Settings() {
  const qc = useQueryClient();
  const me = useMe();

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Settings</h1>
      <div className="space-y-4">
        <GoalsCard />
        <ProfileCard />

        <ExportCard />

        <VersionCard />

        <Card>
          {/* CC BY 4.0 requires naming the source. */}
          <h2 className="text-ink mb-1 text-[15px] font-semibold">Data sources</h2>
          <p className="text-muted text-[13px]">
            Swedish foods from{' '}
            <a
              href="https://www.livsmedelsverket.se/en/about-us/open-data/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-4"
            >
              Livsmedelsverket
            </a>
            , the Swedish Food Agency (CC BY 4.0). Branded products from{' '}
            <a
              href="https://world.openfoodfacts.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-4"
            >
              Open Food Facts
            </a>
            .
          </p>
        </Card>

        <Card>
          <p className="text-muted mb-3 text-[13px]">
            Signed in as <span className="text-ink">{me.data?.email}</span>
          </p>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await api.logout();
              qc.setQueryData(keys.me, null);
              qc.clear();
            }}
          >
            Sign out
          </Button>
        </Card>
      </div>
    </>
  );
}

/**
 * Which build this device is actually running. Worth showing because a phone
 * can sit on a stale service worker for days, and "is the fix live for me yet"
 * is otherwise unanswerable from the app itself.
 */
/** Your log is the whole point of the app; you should be able to take it away. */
function ExportCard() {
  const download = useMutation({
    mutationFn: api.exportData,
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      // Revoking immediately can cancel the download on some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  return (
    <Card>
      <h2 className="text-ink mb-1 text-[15px] font-semibold">Your data</h2>
      <p className="text-muted mb-4 text-[13px]">
        Everything you have logged, as a JSON file: your foods, entries,
        weights, goals and profile.
      </p>
      {download.error instanceof ApiError && (
        <p className="mb-3">
          <ErrorNote>{download.error.message}</ErrorNote>
        </p>
      )}
      <Button
        variant="ghost"
        className="w-full"
        disabled={download.isPending}
        onClick={() => download.mutate()}
      >
        {download.isPending ? 'Preparing…' : 'Download my data'}
      </Button>
    </Card>
  );
}

function VersionCard() {
  const built = new Date(__BUILD_TIME__);
  const valid = !Number.isNaN(built.getTime());
  // Coolify does not pass the commit to the build, so outside a local build
  // there is nothing useful to show. A row reading "unknown" is worse than no
  // row: the build time already identifies the deploy.
  const commit = __COMMIT_SHA__ === 'unknown' ? null : __COMMIT_SHA__;

  // Nothing identifiable at all -- drop the card rather than show a shell.
  if (!valid && !commit) return null;

  return (
    <Card>
      <h2 className="text-ink mb-1 text-[15px] font-semibold">Version</h2>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Deployed</dt>
          <dd className="text-ink nums text-right">
            {valid ? (
              <>
                {relativeTime(built)}
                <span className="text-faint block text-xs">
                  {built.toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </>
            ) : (
              'unknown'
            )}
          </dd>
        </div>
        {commit && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Build</dt>
            <dd className="text-ink nums">{commit}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

function relativeTime(then: Date): string {
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  let value = seconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        -Math.round(value),
        unit,
      );
    }
    value /= size;
  }
  return then.toLocaleDateString();
}

function GoalsCard() {
  const qc = useQueryClient();
  const goals = useGoals();
  const [form, setForm] = useState<Record<keyof GoalBody & string, string>>({
    calories: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    effectiveFrom: '',
  });

  useEffect(() => {
    if (!goals.data) return;
    setForm({
      calories: String(goals.data.calories),
      proteinG: String(goals.data.proteinG),
      carbsG: String(goals.data.carbsG),
      fatG: String(goals.data.fatG),
      effectiveFrom: '',
    });
  }, [goals.data]);

  const [weightGoal, setWeightGoal] = useState<WeightGoal>('lose');
  const [kgPerWeek, setKgPerWeek] = useState(0.5);

  // Advisory only: it prefills the form, it doesn't set the goal.
  const tdee = useQuery({
    queryKey: keys.tdee(weightGoal, kgPerWeek),
    queryFn: () => api.tdee(weightGoal, kgPerWeek),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api.saveGoals({
        calories: Math.round(Number(form.calories)),
        proteinG: Number(form.proteinG),
        carbsG: Number(form.carbsG),
        fatG: Number(form.fatG),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.goals });
      void qc.invalidateQueries({ queryKey: ['day'] });
    },
  });

  if (goals.isPending) return <Card><Spinner /></Card>;

  const numbers: [keyof typeof form, string, string][] = [
    ['calories', 'Calories', 'kcal'],
    ['proteinG', 'Protein', 'g'],
    ['carbsG', 'Carbs', 'g'],
    ['fatG', 'Fat', 'g'],
  ];
  const complete = numbers.every(([k]) => Number.isFinite(Number(form[k])) && form[k] !== '');

  return (
    <Card>
      <h2 className="text-ink mb-1 text-[15px] font-semibold">Daily goal</h2>
      <p className="text-muted mb-4 text-[13px]">
        Changing this applies from today onward; past days keep the goal they had.
      </p>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {numbers.map(([key, label, suffix]) => (
            <Field
              key={key}
              label={label}
              suffix={suffix}
              inputMode="decimal"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
        </div>

        {tdee.data && (
          <div className="border-line space-y-3 rounded-xl border p-3">
            <div>
              <span className="text-muted mb-1.5 block text-[13px] font-medium">
                I want to
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {WEIGHT_GOALS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setWeightGoal(g)}
                    aria-pressed={weightGoal === g}
                    className={`min-h-10 rounded-lg border text-xs ${
                      weightGoal === g
                        ? 'border-accent bg-accent-soft text-accent font-medium'
                        : 'border-line text-muted'
                    }`}
                  >
                    {g === 'lose' ? 'Lose' : g === 'gain' ? 'Gain' : 'Maintain'}
                  </button>
                ))}
              </div>
            </div>

            {weightGoal !== 'maintain' && (
              <div>
                <span className="text-muted mb-1.5 block text-[13px] font-medium">
                  Rate
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {[0.25, 0.5, 0.75, 1].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setKgPerWeek(rate)}
                      aria-pressed={kgPerWeek === rate}
                      className={`nums min-h-10 rounded-lg border text-xs ${
                        kgPerWeek === rate
                          ? 'border-accent bg-accent-soft text-accent font-medium'
                          : 'border-line text-muted'
                      }`}
                    >
                      {rate} kg
                    </button>
                  ))}
                </div>
                <p className="text-faint mt-1 text-xs">per week</p>
              </div>
            )}

            <dl className="nums space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted">Maintenance</dt>
                <dd className="text-ink">{tdee.data.tdee} kcal</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">
                  {weightGoal === 'maintain'
                    ? 'Target'
                    : `${weightGoal === 'lose' ? 'Deficit' : 'Surplus'} of ${Math.abs(tdee.data.dailyDelta)} kcal`}
                </dt>
                <dd className="text-ink font-medium">{tdee.data.calories} kcal</dd>
              </div>
            </dl>

            {tdee.data.limited && (
              <p className="text-muted text-xs">
                Capped at your resting burn of {tdee.data.bmr} kcal. Eating below
                that is not a faster route to the same place.
              </p>
            )}

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() =>
                setForm({
                  calories: String(tdee.data.calories),
                  proteinG: String(tdee.data.suggested.proteinG),
                  carbsG: String(tdee.data.suggested.carbsG),
                  fatG: String(tdee.data.suggested.fatG),
                  effectiveFrom: '',
                })
              }
            >
              Use these numbers
            </Button>
          </div>
        )}
        {tdee.error instanceof ApiError && tdee.error.status === 409 && (
          <p className="text-faint text-[13px]">{tdee.error.message}</p>
        )}

        {save.error instanceof ApiError && <ErrorNote>{save.error.message}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={!complete || save.isPending}>
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save goal'}
        </Button>
      </form>
    </Card>
  );
}

function ProfileCard() {
  const qc = useQueryClient();
  const profile = useProfile();
  const [sex, setSex] = useState<Sex | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | ''>('');

  useEffect(() => {
    if (!profile.data) return;
    setSex(profile.data.sex ?? '');
    setBirthDate(profile.data.birthDate ?? '');
    setHeightCm(profile.data.heightCm === null ? '' : String(profile.data.heightCm));
    setActivityLevel(profile.data.activityLevel ?? '');
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveProfile({
        sex: sex === '' ? null : sex,
        birthDate: birthDate === '' ? null : birthDate,
        heightCm: heightCm === '' ? null : Number(heightCm),
        activityLevel: activityLevel === '' ? null : activityLevel,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.profile });
      void qc.invalidateQueries({ queryKey: ['tdee'] });
    },
  });

  if (profile.isPending) return <Card><Spinner /></Card>;

  return (
    <Card>
      <h2 className="text-ink mb-1 text-[15px] font-semibold">About you</h2>
      <p className="text-muted mb-4 text-[13px]">
        Only used to estimate your daily energy use.
      </p>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Select
          label="Sex"
          value={sex}
          onChange={(v) => setSex(v as Sex | '')}
          options={SEXES.map((s) => [s, s === 'male' ? 'Male' : 'Female'])}
        />
        <Field
          label="Date of birth"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
        <Field
          label="Height"
          suffix="cm"
          inputMode="decimal"
          value={heightCm}
          onChange={(e) => setHeightCm(e.target.value)}
        />
        <Select
          label="Activity level"
          value={activityLevel}
          onChange={(v) => setActivityLevel(v as ActivityLevel | '')}
          options={ACTIVITY_LEVEL_KEYS.map((k) => [k, ACTIVITY_LABELS[k]])}
        />

        {save.error instanceof ApiError && <ErrorNote>{save.error.message}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save'}
        </Button>
      </form>
    </Card>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const id = useId();
  return (
    <div className="block">
      <label htmlFor={id} className="text-muted mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface border-line text-ink min-h-11 w-full rounded-xl border px-3 focus:border-accent focus:outline-none"
      >
        <option value="">Not set</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
