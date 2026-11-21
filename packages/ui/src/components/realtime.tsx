'use client';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { motion as tokens } from '@sampledge/design-tokens';
import { cn } from '../cn.js';

/** Unread counter that pops when the number changes. Hidden at 0. */
export function UnreadCounter({
  count,
  className,
  max = 99,
}: {
  count: number;
  className?: string;
  max?: number;
}) {
  const reduce = useReducedMotion();
  const text = count > max ? `${max}+` : String(count);
  return (
    <AnimatePresence initial={false}>
      {count > 0 ? (
        <motion.span
          key={text}
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
          transition={tokens.spring.snappy}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-fg',
            className,
          )}
          aria-label={`${count} unread`}
        >
          {text}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

export function TypingIndicator({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  const who =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`;
  return (
    <div
      className={cn('flex items-center gap-2 text-meta text-text-muted', className)}
      aria-live="polite"
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-text-subtle animate-[sc-typing_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      {who}
    </div>
  );
}

export type ConnectivityState = 'online' | 'connecting' | 'syncing' | 'offline';

const CONNECTIVITY: Record<ConnectivityState, { label: string; dot: string; icon: typeof Wifi }> = {
  online: { label: 'Connected', dot: 'bg-success', icon: Wifi },
  connecting: { label: 'Reconnecting', dot: 'bg-warning', icon: RefreshCw },
  syncing: { label: 'Syncing', dot: 'bg-info', icon: RefreshCw },
  offline: { label: 'Offline', dot: 'bg-danger', icon: CloudOff },
};

/**
 * Explicit connectivity indicator. `queued` shows how many messages are
 * waiting locally, so users always know what has not reached the server.
 */
export function ConnectivityIndicator({
  state,
  queued = 0,
  compact,
  className,
}: {
  state: ConnectivityState;
  queued?: number;
  compact?: boolean;
  className?: string;
}) {
  const c = CONNECTIVITY[state];
  const Icon = c.icon;
  const spinning = state === 'connecting' || state === 'syncing';
  const label = queued > 0 ? `${c.label}, ${queued} queued` : c.label;
  return (
    <motion.div
      layout
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-surface-glass px-2.5 py-1 text-meta text-text-muted backdrop-blur-md',
        className,
      )}
    >
      <span className="relative flex size-2">
        {state !== 'online' ? (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none',
              c.dot,
            )}
          />
        ) : null}
        <span className={cn('relative inline-flex size-2 rounded-full', c.dot)} />
      </span>
      {!compact ? (
        <>
          <Icon
            className={cn('size-3.5', spinning && 'animate-spin motion-reduce:animate-none')}
            aria-hidden
          />
          <span>{c.label}</span>
          {queued > 0 ? <span className="tabular-nums text-warning">· {queued} queued</span> : null}
        </>
      ) : null}
    </motion.div>
  );
}
