'use client';
import * as React from 'react';
import { Building2, Globe } from 'lucide-react';
import { Tooltip, cn, useToast } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';

/**
 * Work ⇄ Network, like switching accounts in Teams. Work is your organization; Network is
 * your cross-organization connections, statuses and communities. Each has its own offline
 * cache on this device and keeps syncing.
 */
export function SpaceSwitcher({ expanded }: { expanded: boolean }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  if (auth.personal) return null;
  const go = async (to: 'work' | 'network') => {
    if (to === auth.space) return;
    if (to === 'work') return auth.enterWork();
    setBusy(true);
    try {
      await auth.enterNetwork();
    } catch (e) {
      toast({
        title: 'Couldn’t open SampConnect Network',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };
  const items = [
    {
      id: 'work' as const,
      label: auth.primary?.tenant.name ?? 'Work',
      short: 'Work',
      icon: Building2,
    },
    { id: 'network' as const, label: 'Network', short: 'Net', icon: Globe },
  ];
  return (
    <div
      className={cn(
        'mx-3 mb-1 flex rounded-md border border-border bg-surface p-0.5',
        expanded ? '' : 'flex-col',
      )}
    >
      {items.map((it) => {
        const on = auth.space === it.id;
        const btn = (
          <button
            key={it.id}
            disabled={busy}
            onClick={() => void go(it.id)}
            aria-pressed={on}
            aria-label={`Switch to ${it.id === 'work' ? it.label : 'SampConnect Network'}`}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-meta transition-colors',
              on ? 'bg-accent-soft text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            <it.icon className={cn('size-3.5 shrink-0', on && 'text-accent')} />
            {expanded ? (
              <span className="truncate">{it.id === 'work' ? 'Work' : 'Network'}</span>
            ) : null}
          </button>
        );
        return expanded ? (
          btn
        ) : (
          <Tooltip key={it.id} content={it.id === 'work' ? it.label : 'SampConnect Network'}>
            {btn}
          </Tooltip>
        );
      })}
    </div>
  );
}
