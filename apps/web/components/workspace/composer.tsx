'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AtSign,
  Bold,
  CornerUpLeft,
  Italic,
  Mic,
  Paperclip,
  SendHorizontal,
  Smile,
  X,
} from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '@sampledge/contracts';
import { Avatar, Kbd, Tooltip, cn } from '@sampledge/ui';

const PLANNED_TOOLS = [
  { icon: Bold, label: 'Bold (rich text is planned)' },
  { icon: Italic, label: 'Italic (rich text is planned)' },
  { icon: Smile, label: 'Emoji picker (planned)' },
  { icon: Paperclip, label: 'Attach files (planned, Nextcloud)' },
  { icon: Mic, label: 'Voice message (planned)' },
];

export interface MentionCandidate {
  userId: string;
  displayName: string;
  subtitle?: string;
}

/** The `@query` immediately before the caret, if any. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/**
 * Composer. Enter sends, Shift+Enter adds a line, @ mentions a member.
 * Sending writes to IndexedDB first, so it works the same online and offline.
 */
export function Composer({
  placeholder,
  disabled,
  disabledReason,
  offline,
  onSend,
  onTyping,
  members = [],
  replyTo,
  onCancelReply,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  offline: boolean;
  onSend: (text: string, mentions: string[]) => Promise<void> | void;
  onTyping: (typing: boolean) => void;
  members?: MentionCandidate[];
  replyTo?: { name: string; text: string } | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = React.useState('');
  const [mentioned, setMentioned] = React.useState<MentionCandidate[]>([]);
  const [query, setQuery] = React.useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingOn = React.useRef(false);
  const trimmed = text.trim();
  const tooLong = text.length > MAX_MESSAGE_LENGTH;

  const candidates = query
    ? members
        .filter((m) => m.displayName.toLowerCase().includes(query.query.toLowerCase()))
        .sort(
          (a, b) =>
            Number(!a.displayName.toLowerCase().startsWith(query.query.toLowerCase())) -
            Number(!b.displayName.toLowerCase().startsWith(query.query.toLowerCase())),
        )
        .slice(0, 6)
    : [];

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  React.useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingOn.current) onTyping(false);
    typingOn.current = false;
  };

  const pick = (c: MentionCandidate) => {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? text.length;
    const insert = `@${c.displayName} `;
    const next = text.slice(0, query.start) + insert + text.slice(caret);
    setText(next);
    setMentioned((m) => (m.some((x) => x.userId === c.userId) ? m : [...m, c]));
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + insert.length;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  };

  const submit = async () => {
    if (!trimmed || tooLong || disabled) return;
    const ids = mentioned.filter((m) => trimmed.includes(`@${m.displayName}`)).map((m) => m.userId);
    setText('');
    setMentioned([]);
    setQuery(null);
    stopTyping();
    await onSend(trimmed, ids);
    ref.current?.focus();
  };

  if (disabled) {
    return (
      <div className="border-t border-border px-4 py-4 text-center text-label font-normal text-text-subtle sm:px-6">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-4 sm:px-6">
      <AnimatePresence>
        {candidates.length > 0 ? (
          <motion.ul
            role="listbox"
            aria-label="Mention a member"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-4 z-20 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg sm:left-6"
          >
            {candidates.map((c, i) => (
              <li key={c.userId} role="option" aria-selected={i === active}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                    i === active ? 'bg-accent-soft' : '',
                  )}
                >
                  <Avatar name={c.displayName} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-text">{c.displayName}</span>
                    {c.subtitle ? (
                      <span className="block truncate text-meta text-text-subtle">
                        {c.subtitle}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
      <div className="rounded-xl border border-border bg-surface-raised shadow-md transition-[border-color,box-shadow] duration-[var(--sc-duration-fast)] focus-within:border-accent focus-within:shadow-lg">
        {replyTo ? (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-meta">
            <CornerUpLeft className="size-3.5 shrink-0 text-accent" />
            <span className="shrink-0 text-text-muted">
              Replying to <span className="font-semibold text-text">{replyTo.name}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-text-subtle">{replyTo.text}</span>
            <button
              onClick={onCancelReply}
              aria-label="Cancel reply"
              className="rounded-sm p-1 text-text-subtle hover:bg-surface hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label="Message"
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            const q = mentionQuery(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length,
            );
            setQuery(q);
            setActive(0);
            if (!typingOn.current) {
              typingOn.current = true;
              onTyping(true);
            }
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(stopTyping, 3000);
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={(e) => {
            if (candidates.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const d = e.key === 'ArrowDown' ? 1 : -1;
                setActive((a) => (a + d + candidates.length) % candidates.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(candidates[active] ?? candidates[0]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setQuery(null);
                return;
              }
            }
            if (e.key === 'Escape' && replyTo) {
              e.preventDefault();
              onCancelReply?.();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 text-message text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            <Tooltip content="Mention someone" side="top">
              <button
                type="button"
                aria-label="Mention someone"
                onClick={() => {
                  const el = ref.current;
                  if (!el) return;
                  const caret = el.selectionStart ?? text.length;
                  const prefix = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? ' @' : '@';
                  const next = text.slice(0, caret) + prefix + text.slice(caret);
                  setText(next);
                  setQuery({ start: caret + prefix.length - 1, query: '' });
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(caret + prefix.length, caret + prefix.length);
                  });
                }}
                className="flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-text"
              >
                <AtSign className="size-4" />
              </button>
            </Tooltip>
            {PLANNED_TOOLS.map((t) => (
              <Tooltip key={t.label} content={t.label} side="top">
                <span>
                  <button
                    type="button"
                    disabled
                    aria-label={t.label}
                    className="flex size-8 items-center justify-center rounded-sm text-text-subtle opacity-50"
                  >
                    <t.icon className="size-4" />
                  </button>
                </span>
              </Tooltip>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={cn(
                'hidden whitespace-nowrap text-meta xl:inline',
                tooLong ? 'text-danger' : offline ? 'text-warning' : 'text-text-subtle',
              )}
            >
              {tooLong ? (
                `${text.length}/${MAX_MESSAGE_LENGTH}`
              ) : offline ? (
                'Offline · sends on reconnect'
              ) : (
                <>
                  <Kbd>Enter</Kbd> to send
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!trimmed || tooLong}
              aria-label={offline ? 'Queue message' : 'Send message'}
              className="flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-label text-accent-fg shadow-sm transition-[transform,opacity,background-color] duration-[var(--sc-duration-fast)] hover:-translate-y-px hover:bg-accent-hover disabled:translate-y-0 disabled:opacity-40"
            >
              <SendHorizontal className="size-4" />
              <span className="hidden sm:inline">{offline ? 'Queue' : 'Send'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
