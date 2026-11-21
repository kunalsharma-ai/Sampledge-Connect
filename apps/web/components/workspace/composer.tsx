'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AtSign,
  Bold,
  CornerUpLeft,
  Italic,
  Mic,
  MonitorUp,
  Paperclip,
  SendHorizontal,
  Smile,
  Video,
  X,
} from 'lucide-react';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  type Attachment,
} from '@sampledge/contracts';
import { Avatar, Kbd, Tooltip, cn } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import { rejectReason, uploadFile } from '@/lib/uploads';
import { canRecord, type ClipKind, type RecordedClip } from '@/lib/recorder';
import { DraftAttachments, type DraftAttachment } from './attachments';
import { RecordClipDialog } from './recordings';

const RECORD_TOOLS: { kind: ClipKind; icon: typeof Mic; label: string }[] = [
  { kind: 'voice', icon: Mic, label: 'Record a voice message' },
  { kind: 'video', icon: Video, label: 'Record a video message' },
  { kind: 'screen', icon: MonitorUp, label: 'Record your screen' },
];

const PLANNED_TOOLS = [
  { icon: Bold, label: 'Bold (rich text is planned)' },
  { icon: Italic, label: 'Italic (rich text is planned)' },
  { icon: Smile, label: 'Emoji picker (planned)' },
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
  conversationId,
  prefill,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  offline: boolean;
  onSend: (text: string, mentions: string[], attachments: Attachment[]) => Promise<void> | void;
  onTyping: (typing: boolean) => void;
  members?: MentionCandidate[];
  replyTo?: { name: string; text: string } | null;
  onCancelReply?: () => void;
  conversationId: string;
  /** Puts text in the box (e.g. an AI suggested reply). The person still presses send. */
  prefill?: { text: string; nonce: number } | null;
}) {
  const { getAccessToken } = useAuth();
  const [drafts, setDrafts] = React.useState<DraftAttachment[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const aborts = React.useRef(new Map<string, AbortController>());
  const patch = (key: string, p: Partial<DraftAttachment>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const start = React.useCallback(
    (d: DraftAttachment) => {
      const ac = new AbortController();
      aborts.current.set(d.key, ac);
      uploadFile(
        d.file,
        conversationId,
        getAccessToken,
        (f) => patch(d.key, { progress: f }),
        ac.signal,
        d.recording ? { recording: d.recording.kind, durationMs: d.recording.durationMs } : {},
      )
        .then((attachment) => patch(d.key, { state: 'ready', progress: 1, attachment }))
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          patch(d.key, {
            state: 'failed',
            error: e instanceof Error ? e.message : 'Upload failed',
          });
        })
        .finally(() => aborts.current.delete(d.key));
    },
    [conversationId, getAccessToken],
  );

  const addFiles = (files: Iterable<File>) => {
    const room = MAX_ATTACHMENTS_PER_MESSAGE - drafts.length;
    const next = [...files].slice(0, Math.max(0, room)).map((file): DraftAttachment => {
      const reason = rejectReason(file);
      return {
        key: crypto.randomUUID(),
        file,
        progress: 0,
        state: reason ? 'failed' : 'uploading',
        error: reason ?? undefined,
        previewUrl: /^image\//.test(file.type) ? URL.createObjectURL(file) : undefined,
      };
    });
    setDrafts((ds) => [...ds, ...next]);
    next.filter((d) => d.state === 'uploading').forEach(start);
  };

  const [recordKind, setRecordKind] = React.useState<ClipKind | null>(null);
  const [sendWhenReady, setSendWhenReady] = React.useState(false);
  const addRecording = (clip: RecordedClip, sendNow: boolean) => {
    if (drafts.length >= MAX_ATTACHMENTS_PER_MESSAGE) return;
    const d: DraftAttachment = {
      key: crypto.randomUUID(),
      file: clip.file,
      progress: 0,
      state: 'uploading',
      recording: { kind: clip.kind, durationMs: clip.durationMs },
    };
    setDrafts((ds) => [...ds, d]);
    start(d);
    if (sendNow) setSendWhenReady(true);
  };

  const removeDraft = (key: string) => {
    aborts.current.get(key)?.abort();
    setDrafts((ds) => {
      const d = ds.find((x) => x.key === key);
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      return ds.filter((x) => x.key !== key);
    });
  };

  const retryDraft = (key: string) => {
    const d = drafts.find((x) => x.key === key);
    if (!d) return;
    const fresh = { ...d, state: 'uploading' as const, progress: 0, error: undefined };
    patch(key, fresh);
    start(fresh);
  };

  // Drafts belong to one conversation: switching conversations discards them.
  React.useEffect(() => {
    const current = aborts.current;
    return () => {
      current.forEach((a) => a.abort());
      setDrafts((ds) => {
        ds.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl));
        return [];
      });
    };
  }, [conversationId]);

  const uploading = drafts.some((d) => d.state === 'uploading');
  const ready = drafts.filter((d) => d.state === 'ready' && d.attachment);

  const [text, setText] = React.useState('');
  const [mentioned, setMentioned] = React.useState<MentionCandidate[]>([]);
  const [query, setQuery] = React.useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prefill.text.length, prefill.text.length);
    });
  }, [prefill]);
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

  const canSend = (trimmed.length > 0 || ready.length > 0) && !tooLong && !uploading;
  const failed = drafts.some((d) => d.state === 'failed');

  // "Send" in the recorder: send as soon as the clip has uploaded.
  React.useEffect(() => {
    if (!sendWhenReady) return;
    if (failed) setSendWhenReady(false);
    else if (canSend) {
      setSendWhenReady(false);
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendWhenReady, canSend, failed]);

  const submit = async () => {
    if (!canSend || disabled) return;
    const files = ready.map((d) => d.attachment!);
    const ids = mentioned.filter((m) => trimmed.includes(`@${m.displayName}`)).map((m) => m.userId);
    setText('');
    setMentioned([]);
    setQuery(null);
    drafts.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl));
    setDrafts([]);
    stopTyping();
    await onSend(trimmed, ids, files);
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
      <div
        onDragOver={(e) => {
          if (offline || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          if (offline || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'relative rounded-xl border border-border bg-surface-raised shadow-md transition-[border-color,box-shadow] duration-[var(--sc-duration-fast)] focus-within:border-accent focus-within:shadow-lg',
          dragging && 'border-accent shadow-lg',
        )}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent-soft text-label text-accent">
            Drop files to attach
          </div>
        ) : null}
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
        <DraftAttachments drafts={drafts} onRemove={removeDraft} onRetry={retryDraft} />
        {recordKind ? (
          <RecordClipDialog
            key={recordKind}
            kind={recordKind}
            open
            onOpenChange={(o) => !o && setRecordKind(null)}
            onDone={addRecording}
          />
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
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
          onPaste={(e) => {
            if (offline || e.clipboardData.files.length === 0) return;
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }}
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
            <Tooltip
              content={
                offline
                  ? 'Attaching files needs a connection'
                  : drafts.length >= MAX_ATTACHMENTS_PER_MESSAGE
                    ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`
                    : 'Attach files (up to 100 MB each)'
              }
              side="top"
            >
              <span>
                <button
                  type="button"
                  aria-label="Attach files"
                  disabled={offline || drafts.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                  onClick={() => fileInput.current?.click()}
                  className="flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-text disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <Paperclip className="size-4" />
                </button>
              </span>
            </Tooltip>
            {RECORD_TOOLS.map((t) => {
              const unavailable = offline
                ? 'Recording needs a connection'
                : drafts.length >= MAX_ATTACHMENTS_PER_MESSAGE
                  ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`
                  : null;
              return (
                <Tooltip key={t.kind} content={unavailable ?? t.label} side="top">
                  <span>
                    <button
                      type="button"
                      aria-label={t.label}
                      disabled={!!unavailable}
                      onClick={() => setRecordKind(t.kind)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-text disabled:opacity-40 disabled:hover:bg-transparent',
                        t.kind !== 'voice' && 'hidden sm:flex',
                        t.kind === 'screen' &&
                          typeof window !== 'undefined' &&
                          !canRecord('screen') &&
                          '!hidden',
                      )}
                    >
                      <t.icon className="size-4" />
                    </button>
                  </span>
                </Tooltip>
              );
            })}
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
              ) : uploading ? (
                'Uploading…'
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
              disabled={!canSend}
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
