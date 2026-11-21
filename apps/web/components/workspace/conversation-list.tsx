'use client';
import * as React from 'react';
import { motion } from 'motion/react';
import { AtSign, BellOff, Hash, Lock, Plus, Search, Users } from 'lucide-react';
import type { Conversation } from '@sampledge/contracts';
import { Avatar, Kbd, Skeleton, Tooltip, UnreadCounter, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { avatarOf, conversationTitle, relativeShort } from './helpers';

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  me,
  directory,
  unread,
  onNew,
  onOpenPalette,
  filter,
}: {
  conversations: Conversation[] | undefined;
  activeId: string | null;
  onSelect: (id: string) => void;
  me: string;
  directory: Map<string, DirectoryEntry>;
  unread: Map<string, number>;
  onNew: () => void;
  onOpenPalette: () => void;
  filter: 'all' | 'channels';
}) {
  const [q, setQ] = React.useState('');
  const list = (conversations ?? [])
    .filter((c) => (filter === 'channels' ? c.kind.startsWith('channel') : true))
    .filter(
      (c) => !q || conversationTitle(c, me, directory).toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));

  const sections: { title: string; items: Conversation[] }[] = [
    { title: 'Channels', items: list.filter((c) => c.kind.startsWith('channel')) },
    { title: 'Direct messages', items: list.filter((c) => c.kind === 'dm') },
    { title: 'Groups', items: list.filter((c) => c.kind === 'group') },
  ].filter((s) => s.items.length > 0);

  return (
    <aside
      aria-label="Conversations"
      className="flex h-full w-full flex-col border-r border-border bg-surface/60 backdrop-blur-xl lg:w-[320px] lg:shrink-0"
    >
      <div className="flex h-[60px] items-center justify-between gap-2 px-4">
        <h2 className="font-display text-h3 text-text">
          {filter === 'channels' ? 'Teams & Channels' : 'Messages'}
        </h2>
        <Tooltip content="New conversation" side="bottom">
          <button
            onClick={onNew}
            aria-label="New conversation"
            className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent transition-transform hover:-translate-y-px"
          >
            <Plus className="size-4" />
          </button>
        </Tooltip>
      </div>
      <div className="px-4 pb-3">
        <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 focus-within:border-accent">
          <Search className="size-4 text-text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a conversation"
            aria-label="Find a conversation"
            className="h-full min-w-0 flex-1 bg-transparent text-label font-normal text-text outline-none placeholder:text-text-subtle"
          />
          <button
            onClick={onOpenPalette}
            className="hidden sm:block"
            aria-label="⌘K Open command palette"
            title="Open command palette"
          >
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {conversations === undefined ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : sections.length === 0 ? (
          <p className="px-3 py-8 text-center text-label font-normal text-text-subtle">
            {q ? 'No conversations match.' : 'No conversations yet. Start one with +.'}
          </p>
        ) : (
          sections.map((s) => (
            <div key={s.title} className="mb-3">
              <p className="px-3 pb-1 pt-2 text-overline uppercase text-text-subtle">{s.title}</p>
              <ul className="flex flex-col gap-0.5">
                {s.items.map((c) => {
                  const title = conversationTitle(c, me, directory);
                  const other = c.kind === 'dm' ? c.memberIds.find((id) => id !== me) : undefined;
                  const active = c.conversationId === activeId;
                  const count = unread.get(c.conversationId) ?? 0;
                  return (
                    <li key={c.conversationId}>
                      <button
                        onClick={() => onSelect(c.conversationId)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--sc-duration-fast)]',
                          active ? 'text-text' : 'hover:bg-surface-raised',
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="conv-active"
                            className="absolute inset-0 rounded-md border border-border-strong bg-surface-raised shadow-sm"
                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          />
                        ) : null}
                        <span className="relative">
                          {c.kind === 'dm' ? (
                            <Avatar
                              name={title}
                              src={avatarOf(other, directory)}
                              size="sm"
                              presence={
                                (other &&
                                  (directory.get(other)?.presence as
                                    'online' | 'offline' | undefined)) ||
                                'offline'
                              }
                            />
                          ) : (
                            <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-sunken text-text-muted">
                              {c.kind === 'channel_private' ? (
                                <Lock className="size-3.5" />
                              ) : c.kind === 'group' ? (
                                <Users className="size-3.5" />
                              ) : (
                                <Hash className="size-3.5" />
                              )}
                            </span>
                          )}
                        </span>
                        <span className="relative min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                'truncate text-label',
                                count > 0 ? 'text-text' : 'font-medium text-text-muted',
                                active && 'text-text',
                              )}
                            >
                              {title}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-meta text-text-subtle">
                              {c.myNotifyLevel === 'none' ? (
                                <BellOff aria-label="Muted" className="size-3" />
                              ) : c.myNotifyLevel === 'mentions' ? (
                                <AtSign aria-label="Mentions only" className="size-3" />
                              ) : null}
                              {relativeShort(c.lastMessageAt)}
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-meta text-text-subtle">
                              {c.myRole === null
                                ? 'Preview · not joined'
                                : c.archivedAt
                                  ? 'Archived'
                                  : c.kind === 'dm'
                                    ? (other && directory.get(other)?.title) || 'Direct message'
                                    : (c.topic ?? `${c.memberIds.length} members`)}
                            </span>
                            <UnreadCounter count={count} />
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
