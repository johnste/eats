import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.ts';
import { keys } from '../lib/queries.ts';
import { Button, ErrorNote, Field } from '../components/ui.tsx';

/**
 * Only same-origin paths are followed. `next` arrives in a URL anyone can
 * craft, so allowing an absolute one would turn the sign-in page into an
 * open redirect -- the classic way a login form gets used for phishing.
 */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export function Login() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login({ email, password })
        : api.register({ email, password, displayName, inviteCode }),
    onSuccess: (user) => {
      qc.setQueryData(keys.me, user);
      void qc.invalidateQueries();
      // A full navigation, not a router push: `next` points at the OAuth
      // consent screen, which the server renders rather than the SPA.
      if (next) window.location.assign(next);
    },
  });

  const error = submit.error instanceof ApiError ? submit.error.message : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="text-ink text-3xl font-semibold tracking-tight">Eats</h1>
      <p className="text-muted mt-1 mb-8 text-sm">
        {mode === 'login'
          ? 'Sign in to your food log.'
          : 'Registration needs an invite code.'}
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        {mode === 'register' && (
          <Field
            label="Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            required
          />
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          hint={mode === 'register' ? 'At least 10 characters.' : undefined}
          required
        />
        {mode === 'register' && (
          <Field
            label="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={submit.isPending}>
          {submit.isPending
            ? 'One moment…'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </Button>
      </form>

      <button
        type="button"
        className="text-muted mt-6 text-center text-[13px] underline underline-offset-4"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          submit.reset();
        }}
      >
        {mode === 'login'
          ? 'Have an invite code? Register'
          : 'Already have an account?'}
      </button>
    </main>
  );
}
