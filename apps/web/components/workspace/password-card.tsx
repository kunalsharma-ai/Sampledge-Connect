'use client';
import * as React from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Field, Input } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Change your own password. Your other devices are signed out; SampConnect sees that it changed. */
export function PasswordCard() {
  const { getAccessToken } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const currentPassword = String(f.get('current') ?? '');
    const newPassword = String(f.get('next') ?? '');
    if (newPassword !== String(f.get('again') ?? ''))
      return setNote({ ok: false, text: 'The two new passwords don’t match.' });
    setBusy(true);
    setNote(null);
    try {
      const r = await apiRequest<{ signedOutDevices: number }>('POST', '/v1/auth/password', {
        token: await getAccessToken(),
        body: { currentPassword, newPassword },
      });
      setOpen(false);
      setNote({
        ok: true,
        text: r.signedOutDevices
          ? `Password changed. ${r.signedOutDevices} other device${r.signedOutDevices === 1 ? ' was' : 's were'} signed out.`
          : 'Password changed.',
      });
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof ApiFailure ? err.error.message : (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border p-4" data-testid="password-card">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-label text-text">Password</p>
          <p className="text-meta text-text-muted">
            Changing it signs your other devices out. Your organization and SampConnect see that it
            changed, never the password.
          </p>
        </div>
        {!open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-3">
          <Field htmlFor="pw-current" label="Current password">
            <Input
              id="pw-current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field htmlFor="pw-next" label="New password" hint="At least 12 characters.">
            <Input
              id="pw-next"
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <Field htmlFor="pw-again" label="New password again">
            <Input
              id="pw-again"
              name="again"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Change password
            </Button>
          </div>
        </form>
      ) : null}
      {note ? (
        <p
          role="status"
          className={note.ok ? 'mt-3 text-meta text-success' : 'mt-3 text-meta text-danger'}
        >
          {note.text}
        </p>
      ) : null}
    </section>
  );
}
