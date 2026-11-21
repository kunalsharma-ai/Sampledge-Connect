'use client';
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Languages, MessagesSquare, Pin, RotateCcw, Trash2 } from 'lucide-react';
import type { Conversation, Receipt } from '@sampledge/contracts';
import {
  displayStatus,
  overlayReactions,
  type LocalMessage,
  type PendingReaction,
} from '@sampledge/offline';
import { Avatar, MessageStatusIcon, Skeleton, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { formatDay, formatTime, nameOf, senderNameOf } from './helpers';
import { MessageAttachments } from './attachments';
import {
  MessageActions,
  MessageText,
  ReactionChips,
  ReplyQuote,
  type ExtraActions,
} from './message-parts';
import { CallCard } from './calls';
import { MeetingCard } from './meetings';
import { CallRecordingCard } from './recordings';
import { PollCard } from './polls';
import { ModuleActionCard, ModuleCard, WorkCard } from './work-cards';
import type { MeetingSystemMetadata } from '@sampledge/contracts';

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
  offline = false,
  onOpenMeeting,
  actions,
  replyCounts,
  onOpenThread,
  threadRootId,
  highlightId,
  emptyState,
  canModerate = false,
  onCreateTask,
  onRequestApproval,
  onTranslate,
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
  offline?: boolean;
  onOpenMeeting?: (meta: MeetingSystemMetadata) => void;
  /** Pin, save and thread actions for a confirmed message. */
  actions?: (m: LocalMessage) => ExtraActions;
  /** Reply counts by message id; shows a "N replies" link that opens the thread. */
  replyCounts?: Map<string, number>;
  onOpenThread?: (m: LocalMessage) => void;
  /** In a thread view: replies to the root don't repeat its quote. */
  threadRootId?: string;
  /** Briefly highlights a message (jump from pins or saved items). */
  highlightId?: string | null;
  emptyState?: React.ReactNode;
  /** Conversation owner/moderator or tenant admin: may close anyone's poll. */
  canModerate?: boolean;
  onCreateTask?: (m: LocalMessage) => void;
  onRequestApproval?: (m: LocalMessage) => void;
  /** AI translation of one message, when the assistant is available. */
  onTranslate?: (messageId: string) => Promise<{ text: string | null; label: string }>;
}) {
  const reduce = useReducedMotion();
  const [translations, setTranslations] = React.useState<
    Map<string, { state: 'loading' | 'done' | 'error'; text?: string; label?: string }>
  >(new Map());
  const translate = (messageId: string) => {
    if (!onTranslate) return;
    if (translations.get(messageId)?.state === 'done') {
      setTranslations((t) => {
        const n = new Map(t);
        n.delete(messageId);
        return n;
      });
      return;
    }
    setTranslations((t) => new Map(t).set(messageId, { state: 'loading' }));
    onTranslate(messageId).then(
      (r) =>
        setTranslations((t) =>
          new Map(t).set(
            messageId,
            r.text === null
              ? {
                  state: 'error',
                  text: 'Translation needs your model server (Administration › Integrations).',
                }
              : { state: 'done', text: r.text, label: r.label },
          ),
        ),
      (e: unknown) =>
        setTranslations((t) =>
          new Map(t).set(messageId, {
            state: 'error',
            text: (e as Error).message || 'Translation failed',
          }),
        ),
    );
  };
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const count = messages?.length ?? 0;

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count, conversation.conversationId]);

  React.useEffect(() => {
    if (!highlightId) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${highlightId}"]`);
    if (!el) return;
    atBottom.current = false;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [highlightId, count, reduce]);

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
    if (emptyState) return <>{emptyState}</>;
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
            prev.messageType !== 'system' &&
            m.messageType !== 'system' &&
            prev.senderId === m.senderId &&
            Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
          const status = own ? displayStatus(m, conversation, receipts) : null;
          const name = own ? 'You' : senderNameOf(m, directory);
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
              {m.messageType === 'system' && m.metadata?.meeting && !m.deletedAt ? (
                <MeetingCard
                  message={m}
                  me={me}
                  directory={directory}
                  onOpen={() => onOpenMeeting?.(m.metadata.meeting as MeetingSystemMetadata)}
                />
              ) : m.messageType === 'system' && m.metadata?.recording && !m.deletedAt ? (
                <CallRecordingCard message={m} me={me} directory={directory} />
              ) : m.messageType === 'system' && m.metadata?.module && !m.deletedAt ? (
                <ModuleCard message={m} directory={directory} />
              ) : m.messageType === 'system' && m.metadata?.work && !m.deletedAt ? (
                <WorkCard message={m} directory={directory} />
              ) : m.messageType === 'system' && m.metadata?.moduleAction && !m.deletedAt ? (
                <ModuleActionCard message={m} directory={directory} />
              ) : m.messageType === 'system' && m.metadata?.call && !m.deletedAt ? (
                <CallCard message={m} me={me} directory={directory} offline={offline} />
              ) : (
                <motion.div
                  layout={reduce ? false : 'position'}
                  initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className={cn(
                    'group flex gap-3 rounded-lg transition-colors duration-700',
                    own && 'flex-row-reverse',
                    grouped ? 'mt-1' : 'mt-4',
                    highlightId && m.messageId === highlightId && 'bg-accent-soft/60',
                  )}
                  data-status={status ?? undefined}
                  data-message-id={m.messageId ?? undefined}
                >
                  <div className="w-9 shrink-0">
                    {!grouped ? (
                      <Avatar name={own ? nameOf(me, directory) : name} size="sm" />
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      'flex min-w-0 max-w-[min(640px,78%)] flex-col',
                      own && 'items-end',
                    )}
                  >
                    {!grouped ? (
                      <div
                        className={cn(
                          'mb-1 flex items-baseline gap-2 px-1',
                          own && 'flex-row-reverse',
                        )}
                      >
                        <span className="text-label text-text">{name}</span>
                        <span className="text-meta text-text-subtle">
                          {formatTime(m.createdAt)}
                        </span>
                      </div>
                    ) : null}
                    {m.pinned && !m.deletedAt ? (
                      <span className="mb-1 flex items-center gap-1 px-1 text-meta text-accent">
                        <Pin className="size-3" aria-hidden />
                        Pinned by{' '}
                        {m.pinned.pinnedBy === me ? 'you' : nameOf(m.pinned.pinnedBy, directory)}
                      </span>
                    ) : null}
                    {m.replyToMessageId && m.replyToMessageId !== threadRootId ? (
                      <ReplyQuote
                        parent={(() => {
                          const p = byId.get(m.replyToMessageId);
                          return p
                            ? {
                                senderId: p.senderId,
                                text:
                                  p.content.text ||
                                  (p.attachments?.length
                                    ? `${p.attachments.length} attachment${p.attachments.length > 1 ? 's' : ''}`
                                    : ''),
                                deleted: !!p.deletedAt,
                              }
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
                          {...actions?.(m)}
                          onCreateTask={onCreateTask ? () => onCreateTask(m) : undefined}
                          onRequestApproval={
                            onRequestApproval ? () => onRequestApproval(m) : undefined
                          }
                          onTranslate={
                            onTranslate && m.content.text
                              ? () => translate(m.messageId!)
                              : undefined
                          }
                        />
                      ) : null}
                      {m.poll && !m.deletedAt && m.messageId ? (
                        <PollCard
                          message={m}
                          poll={m.poll}
                          me={me}
                          directory={directory}
                          own={own}
                          offline={offline}
                          canModerate={canModerate}
                        />
                      ) : m.deletedAt || m.content.text ? (
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
                      ) : null}
                      {m.messageId && translations.has(m.messageId) && !m.deletedAt ? (
                        <TranslationNote t={translations.get(m.messageId)!} own={own} />
                      ) : null}
                      {!m.deletedAt && m.attachments?.length ? (
                        <div
                          className={cn(
                            (m.status === 'queued' || m.status === 'sending') && 'opacity-80',
                          )}
                        >
                          <MessageAttachments attachments={m.attachments} own={own} />
                        </div>
                      ) : null}
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
                    {m.messageId && replyCounts?.get(m.messageId) && onOpenThread ? (
                      <button
                        onClick={() => onOpenThread(m)}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-sm px-1 text-meta font-medium text-accent hover:underline"
                      >
                        <MessagesSquare className="size-3.5" aria-hidden />
                        {replyCounts.get(m.messageId)}{' '}
                        {replyCounts.get(m.messageId) === 1 ? 'reply' : 'replies'}
                      </button>
                    ) : null}
                    {own ? (
                      <div className="mt-1 flex items-center gap-1.5 px-1 text-meta text-text-subtle">
                        {grouped ? (
                          <span className="opacity-0 transition-opacity group-hover:opacity-100">
                            {formatTime(m.createdAt)}
                          </span>
                        ) : null}
                        <MessageStatusIcon status={status!} />
                        {m.status === 'queued' ? (
                          <span className="text-warning">Queued</span>
                        ) : null}
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
              )}
            </React.Fragment>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function TranslationNote({
  t,
  own,
}: {
  t: { state: 'loading' | 'done' | 'error'; text?: string; label?: string };
  own: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mt-1 max-w-full rounded-lg border border-dashed border-border px-3 py-2 text-label font-normal',
        own ? 'ml-auto' : '',
        t.state === 'error' ? 'text-text-subtle' : 'text-text',
      )}
    >
      <span className="mb-0.5 flex items-center gap-1 text-meta text-text-subtle">
        <Languages className="size-3" />
        {t.state === 'loading'
          ? 'Translating…'
          : t.state === 'done'
            ? `Translated to ${t.label}`
            : 'Not translated'}
      </span>
      {t.state !== 'loading' ? <span className="whitespace-pre-wrap">{t.text}</span> : null}
    </motion.div>
  );
}
