'use client';
import * as React from 'react';
import type { LocalMessage } from '@sampledge/offline';
import {
  editMinutesLeft,
  editWindowLabel,
  type MessageEditHistory,
  type MessageEditingPolicy,
} from '@sampledge/contracts';
import { Badge, Button, Dialog, DialogContent, Field, StateView, Textarea } from '@sampledge/ui';
import { ApiFailure } from '@/lib/api';

/**
 * Edit one of your own messages. The change is queued on this device, shows straight away
 * (also offline), and reaches everyone's devices when the server confirms it.
 */
export function EditMessageDialog({
  message,
  policy,
  onOpenChange,
  onSave,
}: {
  message: LocalMessage | null;
  /** The organization's editing rules, to say how long is left. */
  policy?: MessageEditingPolicy;
  onOpenChange: (o: boolean) => void;
  onSave: (m: LocalMessage, text: string) => void;
}) {
  const [text, setText] = React.useState('');
  React.useEffect(() => setText(message?.content.text ?? ''), [message]);
  const changed = !!message && text.trim().length > 0 && text !== message.content.text;
  // A file sent without words: editing adds a caption to it.
  const caption = !!message && !message.content.text && !!message.attachments?.length;
  const left = message && policy ? editMinutesLeft(message.createdAt, policy) : null;
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent
        title={caption ? 'Add a caption' : 'Edit message'}
        description={
          caption
            ? 'Everyone in the conversation sees the caption under the file, marked as edited.'
            : 'Everyone in the conversation sees the new text, marked as edited. Earlier versions stay in the edit history.'
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!message || !changed) return;
            onSave(message, text.trim());
            onOpenChange(false);
          }}
        >
          {left != null && policy ? (
            <p className="text-meta text-text-muted" data-testid="edit-window">
              Your organization allows edits for {editWindowLabel(policy.editWindowMinutes)} after
              sending: {left <= 1 ? 'less than a minute' : editWindowLabel(left)} left.
            </p>
          ) : null}
          <Field label={caption ? 'Caption' : 'Message'} htmlFor="edit-message-text">
            <Textarea
              id="edit-message-text"
              value={text}
              rows={4}
              maxLength={10_000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!changed}>
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Earlier versions of an edited message, newest first. */
export function EditHistoryDialog({
  messageId,
  load,
  onOpenChange,
}: {
  messageId: string | null;
  load: (messageId: string) => Promise<MessageEditHistory>;
  onOpenChange: (o: boolean) => void;
}) {
  const [hist, setHist] = React.useState<MessageEditHistory | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setHist(null);
    setError(null);
    if (!messageId) return;
    let live = true;
    load(messageId).then(
      (h) => live && setHist(h),
      (e: unknown) =>
        live &&
        setError(
          e instanceof ApiFailure
            ? e.error.message
            : navigator.onLine
              ? (e as Error).message
              : 'Edit history is available when you’re online.',
        ),
    );
    return () => {
      live = false;
    };
  }, [messageId, load]);
  return (
    <Dialog open={!!messageId} onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit history"
        description="Every version of this message, newest first. Only the latest is shown in the conversation."
      >
        {error ? (
          <StateView state="error" title="Can’t show the history" description={error} />
        ) : !hist ? (
          <p className="text-meta text-text-subtle">Loading…</p>
        ) : (
          <ol className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" data-testid="edit-history">
            {[...hist.versions].reverse().map((v) => (
              <li
                key={v.version}
                className="rounded-lg border border-border bg-surface-sunken px-3 py-2"
              >
                <div className="mb-1 flex items-center gap-2 text-meta text-text-subtle">
                  {v.current ? <Badge tone="accent">Current</Badge> : null}
                  <span>{v.version === 1 ? 'Sent' : `Edit ${v.version - 1}`}</span>
                  <span>·</span>
                  <span>{when(v.at)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-label font-normal text-text">
                  {v.text || <span className="italic text-text-subtle">No text</span>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeleteMessageDialog({
  message,
  onOpenChange,
  onConfirm,
}: {
  message: LocalMessage | null;
  onOpenChange: (o: boolean) => void;
  onConfirm: (m: LocalMessage) => void;
}) {
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent
        title="Delete message?"
        description="It is removed for everyone in the conversation, on every device."
      >
        {message?.content.text ? (
          <p className="line-clamp-3 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-label font-normal text-text">
            {message.content.text}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (message) onConfirm(message);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
