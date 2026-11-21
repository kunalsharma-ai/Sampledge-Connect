import * as React from 'react';
import { cn } from '../cn.js';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-md bg-surface-raised',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[sc-shimmer_1.4s_infinite] after:bg-gradient-to-r after:from-transparent after:via-text/5 after:to-transparent motion-reduce:after:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border bg-surface-sunken px-1 font-mono text-[11px] text-text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      className={cn(vertical ? 'w-px self-stretch' : 'h-px w-full', 'bg-border', className)}
    />
  );
}
