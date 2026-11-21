import * as React from 'react';
import { CircleAlert, CloudOff, Inbox, LoaderCircle, ShieldAlert, CircleCheck } from 'lucide-react';
import { cn } from '../cn.js';

export type ViewState = 'loading' | 'empty' | 'error' | 'success' | 'permission-denied' | 'offline';

const DEFAULTS: Record<
  ViewState,
  { icon: React.ComponentType<{ className?: string }>; title: string; tone: string }
> = {
  loading: { icon: LoaderCircle, title: 'Loading', tone: 'text-text-subtle' },
  empty: { icon: Inbox, title: 'Nothing here yet', tone: 'text-text-subtle' },
  error: { icon: CircleAlert, title: 'Something went wrong', tone: 'text-danger' },
  success: { icon: CircleCheck, title: 'Done', tone: 'text-success' },
  'permission-denied': { icon: ShieldAlert, title: "You don't have access", tone: 'text-warning' },
  offline: { icon: CloudOff, title: "You're offline", tone: 'text-warning' },
};

/**
 * Standard screen state. Every screen renders one of these for its
 * loading, empty, error, success, permission-denied and offline cases.
 */
export function StateView({
  state,
  title,
  description,
  action,
  className,
}: {
  state: ViewState;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const d = DEFAULTS[state];
  const Icon = d.icon;
  return (
    <div
      role={state === 'error' ? 'alert' : 'status'}
      data-state={state}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-xl border border-border bg-surface-raised',
          d.tone,
        )}
      >
        <Icon
          className={cn('size-5', state === 'loading' && 'animate-spin motion-reduce:animate-none')}
        />
      </span>
      <h3 className="text-h3 text-text">{title ?? d.title}</h3>
      {description ? (
        <p className="max-w-sm text-label font-normal text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
