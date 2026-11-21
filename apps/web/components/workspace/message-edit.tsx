'use client';
import * as React from 'react';
import type { LocalMessage } from '@sampledge/offline';
import { Button, Dialog, DialogContent, Field, Textarea } from '@sampledge/ui';

/**
 * Edit one of your own messages. The change is queued on this device, shows straight away
 * (also offline), and reaches everyone's devices when the server confirms it.
 */
export function EditMessageDialog({
  message,
  onOpenChange,
  onSave,
}: {
  message: LocalMessage | null;
  onOpenChange: (o: boolean) => void;
  onSave: (m: LocalMessage, text: string) => void;
}) {
  const [text, setText] = React.useState('');
  React.useEffect(() => setText(message?.content.text ?? ''), [message]);
  const changed = !!message && text.trim().length > 0 && text !== message.content.text;
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit message"
        description="Everyone in the conversation sees the new text, marked as edited."
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
          <Field label="Message" htmlFor="edit-message-text">
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
