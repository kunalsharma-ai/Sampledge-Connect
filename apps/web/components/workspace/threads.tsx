'use client';
import * as React from 'react';
import { Bookmark, Hash, MessagesSquare, Pin, X } from 'lucide-react';
import type {
  Attachment,
  Bookmark as BookmarkItem,
  Conversation,
  Receipt,
} from '@sampledge/contracts';
import type { LocalMessage, PendingReaction } from '@sampledge/offline';
import { Avatar, Badge, Button, StateView, Tooltip, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import type { BookmarksApi } from '@/lib/bookmarks';
import { threadReplies } from '@/lib/bookmarks';
import { avatarOf, conversationTitle, formatDay, formatTime, nameOf } from './helpers';
import { Composer } from './composer';
import { Timeline } from './timeline';
import type { ExtraActions } from './message-parts';

type MentionCandidate = { userId: string; displayName: string; subtitle?: string };

/** Side panel with a message and every reply under it. Replies are ordinary messages, so they sync offline. */
export function ThreadPanel({
  root,
  messages,
  conversation,
  receipts,
  me,
  directory,
  offline,
  readOnly,
  members,
  pendingReactions,
  onReact,
  actions,
  onRetry,
  onDiscard,
  onSend,
  onTyping,
  onClose,
}: {
  root: LocalMessage;
  messages: LocalMessage[];
  conversation: Conversation;
  receipts: Receipt[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  offline: boolean;
  readOnly: boolean;
  members: MentionCandidate[];
  pendingReactions: PendingReaction[];
  onReact: (m: LocalMessage, emoji: string, add: boolean) => void;
  actions: (m: LocalMessage) => ExtraActions;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  onSend: (
    text: string,
    mentions: string[],
    attachments: Attachment[],
    replyToMessageId: string,
  ) => Promise<void>;
  onTyping: (t: boolean) => void;
  onClose: () => void;
}) {
  const replies = threadReplies(messages, root.messageId!);
  const [replyTo, setReplyTo] = React.useState<LocalMessage | null>(null);
  const participants = [...new Set([root, ...replies].map((m) => m.senderId))];
  return (
    <aside
      aria-label="Thread"
      data-testid="thread-panel"
      className="fixed inset-0 z-40 flex flex-col bg-bg lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-border"
    >
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl">
        <MessagesSquare className="size-4 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-label text-text">Thread</h2>
          <p className="truncate text-meta text-text-subtle">
            {conversation.kind === 'dm' ? '' : '#'}
            {conversationTitle(conversation, me, directory)} · {replies.length}{' '}
            {replies.length === 1 ? 'reply' : 'replies'}
          </p>
        </div>
        <div className="hidden -space-x-2 sm:flex" aria-hidden>
          {participants.slice(0, 4).map((id) => (
            <Avatar
              key={id}
              name={nameOf(id, directory)}
              src={avatarOf(id, directory)}
              size="xs"
              className="ring-2 ring-bg"
            />
          ))}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close thread">
          <X />
        </Button>
      </header>
      <Timeline
        messages={[root, ...replies]}
        conversation={conversation}
        receipts={receipts}
        me={me}
        directory={directory}
        onRetry={onRetry}
        onDiscard={onDiscard}
        pendingReactions={pendingReactions}
        onReact={onReact}
        onReply={(m) => setReplyTo(m.messageId === root.messageId ? null : m)}
        actions={(m) => ({ ...actions(m), onThread: undefined })}
        threadRootId={root.messageId!}
        offline={offline}
      />
      <Composer
        placeholder="Reply in thread"
        disabled={readOnly || !!root.deletedAt}
        disabledReason={root.deletedAt ? 'This message was deleted.' : 'You can’t reply here.'}
        offline={offline}
        conversationId={conversation.conversationId}
        members={members}
        replyTo={
          replyTo
            ? {
                name: replyTo.senderId === me ? 'yourself' : nameOf(replyTo.senderId, directory),
                text: replyTo.content.text || 'attachment',
              }
            : null
        }
        onCancelReply={() => setReplyTo(null)}
        onSend={async (text, mentions, attachments) => {
          const target = replyTo?.messageId ?? root.messageId!;
          setReplyTo(null);
          await onSend(text, mentions, attachments, target);
        }}
        onTyping={onTyping}
      />
    </aside>
  );
}

/** Header button + popover listing the conversation's pinned messages. */
export function PinsMenu({
  messages,
  me,
  directory,
  onJump,
  canUnpin,
  onUnpin,
}: {
  messages: LocalMessage[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onJump: (m: LocalMessage) => void;
  canUnpin: boolean;
  onUnpin: (m: LocalMessage) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const pins = messages
    .filter((m) => m.pinned && !m.deletedAt)
    .sort((a, b) => b.pinned!.pinnedAt.localeCompare(a.pinned!.pinnedAt));
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Tooltip content="Pinned messages" side="bottom">
        <button
          onClick={() => setOpen(!open)}
          aria-label={`Pinned messages (${pins.length})`}
          aria-expanded={open}
          className={cn(
            'flex items-center gap-1 rounded-sm p-1.5 text-text-muted hover:bg-surface-raised hover:text-text',
            pins.length > 0 && 'text-accent',
          )}
        >
          <Pin className="size-4" />
          {pins.length > 0 ? <span className="text-meta font-semibold">{pins.length}</span> : null}
        </button>
      </Tooltip>
      {open ? (
        <div
          role="dialog"
          aria-label="Pinned messages"
          className="absolute right-0 top-full z-30 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-label text-text">Pinned messages</h3>
            <Badge tone="neutral">{pins.length}</Badge>
          </div>
          {pins.length === 0 ? (
            <StateView
              state="empty"
              title="Nothing pinned yet"
              description="Hover a message and choose the pin to keep it here for everyone."
              className="py-8"
            />
          ) : (
            <ul className="max-h-[420px] overflow-y-auto p-1.5">
              {pins.map((m) => (
                <li key={m.clientMessageId} className="group/pin relative">
                  <button
                    onClick={() => {
                      onJump(m);
                      setOpen(false);
                    }}
                    className="flex w-full gap-3 rounded-lg p-2.5 text-left hover:bg-surface-raised"
                  >
                    <Avatar
                      name={nameOf(m.senderId, directory)}
                      src={avatarOf(m.senderId, directory)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-label text-text">
                          {m.senderId === me ? 'You' : nameOf(m.senderId, directory)}
                        </span>
                        <span className="shrink-0 text-meta text-text-subtle">
                          {formatDay(m.createdAt)}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-label font-normal text-text-muted">
                        {m.content.text || `${m.attachments?.length ?? 0} attachment(s)`}
                      </span>
                      <span className="mt-0.5 block text-meta text-text-subtle">
                        Pinned by{' '}
                        {m.pinned!.pinnedBy === me ? 'you' : nameOf(m.pinned!.pinnedBy, directory)}
                      </span>
                    </span>
                  </button>
                  {canUnpin ? (
                    <button
                      onClick={() => onUnpin(m)}
                      aria-label="Unpin"
                      className="absolute right-2 top-2 rounded-sm p-1 text-text-subtle opacity-0 hover:bg-surface hover:text-text group-hover/pin:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Saved for later: the user's private bookmarks across conversations. */
export function SavedScreen({
  api,
  conversations,
  me,
  directory,
  onOpen,
}: {
  api: BookmarksApi;
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpen: (b: BookmarkItem) => void;
}) {
  const byId = new Map(conversations.map((c) => [c.conversationId, c]));
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="saved-screen">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <Bookmark className="size-5 text-accent" aria-hidden />
        <h1 className="font-display text-h3 text-text">Saved</h1>
        <p className="hidden text-meta text-text-subtle md:block">
          Only you can see what you save.
          {!api.online ? ' Showing your last synced list while offline.' : ''}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto">
        {api.items === null ? (
          <StateView state={api.online ? 'loading' : 'offline'} className="h-full" />
        ) : api.items.length === 0 ? (
          <StateView
            state="empty"
            title="Nothing saved yet"
            description="Hover a message and choose the bookmark to keep it here, like a to-do list for things to come back to."
            className="h-full"
          />
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-2 p-4 sm:p-6">
            {api.items.map((b) => {
              const c = byId.get(b.conversationId);
              const m = b.message;
              return (
                <li
                  key={b.messageId}
                  className="group relative rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                >
                  <button onClick={() => onOpen(b)} className="block w-full text-left">
                    <span className="flex items-center gap-1.5 text-meta text-text-subtle">
                      {c?.kind === 'channel_public' || c?.kind === 'channel_private' ? (
                        <Hash className="size-3.5" aria-hidden />
                      ) : (
                        <MessagesSquare className="size-3.5" aria-hidden />
                      )}
                      {c ? conversationTitle(c, me, directory) : 'Conversation'}
                      <span aria-hidden>·</span>
                      saved {formatDay(b.createdAt)}
                    </span>
                    <span className="mt-2 flex gap-3">
                      <Avatar
                        name={nameOf(m.senderId, directory)}
                        src={avatarOf(m.senderId, directory)}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-label text-text">
                            {m.senderId === me ? 'You' : nameOf(m.senderId, directory)}
                          </span>
                          <span className="text-meta text-text-subtle">
                            {formatDay(m.createdAt)} {formatTime(m.createdAt)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 line-clamp-3 whitespace-pre-wrap text-message text-text-muted',
                            m.deletedAt && 'italic opacity-60',
                          )}
                        >
                          {m.deletedAt
                            ? 'This message was deleted'
                            : m.content.text || `${m.attachments?.length ?? 0} attachment(s)`}
                        </span>
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!api.online}
                    onClick={() => void api.toggle(m, false)}
                    className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
