'use client';
import * as React from 'react';
import { AlertTriangle, Bot, Check, ShieldCheck } from 'lucide-react';
import type { ActionItem, AiEngine, AiProposal, AiRiskCategory } from '@sampledge/contracts';
import { Avatar, Badge, Button, Dialog, DialogContent, cn, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { ENGINE_LABEL, aiErrorText, type AiApi } from '@/lib/ai';
import { ApiFailure } from '@/lib/api';
import { nameOf } from './helpers';

export const RISK_LABEL: Record<AiRiskCategory, string> = {
  financial: 'money or pricing',
  hr: 'people or HR matters',
  client_facing: 'people outside your organization',
  destructive: 'deleting or cancelling something',
};

export function EngineBadge({ engine, className }: { engine: AiEngine; className?: string }) {
  return (
    <Badge
      tone={engine === 'model' ? 'accent2' : engine === 'off' ? 'warning' : 'neutral'}
      className={cn('gap-1 px-1.5 text-[10px]', className)}
    >
      <Bot className="size-3" /> {ENGINE_LABEL[engine]}
    </Badge>
  );
}

export function ActionItemRow({
  item,
  directory,
  me,
}: {
  item: ActionItem;
  directory: Map<string, DirectoryEntry>;
  me: string;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border-strong" />
      <span className="min-w-0 flex-1">
        <span className="block text-label font-normal text-text">{item.text}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-text-subtle">
          {item.assigneeId ? (
            <span className="inline-flex items-center gap-1">
              <Avatar name={nameOf(item.assigneeId, directory)} size="xs" />
              {item.assigneeId === me ? 'You' : nameOf(item.assigneeId, directory).split(' ')[0]}
            </span>
          ) : (
            <span>Unassigned</span>
          )}
          {item.due ? (
            <Badge tone="warning" className="px-1.5 text-[10px]">
              {item.due}
            </Badge>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/**
 * The one place AI output can become a message: the person reads (and may edit) the draft
 * and confirms. Drafts about money, HR, outside people or deleting things need a tick too.
 */
export function ConfirmDraftDialog({
  ai,
  proposal,
  onOpenChange,
  where,
}: {
  ai: AiApi;
  proposal: AiProposal | null;
  onOpenChange: (open: boolean) => void;
  where: string;
}) {
  const { toast } = useToast();
  const [text, setText] = React.useState('');
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Set when an edit turned the draft sensitive (the server says so on confirm). */
  const [edited, setEdited] = React.useState<AiRiskCategory[] | null>(null);
  React.useEffect(() => {
    setText(proposal?.text ?? '');
    setAck(false);
    setError(null);
    setEdited(null);
  }, [proposal]);
  const categories = edited ?? proposal?.risk.categories ?? [];
  const sensitive = categories.length > 0;

  const close = (sent: boolean) => {
    if (!sent && proposal) void ai.dismiss(proposal.proposalId).catch(() => undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={!!proposal} onOpenChange={(o) => !o && close(false)}>
      <DialogContent
        title="Review before sending"
        description={`This goes to ${where} as a message from you. Nothing is sent until you confirm.`}
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        {proposal ? (
          <div className="space-y-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              aria-label="Draft"
              className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-label font-normal text-text outline-none focus:border-accent"
            />
            {sensitive ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-center gap-2 text-label text-warning">
                  <AlertTriangle className="size-4" /> This draft mentions{' '}
                  {categories.map((c) => RISK_LABEL[c]).join(', ')}.
                </p>
                <label className="mt-2 flex items-start gap-2 text-meta text-text">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    className="mt-0.5 accent-[var(--sc-accent)]"
                  />
                  I checked this draft and want to send it myself.
                </label>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-meta text-text-subtle">
                <ShieldCheck className="size-4" /> The assistant never sends, deletes or approves
                anything on its own.
              </p>
            )}
            {error ? <p className="text-meta text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={!text.trim() || (sensitive && !ack) || !ai.online}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await ai.confirm(proposal.proposalId, {
                      confirm: true,
                      acknowledgeRisk: ack,
                      text: text.trim() === proposal.text ? undefined : text.trim(),
                    });
                    toast({ title: 'Sent', description: `Posted to ${where}.`, tone: 'success' });
                    close(true);
                  } catch (e) {
                    const details =
                      e instanceof ApiFailure
                        ? (e.error.details as { reason?: string; categories?: AiRiskCategory[] })
                        : undefined;
                    if (details?.reason === 'RISK_ACK_REQUIRED') {
                      setEdited(details.categories ?? []);
                      setAck(false);
                      setError('Your edit touches a sensitive topic. Tick the box to confirm.');
                    } else setError(aiErrorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Check /> Send message
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
