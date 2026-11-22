'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { Button, Field, Input } from '@sampledge/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiFailure } from '@/lib/api';
import { apiRequest } from '@/lib/api';
import { ssoStartUrl, useAuth } from '@/lib/auth';
import {
  NETWORK_TENANT_SLUG,
  type MfaChallenge,
  type PublicBranding,
  type SsoInfo,
  PASSWORD_CHANGE_REQUIRED,
} from '@sampledge/contracts';

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LAST_SLUG = 'sampledge.lastWorkspace';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [challenge, setChallenge] = React.useState<MfaChallenge | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);
  /** An admin or SampConnect reset the password: choose a new one to sign in. */
  const [mustChange, setMustChange] = React.useState(false);

  const [slug, setSlug] = React.useState('');
  const [sso, setSso] = React.useState<SsoInfo | null>(null);
  const [brand, setBrand] = React.useState<PublicBranding | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState(false);
  // Personal SampConnect Network account (no organization): signs in to the network space.
  const [personal, setPersonal] = React.useState(false);

  React.useEffect(() => {
    if (auth.status === 'signed-in' && !auth.expired) router.replace('/app');
  }, [auth.status, auth.expired, router]);

  // Back from the identity provider: `#sso=<one-time code>` or `#sso_error=<message>`.
  React.useEffect(() => {
    try {
      setSlug(localStorage.getItem(LAST_SLUG) ?? '');
    } catch {
      /* storage blocked */
    }
    const h = new URLSearchParams(window.location.hash.slice(1));
    const code = h.get('sso');
    const failed = h.get('sso_error');
    if (!code && !failed) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (failed) {
      setError(failed);
      return;
    }
    setPending(true);
    auth
      .completeSso(code!)
      .then(() => router.replace('/app'))
      .catch((err: unknown) => {
        setError(err instanceof ApiFailure ? err.error.message : 'Something went wrong');
        setPending(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask whether this workspace offers single sign-on once the name looks complete.
  React.useEffect(() => {
    const s = slug.trim().toLowerCase();
    if (personal || s.length < 3 || !SLUG.test(s)) {
      setSso(null);
      setBrand(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      apiRequest<SsoInfo>('GET', `/v1/auth/sso/${s}`)
        .then((r) => live && setSso(r.enabled ? r : null))
        .catch(() => live && setSso(null));
      apiRequest<PublicBranding>('GET', `/v1/branding/public/${s}`)
        .then((r) => live && setBrand(r))
        .catch(() => live && setBrand(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [slug, personal]);

  const rememberSlug = () => {
    try {
      localStorage.setItem(LAST_SLUG, slug.trim().toLowerCase());
    } catch {
      /* storage blocked */
    }
  };
  const ssoOnly = !personal && !!sso && !sso.passwordLogin && !showPassword;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    if (!personal) rememberSlug();
    const newPassword = mustChange ? String(f.get('newPassword') ?? '') : undefined;
    if (mustChange && newPassword !== String(f.get('newPasswordAgain') ?? '')) {
      setPending(false);
      return setError('The two new passwords don’t match.');
    }
    try {
      const ch = await auth.login({
        tenantSlug: personal ? NETWORK_TENANT_SLUG : String(f.get('workspace')),
        email: String(f.get('email')),
        password: String(f.get('password')),
        ...(newPassword ? { newPassword } : {}),
      });
      if (ch) {
        setChallenge(ch);
        return;
      }
      router.replace('/app');
    } catch (err) {
      if (
        err instanceof ApiFailure &&
        (err.error.details as { reason?: string } | undefined)?.reason === PASSWORD_CHANGE_REQUIRED
      )
        setMustChange(true);
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
        brand={brand}
        title="Two-step verification"
        subtitle={
          useRecovery
            ? 'Enter one of the recovery codes you saved when you set this up. Each works once.'
            : 'Open your authenticator app and enter the 6-digit code for SampConnect.'
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
      brand={brand}
      title="Welcome back"
      subtitle={
        personal
          ? 'Sign in to your personal SampConnect Network account.'
          : brand
            ? `Sign in to ${brand.organizationName}.`
            : 'Sign in to your organization’s workspace.'
      }
      footer={
        personal ? (
          <>
            No account yet?{' '}
            <Link href="/signup" className="font-semibold text-accent hover:underline">
              Create a free personal account
            </Link>
          </>
        ) : (
          <>
            New to SampConnect?{' '}
            <Link href="/register" className="font-semibold text-accent hover:underline">
              Create an organization
            </Link>
          </>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex rounded-md border border-border bg-surface p-0.5" role="tablist">
          {[
            { on: !personal, label: 'Organization', set: false },
            { on: personal, label: 'Personal account', set: true },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={t.on}
              onClick={() => {
                setPersonal(t.set);
                setError(null);
              }}
              className={
                'flex-1 rounded-sm px-3 py-1.5 text-label transition-colors ' +
                (t.on ? 'bg-accent-soft text-text shadow-sm' : 'text-text-muted hover:text-text')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {personal ? null : (
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
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>
        )}
        {brand?.loginMessage ? (
          <p
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-label font-normal text-text"
            data-testid="login-message"
          >
            {brand.loginMessage}
          </p>
        ) : null}
        {sso && !personal ? (
          <>
            <Button
              type="button"
              size="lg"
              variant={ssoOnly ? 'primary' : 'secondary'}
              loading={redirecting}
              onClick={() => {
                rememberSlug();
                setRedirecting(true);
                window.location.assign(ssoStartUrl(slug.trim().toLowerCase()));
              }}
            >
              <KeyRound /> {sso.label ?? 'Continue with single sign-on'}
            </Button>
            {ssoOnly ? (
              <button
                type="button"
                className="text-label text-text-muted hover:text-text"
                onClick={() => setShowPassword(true)}
              >
                Organization owner? Sign in with your password
              </button>
            ) : (
              <div className="flex items-center gap-3 text-meta text-text-subtle" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                or use your password
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
          </>
        ) : null}
        {ssoOnly ? null : (
          <>
            <Field label={personal ? 'Email' : 'Work email'} htmlFor="email">
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
            {mustChange ? (
              <>
                <Field label="New password" htmlFor="newPassword" hint="At least 12 characters.">
                  <Input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </Field>
                <Field label="New password again" htmlFor="newPasswordAgain">
                  <Input
                    id="newPasswordAgain"
                    name="newPasswordAgain"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </Field>
              </>
            ) : null}
            <Button type="submit" size="lg" loading={pending} className="mt-2">
              {mustChange ? 'Set new password and sign in' : 'Sign in'}
            </Button>
          </>
        )}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-label font-normal text-danger"
          >
            {error}
          </p>
        ) : null}
      </form>
    </AuthShell>
  );
}
