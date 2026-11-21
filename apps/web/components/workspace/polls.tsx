'use client';
import * as React from 'react';
import { BarChart3, Check, Clock, Lock, Plus, Send, Trash2, X } from 'lucide-react';
import { MAX_POLL_OPTIONS, type Poll, type ScheduledMessage } from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  cn,
  useToast,
} from '@sampledge/ui';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/lib/auth';
import { useEngine, useEngineChange, type DirectoryEntry } from '@/lib/engine';
import { pollsApi, scheduledApi } from '@/lib/polls';
import { nameOf } from './helpers';

const when = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * A poll inside the timeline. Votes go through the device's action queue, so they count
 * offline too and are sent on reconnect; results update live for everyone.
 */
export function PollCard({
  message,
  poll,
  me,
  directory,
  own,
  offline,
  canModerate,
}: {
  message: LocalMessage;
  poll: Poll;
  me: string;
  directory: Map<string, DirectoryEntry>;
  own: boolean;
  offline: boolean;
  canModerate: boolean;
}) {
  const { getAccessToken } = useAuth();
  const { db, engine } = useEngine();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [anonMine, setAnonMine] = React.useState<string[] | null>(null);
  const closed = !!poll.closedAt;
  const id = message.messageId!;
  /** A vote made on this device that the server hasn't confirmed yet. */
  const queuedVote = useLiveQuery(() => db.actions.get(`vote|${id}`), [db, id]);
  const pendingVote =
    queuedVote?.state === 'queued' ? (queuedVote.body as { optionIds: string[] }).optionIds : null;

  React.useEffect(() => {
    if (!poll.anonymous || offline) return;
    let live = true;
    void pollsApi
      .mine(getAccessToken, id)
      .then((r) => live && setAnonMine(r.optionIds))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [poll.anonymous, id, offline, getAccessToken, poll.totalVoters]);

  // My vote changed on another device (the only live source of it in anonymous polls).
  useEngineChange(['pollVote'], (e) => {
    if (e.type === 'pollVote' && e.messageId === id) setAnonMine(e.optionIds);
  });
  const mine =
    pendingVote ??
    (poll.anonymous
      ? (anonMine ?? [])
      : poll.options.filter((o) => o.voterIds.includes(me)).map((o) => o.optionId));
  const voted = mine.length > 0;
  const showResults = voted || closed;
  const max = Math.max(1, ...poll.options.map((o) => o.count));

  const choose = (optionId: string) => {
    if (closed) return;
    const next = poll.multiple
      ? mine.includes(optionId)
        ? mine.filter((x) => x !== optionId)
        : [...mine, optionId]
      : mine.includes(optionId)
        ? []
        : [optionId];
    if (poll.anonymous) setAnonMine(next);
    void engine.queueAction({
      key: `vote|${id}`,
      method: 'PUT',
      path: `/v1/messages/${id}/poll/vote`,
      body: { optionIds: next },
      label: 'Vote in poll',
      conversationId: message.conversationId,
      messageId: id,
    });
  };

  const close = async () => {
    setBusy(true);
    try {
      await pollsApi.close(getAccessToken, id);
    } catch (e) {
      toast({
        title: 'Couldn’t close the poll',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'w-[min(420px,100%)] rounded-xl border bg-surface p-4 shadow-sm',
        own ? 'border-accent/40' : 'border-border',
      )}
      data-testid="poll-card"
    >
      <div className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <h4 className="text-label font-semibold text-text">{poll.question}</h4>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-meta text-text-subtle">
        <span>{poll.multiple ? 'Choose any' : 'Choose one'}</span>
        {poll.anonymous ? (
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" /> Anonymous
          </span>
        ) : null}
        {closed ? (
          <Badge tone="neutral">Closed</Badge>
        ) : poll.closesAt ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" /> Closes {when.format(new Date(poll.closesAt))}
          </span>
        ) : null}
      </p>
      <ul
        className="mt-3 flex flex-col gap-1.5"
        role={poll.multiple ? 'group' : 'radiogroup'}
        aria-label={poll.question}
      >
        {poll.options.map((o) => {
          const picked = mine.includes(o.optionId);
          const pct = poll.totalVoters ? Math.round((o.count / poll.totalVoters) * 100) : 0;
          return (
            <li key={o.optionId}>
              <button
                type="button"
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={picked}
                disabled={closed}
                onClick={() => void choose(o.optionId)}
                className={cn(
                  'relative flex w-full items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-left text-label transition-colors disabled:cursor-default',
                  picked
                    ? 'border-accent text-text'
                    : 'border-border text-text hover:border-border-strong',
                )}
              >
                {showResults ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 transition-[width] duration-500 motion-reduce:transition-none',
                      picked ? 'bg-accent-soft' : 'bg-surface-raised',
                    )}
                    style={{ width: `${(o.count / max) * 100}%` }}
                  />
                ) : null}
                <span
                  className={cn(
                    'relative flex size-4 shrink-0 items-center justify-center border',
                    poll.multiple ? 'rounded-sm' : 'rounded-full',
                    picked ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
                  )}
                >
                  {picked ? <Check className="size-3" /> : null}
                </span>
                <span className="relative min-w-0 flex-1 truncate">{o.text}</span>
                {showResults ? (
                  <span className="relative flex items-center gap-2 text-meta text-text-muted">
                    {!poll.anonymous && o.voterIds.length ? (
                      <span className="hidden -space-x-1.5 sm:flex" aria-hidden>
                        {o.voterIds.slice(0, 3).map((v) => (
                          <Avatar
                            key={v}
                            name={nameOf(v, directory)}
                            size="xs"
                            className="ring-2 ring-surface"
                          />
                        ))}
                      </span>
                    ) : null}
                    {pct}%
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 text-meta text-text-subtle">
        <span>
          {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
          {!showResults && !closed ? ' · vote to see results' : ''}
          {pendingVote ? ' · your vote is waiting to sync' : ''}
        </span>
        {!closed && (message.senderId === me || canModerate) ? (
          <button
            type="button"
            onClick={() => void close()}
            disabled={offline || busy}
            className="rounded-sm px-1 font-medium text-text-muted hover:text-text disabled:opacity-40"
          >
            Close poll
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Ask a question with 2 to 10 answers. */
export function CreatePollDialog({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
}) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [question, setQuestion] = React.useState('');
  const [options, setOptions] = React.useState(['', '']);
  const [multiple, setMultiple] = React.useState(false);
  const [anonymous, setAnonymous] = React.useState(false);
  const [closesAt, setClosesAt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
    setAnonymous(false);
    setClosesAt('');
    setError(null);
  }, [open]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupes = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const valid = question.trim() && filled.length >= 2 && !dupes;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await pollsApi.create(getAccessToken, conversationId, {
        question: question.trim(),
        options: filled,
        multiple,
        anonymous,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      });
      toast({ title: 'Poll posted', tone: 'success' });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create a poll"
        description="Everyone in this conversation can vote. Results update live."
      >
        <form onSubmit={submit} className="flex flex-col gap-4" data-testid="create-poll">
          <Field label="Question" htmlFor="poll-q">
            <Input
              id="poll-q"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which day works for the client kick-off?"
              autoFocus
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label text-text">Answers</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Answer ${i + 1}`}
                  value={o}
                  maxLength={200}
                  onChange={(e) =>
                    setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  placeholder={`Answer ${i + 1}`}
                />
                {options.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove answer ${i + 1}`}
                    onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
            {options.length < MAX_POLL_OPTIONS ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setOptions((cur) => [...cur, ''])}
              >
                <Plus /> Add answer
              </Button>
            ) : null}
            {dupes ? <p className="text-meta text-danger">Answers must be different.</p> : null}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-label text-text">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => setMultiple(e.target.checked)}
                className="size-4 accent-[var(--sc-accent)]"
              />
              Allow more than one answer
            </label>
            <label className="flex items-center gap-2 text-label text-text">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="size-4 accent-[var(--sc-accent)]"
              />
              Anonymous votes
            </label>
          </div>
          <Field label="Close automatically (optional)" htmlFor="poll-close">
            <Input
              id="poll-close"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!valid}>
              Post poll
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "2 scheduled messages" bar above the composer, expandable into a list. */
export function ScheduledBar({ items, offline }: { items: ScheduledMessage[]; offline: boolean }) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;
  const failed = items.filter((i) => i.status === 'failed').length;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast({ title: done, tone: 'success' });
    } catch (e) {
      toast({ title: 'That didn’t work', description: (e as Error).message, tone: 'danger' });
    }
  };
  return (
    <div
      className="mx-4 mb-2 overflow-hidden rounded-lg border border-border bg-surface sm:mx-6"
      data-testid="scheduled-bar"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-label text-text hover:bg-surface-raised"
      >
        <Clock className="size-4 text-accent" />
        <span className="flex-1">
          {items.length} scheduled {items.length === 1 ? 'message' : 'messages'}
          <span className="ml-2 text-meta text-text-subtle">
            next {when.format(new Date(items[0]!.sendAt))}
          </span>
        </span>
        {failed ? <Badge tone="danger">{failed} failed</Badge> : null}
        <span className="text-meta text-text-subtle">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto border-t border-border">
          {items.map((s) => (
            <li key={s.scheduledId} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-label font-normal text-text">{s.content.text}</p>
                <p
                  className={cn(
                    'mt-0.5 text-meta',
                    s.status === 'failed' ? 'text-danger' : 'text-text-subtle',
                  )}
                >
                  {s.status === 'failed'
                    ? `Not sent: ${s.error ?? 'failed'}`
                    : `Sends ${when.format(new Date(s.sendAt))}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Send now"
                  disabled={offline}
                  onClick={() =>
                    void act(() => scheduledApi.sendNow(getAccessToken, s.scheduledId), 'Sent')
                  }
                >
                  <Send />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancel scheduled message"
                  disabled={offline}
                  onClick={() =>
                    void act(
                      () => scheduledApi.cancel(getAccessToken, s.scheduledId),
                      'Scheduled message cancelled',
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
