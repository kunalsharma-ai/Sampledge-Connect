'use client';
import * as React from 'react';
import { AtSign, Bold, Italic, Mic, Paperclip, SendHorizontal, Smile } from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '@sampledge/contracts';
import { Kbd, Tooltip, cn } from '@sampledge/ui';

const PLANNED_TOOLS = [
  { icon: Bold, label: 'Bold (rich text is planned)' },
  { icon: Italic, label: 'Italic (rich text is planned)' },
  { icon: AtSign, label: 'Mention (planned)' },
  { icon: Smile, label: 'Emoji picker (planned)' },
  { icon: Paperclip, label: 'Attach files (planned, Nextcloud)' },
  { icon: Mic, label: 'Voice message (planned)' },
];

/**
 * Composer. Enter sends, Shift+Enter adds a line. Sending writes to IndexedDB first,
 * so it works the same online and offline; the button never waits on the network.
 */
export function Composer({
  placeholder,
  disabled,
  disabledReason,
  offline,
  onSend,
  onTyping,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  offline: boolean;
  onSend: (text: string) => Promise<void> | void;
  onTyping: (typing: boolean) => void;
}) {
  const [text, setText] = React.useState('');
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingOn = React.useRef(false);
  const trimmed = text.trim();
  const tooLong = text.length > MAX_MESSAGE_LENGTH;

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingOn.current) onTyping(false);
    typingOn.current = false;
  };

  const submit = async () => {
    if (!trimmed || tooLong || disabled) return;
    setText('');
    stopTyping();
    await onSend(trimmed);
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
    <div className="px-4 pb-4 sm:px-6">
      <div className="rounded-xl border border-border bg-surface-raised shadow-md transition-[border-color,box-shadow] duration-[var(--sc-duration-fast)] focus-within:border-accent focus-within:shadow-lg">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label="Message"
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (!typingOn.current) {
              typingOn.current = true;
              onTyping(true);
            }
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(stopTyping, 3000);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 text-message text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
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
