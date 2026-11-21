'use client';
import * as React from 'react';
import { motion } from 'motion/react';
import { AtSign, Bell, CheckCheck, CheckSquare, CornerUpLeft, Stamp } from 'lucide-react';
import type { Conversation, Notification } from '@sampledge/contracts';
import { Avatar, Button, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import type { NotificationsApi } from '@/lib/notifications';
import { conversationTitle, formatDay, nameOf, relativeShort } from './helpers';

type Filter = 'all' | 'unread';

const KIND: Record<Notification['kind'], { icon: typeof AtSign; verb: string }> = {
  mention: { icon: AtSign, verb: 'mentioned you in' },
  reply: { icon: CornerUpLeft, verb: 'replied to you in' },
  task: { icon: CheckSquare, verb: 'gave you a task in' },
  approval: { icon: Stamp, verb: 'needs your approval in' },
  alert: { icon: Bell, verb: 'posted an update in' },
};

/** The notification inbox: mentions, replies, tasks, approvals and module alerts, newest first. */
export function NotificationsScreen({
  api,
  conversations,
  me,
  directory,
  onOpen,
}: {
  api: NotificationsApi;
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpen: (n: Notification) => void;
}) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const byId = React.useMemo(
    () => new Map(conversations.map((c) => [c.conversationId, c])),
    [conversations],
  );
  const items = (api.items ?? []).filter((n) => filter === 'all' || !n.readAt);
  const groups: { day: string; items: Notification[] }[] = [];
  for (const n of items) {
    const day = formatDay(n.createdAt);
    const g = groups.at(-1);
    if (g?.day === day) g.items.push(n);
    else groups.push({ day, items: [n] });
  }

  const where = (id: string) => {
    const c = byId.get(id);
    if (!c) return 'a conversation';
    const title = conversationTitle(c, me, directory);
    return c.kind === 'dm' ? 'a direct message' : c.kind === 'group' ? title : `#${title}`;
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <h1 className="font-display text-h3 text-text">Notifications</h1>
        {api.unreadCount > 0 ? (
          <span className="rounded-full bg-accent px-2 text-meta font-semibold text-accent-fg">
            {api.unreadCount} new
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Filter"
            className="flex rounded-md border border-border bg-surface p-0.5"
          >
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-sm px-3 py-1 text-meta capitalize transition-colors',
                  filter === f ? 'bg-accent-soft text-text' : 'text-text-muted hover:text-text',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={api.unreadCount === 0 || !api.online}
            onClick={() => void api.markRead({ all: true })}
          >
            <CheckCheck />
            <span className="hidden sm:inline">Mark all read</span>
          </Button>
        </div>
      </header>

      {!api.online ? (
        <p className="border-b border-border bg-warning/10 px-4 py-2 text-meta text-warning sm:px-6">
          You’re offline. Showing notifications from your last connection.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {api.items === null ? (
          <StateView state={api.online ? 'loading' : 'offline'} />
        ) : items.length === 0 ? (
          <StateView
            state="empty"
            title={filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
            description="When someone @mentions you, replies to you, gives you a task or asks for your approval, it shows up here."
          />
        ) : (
          <div className="mx-auto max-w-3xl px-2 py-3 sm:px-4">
            {groups.map((g) => (
              <section key={g.day} className="mb-3">
                <h2 className="px-3 pb-1 pt-2 text-overline uppercase text-text-subtle">{g.day}</h2>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((n) => {
                    const actor = nameOf(n.actorId, directory);
                    const k = KIND[n.kind] ?? KIND.reply;
                    const Icon = k.icon;
                    return (
                      <motion.li
                        key={n.notificationId}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <button
                          onClick={() => onOpen(n)}
                          className={cn(
                            'group relative flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors',
                            n.readAt
                              ? 'hover:bg-surface-raised'
                              : 'bg-accent-soft hover:bg-surface-raised',
                          )}
                        >
                          <span className="relative shrink-0">
                            <Avatar name={actor} size="md" />
                            <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-bg bg-accent text-accent-fg">
                              <Icon className="size-3" />
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-label font-normal text-text-muted">
                              <span className="font-semibold text-text">{actor}</span> {k.verb}{' '}
                              <span className="font-semibold text-text">
                                {where(n.conversationId)}
                              </span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-label font-normal text-text">
                              {n.preview}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-2">
                            <span className="text-meta text-text-subtle">
                              {relativeShort(n.createdAt)}
                            </span>
                            {!n.readAt ? (
                              <span aria-label="Unread" className="size-2 rounded-full bg-accent" />
                            ) : null}
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {api.hasMore && filter === 'all' ? (
              <div className="flex justify-center py-3">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={api.loadingMore}
                  disabled={!api.online}
                  onClick={() => void api.loadMore()}
                >
                  Load older
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
