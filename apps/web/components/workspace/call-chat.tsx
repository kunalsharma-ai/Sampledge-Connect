'use client';
import * as React from 'react';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { guestSenderName } from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { cn } from '@sampledge/ui';
import { useEngine, useMessages, type DirectoryEntry } from '@/lib/engine';
import { formatTime, nameOf } from './helpers';

export interface ChatLine {
  id: string;
  name: string;
  guest: boolean;
  mine: boolean;
  text: string;
  files: string[];
  at: string;
  pending?: boolean;
}

/**
 * The chat list and box shared by the members' call stage and the guest call view. Dark,
 * compact, newest at the bottom; sticks to the bottom unless the reader scrolled up.
 */
export function CallChatView({
  lines,
  onSend,
  onClose,
  disabledReason,
  note,
}: {
  lines: ChatLine[];
  onSend: (text: string) => Promise<void> | void;
  onClose: () => void;
  disabledReason?: string | null;
  note?: string;
}) {
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  React.useEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText('');
      atBottom.current = true;
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b1220]/90 backdrop-blur sm:w-80"
      aria-label="Meeting chat"
      data-testid="call-chat"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <p className="text-label">Meeting chat</p>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-md p-1 text-white/70 hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </header>
      {note ? <p className="px-3 pt-2 text-meta text-white/50">{note}</p> : null}
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <p className="m-auto max-w-56 text-center text-meta text-white/50">
            Messages sent here are seen by everyone in the meeting.
          </p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={cn('flex flex-col', l.mine && 'items-end')}>
              <p className="mb-0.5 flex items-center gap-1.5 text-meta text-white/55">
                <span className="font-medium text-white/80">{l.mine ? 'You' : l.name}</span>
                {l.guest ? (
                  <span className="rounded-sm border border-white/20 px-1 text-[10px] uppercase tracking-wide">
                    Guest
                  </span>
                ) : null}
                <span>{formatTime(l.at)}</span>
              </p>
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-label font-normal',
                  l.mine ? 'bg-accent text-accent-fg' : 'bg-white/10 text-white',
                  l.pending && 'opacity-60',
                )}
              >
                {l.text}
                {l.files.map((f) => (
                  <span key={f} className="mt-1 flex items-center gap-1 text-meta opacity-80">
                    <Paperclip className="size-3" /> {f}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-white/10 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={4000}
          disabled={!!disabledReason}
          placeholder={disabledReason ?? 'Message everyone'}
          aria-label="Message everyone in the meeting"
          className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-white/15 bg-white/5 px-2.5 py-2 text-label font-normal text-white placeholder:text-white/40 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending || !!disabledReason}
          aria-label="Send"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg disabled:opacity-40"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </aside>
  );
}

/** Text lines (no system cards) of a conversation since `since`, for the call chat. */
export function toChatLines(
  messages: LocalMessage[] | undefined,
  since: string,
  me: string,
  directory: Map<string, DirectoryEntry>,
): ChatLine[] {
  const from = Date.parse(since);
  return (messages ?? [])
    .filter(
      (m) =>
        m.messageType === 'text' &&
        !m.deletedAt &&
        Date.parse(m.createdAt ?? new Date(m.localCreatedAt).toISOString()) >= from,
    )
    .map((m) => {
      const guest = guestSenderName(m);
      return {
        id: m.clientMessageId,
        name: guest ?? nameOf(m.senderId, directory),
        guest: !!guest,
        mine: m.senderId === me,
        text: m.content.text,
        files: (m.attachments ?? []).map((a) => a.fileName),
        at: m.createdAt ?? new Date(m.localCreatedAt).toISOString(),
        pending: m.status !== 'sent' && m.status !== 'delivered' && m.status !== 'read',
      };
    });
}

/** The members' side: reads the meeting chat from this device's store and sends through the outbox. */
export function MemberCallChat({
  conversationId,
  since,
  me,
  directory,
  onClose,
}: {
  conversationId: string;
  since: string;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onClose: () => void;
}) {
  const { engine } = useEngine();
  const messages = useMessages(conversationId);
  const lines = toChatLines(messages, since, me, directory);
  return (
    <CallChatView
      lines={lines}
      onClose={onClose}
      note="Shows messages since this call started. The full history is in the conversation."
      onSend={async (t) => {
        await engine.compose(conversationId, t, { mentions: [] });
      }}
    />
  );
}

/** Count of text messages from others since `since` (for the unread dot on the chat button). */
export function useCallChatCount(conversationId: string | null, since: string, me: string): number {
  const messages = useMessages(conversationId);
  const from = Date.parse(since);
  return (messages ?? []).filter(
    (m) =>
      m.messageType === 'text' &&
      m.senderId !== me &&
      !m.deletedAt &&
      Date.parse(m.createdAt ?? '1970-01-01') >= from,
  ).length;
}
