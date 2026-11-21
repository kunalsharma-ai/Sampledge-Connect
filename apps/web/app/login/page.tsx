'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@sampledge/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiFailure } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (auth.status === 'signed-in' && !auth.expired) router.replace('/app');
  }, [auth.status, auth.expired, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await auth.login({
        tenantSlug: String(f.get('workspace')),
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.error.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

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
        <p className="text-meta text-text-subtle">
          Single sign-on (OIDC) and multi-factor authentication are planned.
        </p>
      </form>
    </AuthShell>
  );
}
