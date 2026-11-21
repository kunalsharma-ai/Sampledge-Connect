'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@sampledge/ui';
import { LogoMark } from '@/components/brand';
import { Workspace } from '@/components/workspace/workspace';
import { useAuth } from '@/lib/auth';
import { EngineProvider } from '@/lib/engine';
import { CallsProvider } from '@/lib/calls';
import { OrgBrandingProvider } from '@/lib/org-branding';

function Splash({ label }: { label: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
      <LogoMark className="size-12 animate-pulse" />
      <p className="text-label font-normal text-text-subtle">{label}</p>
    </div>
  );
}

export default function AppPage() {
  const auth = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (auth.status === 'signed-out') router.replace('/login');
  }, [auth.status, router]);

  if (auth.status !== 'signed-in') return <Splash label="Opening your workspace…" />;
  return (
    <>
      {auth.expired ? (
        <div className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 border-b border-warning/30 bg-surface px-4 py-2 text-label font-normal text-warning shadow-md">
          Your session expired. Messages you write are still saved on this device.
          <Button size="sm" variant="secondary" onClick={() => router.push('/login')}>
            Sign in again
          </Button>
        </div>
      ) : null}
      <EngineProvider fallback={<Splash label="Loading messages from this device…" />}>
        <CallsProvider>
          <OrgBrandingProvider>
            <Workspace />
          </OrgBrandingProvider>
        </CallsProvider>
      </EngineProvider>
    </>
  );
}
