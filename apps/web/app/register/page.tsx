'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@sampledge/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiFailure } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function RegisterPage() {
  const auth = useAuth();
  const router = useRouter();
  const [org, setOrg] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await auth.register({
        organizationName: org,
        tenantSlug: slug,
        ownerName: String(f.get('name')),
        ownerEmail: String(f.get('email')),
        password: String(f.get('password')),
      });
      router.replace('/app');
    } catch (err) {
      if (err instanceof ApiFailure) {
        setError(err.error.message);
        const details = err.error.details as { fieldErrors?: Record<string, string[]> } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
      } else setError('Something went wrong');
    } finally {
      setPending(false);
    }
  }

  const fe = (k: string) => fieldErrors[k]?.[0];

  return (
    <AuthShell
      title="Create your organization"
      subtitle="Set up a private, isolated workspace for your team. Free trial, no card required."
      footer={
        <>
          Already have a workspace?{' '}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Organization name" htmlFor="org" error={fe('organizationName')}>
          <Input
            id="org"
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            placeholder="Acme Research"
          />
        </Field>
        <Field
          label="Workspace URL"
          htmlFor="slug"
          hint="Teammates use this to sign in"
          error={fe('tenantSlug')}
        >
          <div className="flex items-center overflow-hidden rounded-md border border-border bg-surface-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-body text-text-subtle">connect/</span>
            <input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
              className="h-10 flex-1 bg-transparent pr-3 text-body text-text outline-none"
            />
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="name" error={fe('ownerName')}>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label="Work email" htmlFor="email" error={fe('ownerEmail')}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
        </div>
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 12 characters"
          error={fe('password')}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
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
          Create organization
        </Button>
      </form>
    </AuthShell>
  );
}
