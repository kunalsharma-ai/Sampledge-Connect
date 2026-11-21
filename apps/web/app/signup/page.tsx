'use client';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { PersonalSignupForm } from '@/components/network/public-pages';

/** Free personal Sampledge Network account (not tied to an organization). */
export default function SignupPage() {
  return (
    <AuthShell
      title="Create your free account"
      subtitle="Connect, message and call people in any organization on Sampledge Connect. Join communities and share status updates."
      footer={
        <>
          Setting up your company?{' '}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            Create an organization
          </Link>
        </>
      }
    >
      <PersonalSignupForm />
    </AuthShell>
  );
}
