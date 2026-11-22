'use client';
import * as React from 'react';
import { FileDown } from 'lucide-react';
import {
  CHAT_EXPORT_POLICY_LABEL,
  type ChatExportAccess,
  type ChatExportFormat,
  type Conversation,
} from '@sampledge/contracts';

import { Button, Dialog, DialogContent, Input, Tooltip, cn, useToast } from '@sampledge/ui';
import { minutesErrorText, useMinutesApi } from '@/lib/minutes';

const FORMATS: { id: ChatExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Branded, ready to print or send' },
  { id: 'docx', label: 'Word', hint: 'Edit or annotate in Word' },
  { id: 'txt', label: 'Text', hint: 'Plain text, for archives and search' },
];

/** Start of a local day (from) or its end (to), as ISO. */
const dayIso = (d: string, end: boolean) =>
  d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined;

/** Header button and dialog: download this conversation as PDF, Word or text. */
export function ChatExportButton({
  conversation,
  title,
  offline,
}: {
  conversation: Conversation;
  title: string;
  offline: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Tooltip content={offline ? 'Export needs a connection' : 'Export chat'} side="bottom">
        <span>
          <button
            className="rounded-sm p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-40"
            aria-label="Export chat"
            disabled={offline}
            onClick={() => setOpen(true)}
          >
            <FileDown className="size-4" />
          </button>
        </span>
      </Tooltip>
      {open ? (
        <ChatExportDialog
          open={open}
          onOpenChange={setOpen}
          conversationId={conversation.conversationId}
          title={title}
        />
      ) : null}
    </>
  );
}

export function ChatExportDialog({
  open,
  onOpenChange,
  conversationId,
  title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  title: string;
}) {
  const api = useMinutesApi();
  const { toast } = useToast();
  const [access, setAccess] = React.useState<ChatExportAccess | null>(null);
  const [format, setFormat] = React.useState<ChatExportFormat>('pdf');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [includeSystem, setIncludeSystem] = React.useState(true);
  const [includeTranscripts, setIncludeTranscripts] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!api.online) return;
    void api.exportAccess(conversationId).then(setAccess, () =>
      setAccess({
        allowed: false,
        policy: 'members',
        reason: 'Could not check export permission.',
      }),
    );
  }, [api, conversationId]);

  const badRange = !!from && !!to && from > to;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Export chat"
        description={`Download the messages in ${title}. The export is recorded in the audit log.`}
        className="max-w-lg"
      >
        {access && !access.allowed ? (
          <p
            className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-text-muted"
            role="status"
          >
            {access.reason ?? 'You can’t export this conversation.'}
            <span className="mt-1 block text-meta text-text-subtle">
              Who can export: {CHAT_EXPORT_POLICY_LABEL[access.policy]}.
            </span>
          </p>
        ) : (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="File type" className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={format === f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    format === f.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-border hover:border-border-strong',
                  )}
                >
                  <span className="block text-label text-text">{f.label}</span>
                  <span className="block text-[11px] leading-snug text-text-subtle">{f.hint}</span>
                </button>
              ))}
            </div>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1 text-meta text-text-muted">
                Dates (leave empty for everything)
              </legend>
              <label className="text-meta text-text-subtle">
                From
                <Input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="text-meta text-text-subtle">
                To
                <Input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </fieldset>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-meta text-text-muted">
                <input
                  type="checkbox"
                  checked={includeSystem}
                  onChange={(e) => setIncludeSystem(e.target.checked)}
                  className="size-4 accent-[var(--sc-accent)]"
                />
                Include calls, recordings and other events
              </label>
              <label className="flex items-center gap-2 text-meta text-text-muted">
                <input
                  type="checkbox"
                  checked={includeTranscripts}
                  onChange={(e) => setIncludeTranscripts(e.target.checked)}
                  className="size-4 accent-[var(--sc-accent)]"
                />
                Add recording and voice message transcripts
              </label>
            </div>
            {badRange ? (
              <p className="text-meta text-danger">The start date must be before the end date.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={!api.online || !access || badRange}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const name = await api.exportChat(
                      conversationId,
                      {
                        format,
                        from: dayIso(from, false),
                        to: dayIso(to, true),
                        includeSystem,
                        includeTranscripts,
                      },
                      title,
                    );
                    toast({ title: 'Chat exported', description: name, tone: 'success' });
                    onOpenChange(false);
                  } catch (e) {
                    toast({
                      title: 'Export failed',
                      description: minutesErrorText(e),
                      tone: 'danger',
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FileDown /> Download {FORMATS.find((f) => f.id === format)!.label}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
