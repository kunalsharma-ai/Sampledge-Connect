'use client';
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { Conversation, Receipt } from '@sampledge/contracts';
import {
  displayStatus,
  overlayReactions,
  type LocalMessage,
  type PendingReaction,
} from '@sampledge/offline';
import { Avatar, MessageStatusIcon, Skeleton, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { formatDay, formatTime, nameOf } from './helpers';
import { MessageActions, MessageText, ReactionChips, ReplyQuote } from './message-parts';

const GROUP_WINDOW_MS = 5 * 60_000;

export function Timeline({
  messages,
  conversation,
  receipts,
  me,
  directory,
  onRetry,
  onDiscard,
  pendingReactions = [],
  onReact,
  onReply,
}: {
  messages: LocalMessage[] | undefined;
  conversation: Conversation;
  receipts: Receipt[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  pendingReactions?: PendingReaction[];
  onReact?: (m: LocalMessage, emoji: string, add: boolean) => void;
  onReply?: (m: LocalMessage) => void;
}) {
  const reduce = useReducedMotion();
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const count = messages?.length ?? 0;

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count, conversation.conversationId]);

  if (messages === undefined) {
    return (
      <div className="flex-1 space-y-5 px-6 py-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={cn('flex gap-3', i % 2 && 'flex-row-reverse')}>
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className={cn('h-14', i % 2 ? 'w-1/3' : 'w-1/2')} />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <StateView
          state="empty"
          title="Start the conversation"
          description="Messages you send are saved on this device first, so they’re safe even if your connection drops."
        />
      </div>
    );
  }

  const byId = new Map(messages.filter((x) => x.messageId).map((x) => [x.messageId!, x]));
  const pendingByMessage = new Map<string, PendingReaction[]>();
  for (const p of pendingReactions) {
    pendingByMessage.set(p.messageId, [...(pendingByMessage.get(p.messageId) ?? []), p]);
  }
  let lastDay = '';
  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      role="log"
      aria-live="polite"
      aria-label="Messages"
    >
      <AnimatePresence initial={false}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = formatDay(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          const own = m.senderId === me;
          const grouped =
            !showDay &&
            prev &&
            prev.senderId === m.senderId &&
            Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
          const status = own ? displayStatus(m, conversation, receipts) : null;
          const name = own ? 'You' : nameOf(m.senderId, directory);
          return (
            <React.Fragment key={m.clientMessageId}>
              {showDay ? (
                <div className="my-5 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-meta text-text-subtle">
                    {day}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <motion.div
                layout={reduce ? false : 'position'}
                initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                className={cn(
                  'group flex gap-3',
                  own && 'flex-row-reverse',
                  grouped ? 'mt-1' : 'mt-4',
                )}
                data-status={status ?? undefined}
              >
                <div className="w-9 shrink-0">
                  {!grouped ? <Avatar name={own ? nameOf(me, directory) : name} size="sm" /> : null}
                </div>
                <div
                  className={cn('flex min-w-0 max-w-[min(640px,78%)] flex-col', own && 'items-end')}
                >
                  {!grouped ? (
                    <div
                      className={cn(
                        'mb-1 flex items-baseline gap-2 px-1',
                        own && 'flex-row-reverse',
                      )}
                    >
                      <span className="text-label text-text">{name}</span>
                      <span className="text-meta text-text-subtle">{formatTime(m.createdAt)}</span>
                    </div>
                  ) : null}
                  {m.replyToMessageId ? (
                    <ReplyQuote
                      parent={(() => {
                        const p = byId.get(m.replyToMessageId);
                        return p
                          ? { senderId: p.senderId, text: p.content.text, deleted: !!p.deletedAt }
                          : null;
                      })()}
                      directory={directory}
                      me={me}
                      own={own}
                    />
                  ) : null}
                  <div className="relative max-w-full">
                    {m.messageId && !m.deletedAt && onReact && onReply ? (
                      <MessageActions
                        own={own}
                        onReact={(e) => {
                          const mine = overlayReactions(
                            m.reactions ?? [],
                            pendingByMessage.get(m.messageId!) ?? [],
                            me,
                          ).find((r) => r.emoji === e)?.mine;
                          onReact(m, e, !mine);
                        }}
                        onReply={() => onReply(m)}
                      />
                    ) : null}
                    <div
                      className={cn(
                        'whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-message shadow-sm',
                        own
                          ? 'rounded-tr-sm bg-bubble-own text-bubble-own-fg'
                          : 'rounded-tl-sm border border-border bg-bubble-other text-text',
                        grouped && (own ? 'rounded-tr-xl' : 'rounded-tl-xl'),
                        m.deletedAt && 'italic opacity-60',
                        (m.status === 'queued' || m.status === 'sending') && 'opacity-80',
                        m.status === 'failed' && 'ring-1 ring-danger',
                      )}
                    >
                      {m.deletedAt ? (
                        'This message was deleted'
                      ) : (
                        <MessageText
                          text={m.content.text}
                          mentions={m.content.mentions}
                          directory={directory}
                          me={me}
                          own={own}
                        />
                      )}
                      {m.editedAt && !m.deletedAt ? (
                        <span className="ml-1.5 text-meta opacity-70">(edited)</span>
                      ) : null}
                    </div>
                  </div>
                  {m.messageId && !m.deletedAt ? (
                    <ReactionChips
                      reactions={overlayReactions(
                        m.reactions ?? [],
                        pendingByMessage.get(m.messageId) ?? [],
                        me,
                      )}
                      directory={directory}
                      me={me}
                      own={own}
                      onToggle={(e, add) => onReact?.(m, e, add)}
                    />
                  ) : null}
                  {own ? (
                    <div className="mt-1 flex items-center gap-1.5 px-1 text-meta text-text-subtle">
                      {grouped ? (
                        <span className="opacity-0 transition-opacity group-hover:opacity-100">
                          {formatTime(m.createdAt)}
                        </span>
                      ) : null}
                      <MessageStatusIcon status={status!} />
                      {m.status === 'queued' ? <span className="text-warning">Queued</span> : null}
                      {m.status === 'failed' ? (
                        <span className="flex items-center gap-2 text-danger">
                          {m.error?.message ?? 'Not sent'}
                          <button
                            onClick={() => onRetry(m.clientMessageId)}
                            className="inline-flex items-center gap-1 rounded-sm px-1 font-semibold hover:bg-danger/10"
                          >
                            <RotateCcw className="size-3" /> Retry
                          </button>
                          <button
                            onClick={() => onDiscard(m.clientMessageId)}
                            className="inline-flex items-center gap-1 rounded-sm px-1 hover:bg-danger/10"
                            aria-label="Discard message"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </React.Fragment>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
