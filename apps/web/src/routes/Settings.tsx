import {
  ACTIVITY_LEVEL_KEYS,
  round,
  SEXES,
  WEIGHT_GOALS,
  type WeightGoal,
  type ActivityLevel,
  type GoalBody,
  type Sex,
} from '@eats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Button, Card, Disclosure, ErrorNote, Field } from '../components/ui.tsx';
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

        <AgentAccessCard />

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
/**
 * Two ways for an AI assistant to reach the log. Pasting the address into a
 * connector is the ordinary one -- it signs in through a browser, so there is
 * nothing to copy. A secret phrase covers clients that cannot do that.
 */
function AgentAccessCard() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.tokens });

  // A phrase to start from, so the blank field is never the hard part.
  const suggest = useMutation({
    mutationFn: api.tokenSuggestion,
    onSuccess: ({ secret: s }) => setSecret(s),
  });

  const create = useMutation({
    mutationFn: () => api.createToken(name.trim() || 'Agent', secret.trim()),
    onSuccess: ({ secret: s }) => {
      setSaved(s);
      setName('');
      setSecret('');
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });

  const revoke = useMutation({
    mutationFn: api.revokeToken,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tokens'] }),
  });

  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: api.connections,
  });

  const disconnect = useMutation({
    mutationFn: api.disconnect,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <Disclosure
      title="Agent access"
      hint={
        connections.data?.length ? `${connections.data.length} connected` : undefined
      }
      description="Let an AI assistant search foods, log a meal, and read back your day. It cannot see your history or weights, and cannot delete anything."
    >
      <div className="bg-surface border-line mb-4 rounded-xl border p-3">
        <p className="text-muted mb-1 text-[11px] font-medium">Address</p>
        <p className="text-ink nums text-[13px] break-all">{mcpUrl}</p>
        <p className="text-faint mt-1.5 text-[11px]">
          Paste this into Claude as a custom connector and approve it in the browser. No
          phrase needed.
        </p>
      </div>

      {(connections.data?.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="text-muted mb-1 text-[11px] font-medium">Connected</p>
          <ul className="divide-line border-line divide-y border-t">
            {connections.data?.map((c) => (
              <li
                key={c.clientId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-ink truncate text-[13px]">{c.clientName}</p>
                  <p className="text-faint nums text-[11px]">
                    {c.lastUsedAt
                      ? `last used ${new Date(c.lastUsedAt).toLocaleDateString()}`
                      : 'never used'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => disconnect.mutate(c.clientId)}
                  className="text-danger shrink-0 text-[13px] underline underline-offset-4"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {saved && (
        <div className="border-accent/40 bg-accent-soft mb-4 rounded-xl border p-3">
          <p className="text-ink mb-2 text-[13px] font-medium">
            Saved. Write it down if you won't remember it — it isn't shown again.
          </p>
          <p className="text-ink mb-3 text-[15px] font-semibold break-all">{saved}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                void navigator.clipboard.writeText(saved);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSaved(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field
          label="Secret phrase"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="orchard-totem-rust"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          hint="For clients that can't sign in through a browser, such as Claude Code. A few words you'll remember; one word on its own is too easy to guess."
        />
        <button
          type="button"
          onClick={() => suggest.mutate()}
          className="text-accent text-[13px] underline underline-offset-4"
        >
          {suggest.isPending ? 'Thinking…' : 'Suggest one for me'}
        </button>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field
              label="Which agent?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude"
            />
          </div>
          <Button type="submit" disabled={create.isPending || !secret.trim()}>
            {create.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>

      {create.error instanceof ApiError && (
        <p className="mt-2">
          <ErrorNote>{create.error.message}</ErrorNote>
        </p>
      )}

      {(tokens.data?.length ?? 0) > 0 && (
        <ul className="divide-line mt-4 divide-y border-t border-line">
          {tokens.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-ink truncate text-[13px]">
                  {t.name}
                  <span className="text-faint"> · {t.hint}</span>
                </p>
                <p className="text-faint nums text-[11px]">
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : 'never used'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke.mutate(t.id)}
                className="text-danger shrink-0 text-[13px] underline underline-offset-4"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

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
    <Disclosure
      title="Your data"
      description="Everything you have logged, as a JSON file: your foods, entries, weights, goals and profile."
    >
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
    </Disclosure>
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

  const numbers: [keyof typeof form, string, string][] = [
    ['calories', 'Calories', 'kcal'],
    ['proteinG', 'Protein', 'g'],
    ['carbsG', 'Carbs', 'g'],
    ['fatG', 'Fat', 'g'],
  ];
  const complete = numbers.every(
    ([k]) => Number.isFinite(Number(form[k])) && form[k] !== '',
  );

  return (
    <Disclosure
      title="Daily goal"
      hint={goals.data ? `${Math.round(goals.data.calories)} kcal` : undefined}
      description="Changing this applies from today onward; past days keep the goal they had."
    >
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
                Capped at your resting burn of {tdee.data.bmr} kcal. Eating below that
                is not a faster route to the same place.
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
    </Disclosure>
  );
}

function ProfileCard() {
  const qc = useQueryClient();
  const profile = useProfile();
  const [sex, setSex] = useState<Sex | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | ''>('');
  const [targetWeight, setTargetWeight] = useState('');

  useEffect(() => {
    if (!profile.data) return;
    setSex(profile.data.sex ?? '');
    setBirthDate(profile.data.birthDate ?? '');
    setHeightCm(profile.data.heightCm === null ? '' : String(profile.data.heightCm));
    setActivityLevel(profile.data.activityLevel ?? '');
    setTargetWeight(
      profile.data.targetWeightKg === null ? '' : String(profile.data.targetWeightKg),
    );
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveProfile({
        sex: sex === '' ? null : sex,
        birthDate: birthDate === '' ? null : birthDate,
        heightCm: heightCm === '' ? null : Number(heightCm),
        activityLevel: activityLevel === '' ? null : activityLevel,
        // Empty clears the goal, which is how you turn the projection off.
        targetWeightKg:
          targetWeight.trim() === '' ? null : Number(targetWeight.replace(',', '.')),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.profile });
      void qc.invalidateQueries({ queryKey: ['tdee'] });
    },
  });

  return (
    <Disclosure
      title="About you"
      hint={
        profile.data?.targetWeightKg
          ? `${round(profile.data.targetWeightKg)} kg goal`
          : undefined
      }
      description="Used to estimate your daily energy use, and to work out when your weight goal is in reach."
    >
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
        <Field
          label="Goal weight"
          suffix="kg"
          inputMode="decimal"
          value={targetWeight}
          onChange={(e) => setTargetWeight(e.target.value)}
          placeholder="—"
          hint="The weight screen marks this on the chart and estimates when your trend reaches it. Leave empty for no goal."
        />

        {save.error instanceof ApiError && <ErrorNote>{save.error.message}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save'}
        </Button>
      </form>
    </Disclosure>
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
