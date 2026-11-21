'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@sampledge/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiFailure } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { MfaChallenge } from '@sampledge/contracts';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [challenge, setChallenge] = React.useState<MfaChallenge | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  React.useEffect(() => {
    if (auth.status === 'signed-in' && !auth.expired) router.replace('/app');
  }, [auth.status, auth.expired, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const ch = await auth.login({
        tenantSlug: String(f.get('workspace')),
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      if (ch) {
        setChallenge(ch);
        return;
      }
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.error.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challenge) return;
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setPending(true);
    setError(null);
    try {
      await auth.verifyMfa(challenge.challengeId, code);
      router.replace('/app');
    } catch (err) {
      const msg = err instanceof ApiFailure ? err.error.message : 'Something went wrong';
      setError(msg);
      // The challenge is gone (expired or too many tries): back to the password step.
      if (/password again/.test(msg)) setChallenge(null);
    } finally {
      setPending(false);
    }
  }

  if (challenge)
    return (
      <AuthShell
        title="Two-step verification"
        subtitle={
          useRecovery
            ? 'Enter one of the recovery codes you saved when you set this up. Each works once.'
            : 'Open your authenticator app and enter the 6-digit code for Sampledge Connect.'
        }
        footer={
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={() => {
              setChallenge(null);
              setError(null);
            }}
          >
            Use a different account
          </button>
        }
      >
        <form onSubmit={onVerify} className="flex flex-col gap-4" noValidate>
          <Field label={useRecovery ? 'Recovery code' : 'Code'} htmlFor="code">
            <Input
              key={useRecovery ? 'r' : 't'}
              id="code"
              name="code"
              autoFocus
              required
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              pattern={useRecovery ? undefined : '[0-9]*'}
              maxLength={useRecovery ? 12 : 6}
              placeholder={useRecovery ? 'xxxx-xxxx' : '123456'}
              className="text-center font-mono text-[1.25rem] tracking-[0.3em]"
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-label font-normal text-danger"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" loading={pending} className="mt-2">
            Verify and sign in
          </Button>
          <button
            type="button"
            className="text-label text-text-muted hover:text-text"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setError(null);
            }}
          >
            {useRecovery
              ? 'Use my authenticator app instead'
              : 'Lost your phone? Use a recovery code'}
          </button>
        </form>
      </AuthShell>
    );

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your organization’s workspace."
      footer={
        <>
          New to Sampledge Connect?{' '}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            Create an organization
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Workspace"
          htmlFor="workspace"
          hint="The workspace URL your admin shared, e.g. acme-research"
        >
          <Input
            id="workspace"
            name="workspace"
            autoComplete="organization"
            required
            placeholder="acme-research"
          />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-label font-normal text-danger"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" loading={pending} className="mt-2">
          Sign in
        </Button>
        <p className="text-meta text-text-subtle">Single sign-on (OIDC) is planned.</p>
      </form>
    </AuthShell>
  );
}
