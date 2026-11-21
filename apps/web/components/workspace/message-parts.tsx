'use client';
import * as React from 'react';
import { CornerUpLeft, SmilePlus } from 'lucide-react';
import type { Reaction } from '@sampledge/contracts';
import { Tooltip, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { nameOf, senderNameOf } from './helpers';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

/** Renders message text with @mentions of known members highlighted. */
export function MessageText({
  text,
  mentions,
  directory,
  me,
  own,
}: {
  text: string;
  mentions: string[];
  directory: Map<string, DirectoryEntry>;
  me: string;
  own: boolean;
}) {
  const names = mentions
    .map((id) => ({ id, name: directory.get(id)?.displayName }))
    .filter((x): x is { id: string; name: string } => !!x.name)
    .sort((a, b) => b.name.length - a.name.length);
  if (names.length === 0) return <>{text}</>;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@(${names.map((n) => escape(n.name)).join('|')})`, 'g');
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const i = match.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const who = names.find((n) => n.name === match[1]);
    parts.push(
      <span
        key={i}
        className={cn(
          'rounded-sm px-0.5 font-semibold',
          who?.id === me
            ? 'bg-warning/25 text-text'
            : own
              ? 'bg-white/20'
              : 'bg-accent-soft text-accent',
        )}
      >
        {match[0]}
      </span>,
    );
    last = i + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ReplyQuote({
  parent,
  directory,
  me,
  own,
}: {
  parent: { senderId: string; text: string; deleted: boolean } | null;
  directory: Map<string, DirectoryEntry>;
  me: string;
  own: boolean;
}) {
  return (
    <div
      className={cn(
        'mb-1 max-w-full rounded-md border-l-2 px-2.5 py-1 text-meta',
        own ? 'border-accent bg-accent-soft' : 'border-accent2 bg-surface-raised',
      )}
    >
      {parent ? (
        <>
          <span className="font-semibold text-text">
            {parent.senderId === me ? 'You' : senderNameOf(parent, directory)}
          </span>
          <span className="line-clamp-1 text-text-muted">
            {parent.deleted ? 'Deleted message' : parent.text}
          </span>
        </>
      ) : (
        <span className="text-text-subtle">Earlier message</span>
      )}
    </div>
  );
}

export function ReactionChips({
  reactions,
  directory,
  me,
  onToggle,
  own,
}: {
  reactions: (Reaction & { mine: boolean; pending: boolean })[];
  directory: Map<string, DirectoryEntry>;
  me: string;
  onToggle: (emoji: string, add: boolean) => void;
  own: boolean;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', own && 'justify-end')}>
      {reactions.map((r) => {
        const who = r.userIds.map((id) =>
          id === me ? 'You' : nameOf(id, directory).split(' ')[0],
        );
        const more = r.count - r.userIds.length;
        return (
          <Tooltip
            key={r.emoji}
            side="top"
            content={`${who.join(', ')}${more > 0 ? ` and ${more} more` : ''}`}
          >
            <button
              onClick={() => onToggle(r.emoji, !r.mine)}
              aria-pressed={r.mine}
              aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
              className={cn(
                'flex h-7 items-center gap-1 rounded-full border px-2 text-meta transition-[transform,background-color] duration-[var(--sc-duration-fast)] hover:-translate-y-px',
                r.mine
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-border bg-surface-raised text-text-muted',
                r.pending && 'opacity-70',
              )}
            >
              <span className="text-[14px] leading-none">{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Hover toolbar: quick reactions and reply. Keyboard reachable via focus-within. */
export function MessageActions({
  own,
  onReact,
  onReply,
}: {
  own: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      onMouseLeave={() => setOpen(false)}
      className={cn(
        'pointer-events-none absolute -top-4 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 opacity-0 shadow-md transition-opacity duration-[var(--sc-duration-fast)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        own ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
        open && 'pointer-events-auto opacity-100',
      )}
    >
      {open ? (
        QUICK_REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => {
              onReact(e);
              setOpen(false);
            }}
            aria-label={`React ${e}`}
            className="flex size-7 items-center justify-center rounded-full text-[15px] transition-transform hover:scale-125"
          >
            {e}
          </button>
        ))
      ) : (
        <>
          <button
            onClick={() => setOpen(true)}
            aria-label="Add reaction"
            className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text"
          >
            <SmilePlus className="size-4" />
          </button>
          <button
            onClick={onReply}
            aria-label="Reply"
            className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text"
          >
            <CornerUpLeft className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
