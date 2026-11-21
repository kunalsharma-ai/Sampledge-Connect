'use client';
import * as React from 'react';
import { Check, Forward, Hash, Lock, Search, Users } from 'lucide-react';
import {
  MAX_FORWARD_TARGETS,
  type Conversation,
  type ForwardedSnapshot,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { Avatar, Button, Dialog, DialogContent, Field, Input, Textarea, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { avatarOf, conversationTitle, nameOf } from './helpers';

/** Where a forward says it came from, as the forwarder sees it (the server keeps its own copy). */
export function forwardSource(c: Conversation, me: string, dir: Map<string, DirectoryEntry>) {
  if (c.kind === 'dm') return conversationTitle(c, me, dir);
  if (c.kind === 'group') return c.name ?? null;
  return c.name ? `#${c.name}` : null;
}

/**
 * Forward a message to up to ten conversations, with an optional comment. Each forward is an
 * ordinary queued send: it shows straight away, waits offline, and goes when you reconnect.
 */
export function ForwardDialog({
  message,
  source,
  conversations,
  me,
  directory,
  onOpenChange,
  onForward,
}: {
  message: LocalMessage | null;
  source: Conversation | null;
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpenChange: (o: boolean) => void;
  onForward: (targets: string[], comment: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [comment, setComment] = React.useState('');
  React.useEffect(() => {
    setQ('');
    setPicked([]);
    setComment('');
  }, [message]);

  const isModerator = (c: Conversation) => c.myRole === 'owner' || c.myRole === 'moderator';
  const candidates = conversations
    .filter(
      (c) =>
        c.myRole !== null && !c.archivedAt && (c.postingPolicy !== 'moderators' || isModerator(c)),
    )
    .map((c) => ({ c, title: conversationTitle(c, me, directory) }))
    .filter(({ title }) => title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.c.lastMessageAt ?? '').localeCompare(a.c.lastMessageAt ?? ''));
  const full = picked.length >= MAX_FORWARD_TARGETS;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));

  const original = message ? forwardPreview(message, source, me, directory) : null;

  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent
        title="Forward message"
        description={`Pick up to ${MAX_FORWARD_TARGETS} conversations. Files go with it.`}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!picked.length) return;
            onForward(picked, comment.trim());
            onOpenChange(false);
          }}
        >
          {original ? <ForwardedCard snapshot={original} directory={directory} me={me} /> : null}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
              aria-hidden
            />
            <Input
              aria-label="Find a conversation"
              placeholder="Find a conversation"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <ul
            className="max-h-64 overflow-y-auto rounded-lg border border-border"
            aria-label="Conversations"
          >
            {candidates.length === 0 ? (
              <li className="px-3 py-6 text-center text-meta text-text-muted">
                No conversations match
              </li>
            ) : (
              candidates.map(({ c, title }) => {
                const on = picked.includes(c.conversationId);
                const other = c.kind === 'dm' ? c.memberIds.find((id) => id !== me) : undefined;
                return (
                  <li key={c.conversationId}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={!on && full}
                      onClick={() => toggle(c.conversationId)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left text-body text-text hover:bg-surface-raised disabled:opacity-50',
                        on && 'bg-accent-soft/50',
                      )}
                    >
                      {other ? (
                        <Avatar
                          name={nameOf(other, directory)}
                          src={avatarOf(other, directory)}
                          size="sm"
                        />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                          {c.kind === 'group' ? (
                            <Users className="size-4" />
                          ) : c.kind === 'channel_private' ? (
                            <Lock className="size-4" />
                          ) : (
                            <Hash className="size-4" />
                          )}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      <span
                        className={cn(
                          'flex size-5 items-center justify-center rounded border',
                          on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
                        )}
                        aria-hidden
                      >
                        {on ? <Check className="size-3.5" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <Field label="Add a comment (optional)" htmlFor="forward-comment">
            <Textarea
              id="forward-comment"
              rows={2}
              maxLength={10_000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-text-muted" aria-live="polite">
              {picked.length ? `${picked.length} selected` : 'None selected'}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!picked.length}>
                <Forward className="size-4" aria-hidden />
                Forward
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What the optimistic copy shows until the server confirms its own snapshot. */
export function forwardPreview(
  m: LocalMessage,
  source: Conversation | null,
  me: string,
  directory: Map<string, DirectoryEntry>,
): ForwardedSnapshot {
  const prior = m.metadata?.forwarded as ForwardedSnapshot | undefined;
  if (prior?.messageId) return prior;
  return {
    messageId: m.messageId!,
    conversationId: m.conversationId,
    senderId: m.senderId,
    text: m.content.text,
    createdAt: m.createdAt,
    from: source ? forwardSource(source, me, directory) : null,
  };
}

/** The quoted original inside a forwarded message. */
export function ForwardedCard({
  snapshot,
  directory,
  me,
  own = false,
  onOpen,
}: {
  snapshot: ForwardedSnapshot;
  directory: Map<string, DirectoryEntry>;
  me: string;
  own?: boolean;
  /** Jump to the original, when you can read it. */
  onOpen?: () => void;
}) {
  const who = snapshot.senderId === me ? 'You' : nameOf(snapshot.senderId, directory);
  const when = new Date(snapshot.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-meta text-text-muted">
        <Forward className="size-3.5" aria-hidden />
        Forwarded
        {snapshot.from ? <> from {snapshot.from}</> : null}
      </span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="text-label text-text">{who}</span>
        <span className="text-meta text-text-subtle">{when}</span>
      </span>
      {snapshot.text ? (
        <span className="mt-0.5 line-clamp-6 whitespace-pre-wrap break-words text-message text-text">
          {snapshot.text}
        </span>
      ) : null}
    </>
  );
  const cls = cn(
    'flex w-full flex-col rounded-xl border border-border border-l-4 border-l-accent bg-surface px-3.5 py-2.5 text-left shadow-sm',
    own && 'self-end',
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(cls, 'hover:bg-surface-raised')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
