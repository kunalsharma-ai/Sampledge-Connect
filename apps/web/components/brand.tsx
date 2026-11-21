import { cn } from '@sampledge/ui';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="sc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--sc-color-accent)" />
          <stop offset="1" stopColor="var(--sc-color-accent2)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="var(--sc-color-surface-raised)" />
      <path
        d="M20 22.5c0-3.6 2.9-6.5 6.5-6.5h11c3.6 0 6.5 2.9 6.5 6.5v7c0 3.6-2.9 6.5-6.5 6.5H30l-6.5 5.5c-.7.6-1.7.1-1.7-.8V35.3C20.7 34.2 20 32.4 20 30.5z"
        fill="url(#sc-logo)"
      />
      <circle cx="42" cy="42" r="8" fill="none" stroke="url(#sc-logo)" strokeWidth="3.5" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-[17px] font-bold tracking-tight text-text">
        Samp<span className="font-semibold text-text-muted">Connect</span>
      </span>
    </span>
  );
}
