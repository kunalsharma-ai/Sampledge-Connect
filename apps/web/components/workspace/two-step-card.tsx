'use client';
import * as React from 'react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import type { MfaStatus, RecoveryCodes, TotpSetup } from '@sampledge/contracts';
import { Badge, Button, Field, Input } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Step =
  | { kind: 'idle' }
  | { kind: 'setup'; setup: TotpSetup }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'disable' }
  | { kind: 'regenerate' };

/** Two-step verification with an authenticator app (TOTP) for the signed-in person. */
export function TwoStepCard() {
  const { getAccessToken } = useAuth();
  const [status, setStatus] = React.useState<MfaStatus | null>(null);
  const [step, setStep] = React.useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const call = React.useCallback(
    async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body }),
    [getAccessToken],
  );
  const load = React.useCallback(async () => {
    try {
      setStatus(await call<MfaStatus>('GET', '/v1/auth/mfa'));
    } catch {
      /* offline */
    }
  }, [call]);
  React.useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (e: React.FormEvent<HTMLFormElement>, name: string) =>
    String(new FormData(e.currentTarget).get(name) ?? '');

  const on = !!status?.enabled;
  return (
    <section className="mt-6 rounded-xl border border-border p-4" data-testid="two-step">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-label text-text">Two-step verification</p>
            {status ? <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge> : null}
          </div>
          <p className="mt-0.5 text-meta text-text-subtle">
            {on
              ? `Signing in asks for a code from your authenticator app. ${status!.recoveryCodesLeft} recovery code${status!.recoveryCodesLeft === 1 ? '' : 's'} left.`
              : 'Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) when you sign in with a password.'}
          </p>
        </div>
        {step.kind === 'idle' && status ? (
          on ? (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStep({ kind: 'regenerate' })}>
                New recovery codes
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setStep({ kind: 'disable' })}>
                Turn off
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () =>
                  setStep({
                    kind: 'setup',
                    setup: await call<TotpSetup>('POST', '/v1/auth/mfa/totp/setup'),
                  }),
                )
              }
            >
              Set up
            </Button>
          )
        ) : null}
      </div>

      {step.kind === 'setup' ? (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            const code = field(e, 'code');
            void run(async () => {
              const r = await call<RecoveryCodes>('POST', '/v1/auth/mfa/totp/enable', { code });
              setStep({ kind: 'codes', codes: r.recoveryCodes });
              await load();
            });
          }}
        >
          <div
            className="size-[180px] overflow-hidden rounded-lg bg-white p-1 [&_svg]:size-full"
            role="img"
            aria-label="QR code for your authenticator app"
            dangerouslySetInnerHTML={{ __html: step.setup.qrSvg }}
          />
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-meta text-text-muted">
              1. Scan the code with your authenticator app, or enter this key by hand:
            </p>
            <code className="break-all rounded-md bg-surface-raised px-2 py-1.5 font-mono text-[0.8125rem] tracking-wider text-text">
              {step.setup.secret.match(/.{1,4}/g)!.join(' ')}
            </code>
            <Field label="2. Enter the 6-digit code it shows" htmlFor="totp-code">
              <Input
                id="totp-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                placeholder="123456"
                className="max-w-[12rem] font-mono tracking-[0.3em]"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy}>
                Turn on
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setStep({ kind: 'idle' })}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {step.kind === 'codes' ? (
        <RecoveryCodesPanel codes={step.codes} onDone={() => setStep({ kind: 'idle' })} />
      ) : null}

      {step.kind === 'disable' ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const password = field(e, 'password');
            const code = field(e, 'code');
            void run(async () => {
              setStatus(await call<MfaStatus>('POST', '/v1/auth/mfa/disable', { password, code }));
              setStep({ kind: 'idle' });
            });
          }}
        >
          <Field label="Password" htmlFor="mfa-pw">
            <Input
              id="mfa-pw"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Code or recovery code" htmlFor="mfa-off-code">
            <Input id="mfa-off-code" name="code" autoComplete="one-time-code" required />
          </Field>
          <Button type="submit" size="sm" variant="danger" loading={busy}>
            Turn off
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
            Cancel
          </Button>
        </form>
      ) : null}

      {step.kind === 'regenerate' ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const code = field(e, 'code');
            void run(async () => {
              const r = await call<RecoveryCodes>('POST', '/v1/auth/mfa/recovery-codes', { code });
              setStep({ kind: 'codes', codes: r.recoveryCodes });
              await load();
            });
          }}
        >
          <Field label="Code from your authenticator app" htmlFor="mfa-regen">
            <Input id="mfa-regen" name="code" inputMode="numeric" maxLength={6} required />
          </Field>
          <Button type="submit" size="sm" loading={busy}>
            Replace my recovery codes
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RecoveryCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <p className="text-label text-text">Save your recovery codes</p>
      <p className="mt-0.5 text-meta text-text-muted">
        Each code signs you in once if you lose your phone. They won’t be shown again. Any earlier
        codes no longer work.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[0.875rem] text-text sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => undefined,
            )
          }
        >
          <Copy /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
            a.download = 'sampledge-connect-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download /> Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I’ve saved them
        </Button>
      </div>
    </div>
  );
}
