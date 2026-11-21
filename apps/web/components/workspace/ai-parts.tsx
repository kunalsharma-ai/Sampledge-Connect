'use client';
import * as React from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ListPlus,
  ShieldCheck,
  Undo2,
  X,
} from 'lucide-react';
import {
  classifyActionRisk,
  type ActionItem,
  type AiEngine,
  type AiProposal,
  type AiRiskCategory,
} from '@sampledge/contracts';
import { Avatar, Badge, Button, Dialog, DialogContent, cn, useToast } from '@sampledge/ui';
import { useEngine, useEngineChange, type DirectoryEntry } from '@/lib/engine';
import { AiTaskContext, ENGINE_LABEL, aiErrorText, type AiApi } from '@/lib/ai';
import { ApiFailure } from '@/lib/api';
import { avatarOf, nameOf } from './helpers';
import { useConversationWork } from './work-cards';

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
  conversationId,
}: {
  item: ActionItem;
  directory: Map<string, DirectoryEntry>;
  me: string;
  /** Where the suggestion came from; enables "Create task". */
  conversationId?: string;
}) {
  const tasks = React.useContext(AiTaskContext);
  const work = useConversationWork();
  // Created here, or a task already exists from the same message (e.g. after a reload).
  const created = !!(
    tasks &&
    conversationId &&
    (tasks.isCreated(item, conversationId) ||
      (item.messageId &&
        work?.conversationId === conversationId &&
        work.tasks?.some((t) => t.sourceMessageId === item.messageId)))
  );
  const dismissed =
    !created && !!(tasks && conversationId && tasks.isDismissed(item, conversationId));
  if (dismissed)
    return (
      <li
        className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-meta text-text-subtle"
        data-testid="suggestion-dismissed"
      >
        <span className="min-w-0 flex-1 truncate line-through">{item.text}</span>
        <span>Not needed</span>
        <button
          type="button"
          onClick={() => tasks!.setDismissed(item, conversationId!, false)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Undo2 className="size-3" /> Undo
        </button>
      </li>
    );
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border-strong" />
      <span className="min-w-0 flex-1">
        <span className="block text-label font-normal text-text">{item.text}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-text-subtle">
          {item.assigneeId ? (
            <span className="inline-flex items-center gap-1">
              <Avatar
                name={nameOf(item.assigneeId, directory)}
                src={avatarOf(item.assigneeId, directory)}
                size="xs"
              />
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
          {tasks && conversationId ? (
            created ? (
              <span className="ml-auto inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3" /> Task created
              </span>
            ) : (
              <button
                type="button"
                onClick={() => tasks.createTask(item, conversationId)}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ListPlus className="size-3" /> Create task
              </button>
            )
          ) : null}
          {tasks && conversationId && !created ? (
            <button
              type="button"
              aria-label="Not needed"
              title="Not needed (hides it on all your devices)"
              onClick={() => tasks.setDismissed(item, conversationId, true)}
              className="inline-flex items-center rounded-md p-0.5 text-text-subtle hover:bg-surface-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-3.5" />
            </button>
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

  const { engine } = useEngine();
  // Sent or dismissed on another of my devices: close here too.
  useEngineChange(['aiProposal'], (e) => {
    if (e.type !== 'aiProposal' || !proposal) return;
    if (e.proposal.proposalId !== proposal.proposalId || e.proposal.status === 'pending') return;
    toast({
      title: e.proposal.status === 'confirmed' ? 'Sent from another device' : 'Draft closed',
      description:
        e.proposal.status === 'confirmed'
          ? `This draft was already posted to ${where}.`
          : 'You dismissed this draft on another device.',
    });
    onOpenChange(false);
  });

  // Dismissing goes through the action queue, so it reaches the server (and my other devices)
  // even when closed offline.
  const close = (sent: boolean) => {
    if (!sent && proposal)
      void engine.queueAction({
        key: `aiproposal|${proposal.proposalId}`,
        method: 'POST',
        path: `/v1/ai/proposals/${proposal.proposalId}/dismiss`,
        label: 'Dismiss AI draft',
        conversationId: proposal.conversationId,
      });
    onOpenChange(false);
  };
  /** Offline: check the edited text here, the same way the server will. */
  const localCategories = (t: string): AiRiskCategory[] => {
    const external = proposal?.risk.categories.includes('client_facing') ?? false;
    return classifyActionRisk(t, { externalAudience: external }).categories;
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
                disabled={!text.trim() || (sensitive && !ack)}
                onClick={async () => {
                  const edit = text.trim() === proposal.text ? undefined : text.trim();
                  if (!ai.online) {
                    // Queue the confirmation; it sends when the device reconnects. A change
                    // the server refuses shows up in the Sync Center.
                    const cats = edit ? localCategories(edit) : categories;
                    if (cats.length && !ack) {
                      setEdited(cats);
                      setError('Your edit touches a sensitive topic. Tick the box to confirm.');
                      return;
                    }
                    await engine.queueAction({
                      key: `aiproposal|${proposal.proposalId}`,
                      method: 'POST',
                      path: `/v1/ai/proposals/${proposal.proposalId}/confirm`,
                      body: { confirm: true, acknowledgeRisk: ack, text: edit },
                      label: 'Send AI draft',
                      conversationId: proposal.conversationId,
                    });
                    toast({
                      title: 'Will send when you’re back online',
                      description: `Queued for ${where}. See the Sync Center for its progress.`,
                    });
                    onOpenChange(false);
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  try {
                    await ai.confirm(proposal.proposalId, {
                      confirm: true,
                      acknowledgeRisk: ack,
                      text: edit,
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
