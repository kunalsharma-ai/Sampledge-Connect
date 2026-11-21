'use client';
import * as React from 'react';
import {
  APPROVAL_CATEGORIES,
  TASK_KINDS,
  TASK_PRIORITIES,
  type Approval,
  type Conversation,
  type Project,
  type Task,
} from '@sampledge/contracts';
import { Button, Dialog, DialogContent, Field, Input, Textarea, cn, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { useWorkApi } from '@/lib/work';
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  PRIORITY_LABEL,
  PeoplePicker,
  dateToIso,
  selectClass,
} from './work-ui';

/** The message a task or approval is being made from ("chat-to-task"). */
export interface WorkSource {
  conversation: Conversation;
  messageId?: string | null;
  text?: string;
}

function candidatesFor(conv: Conversation | null, directory: Map<string, DirectoryEntry>) {
  // Public channels: anyone can be assigned (they can read it). Otherwise members only.
  if (!conv || conv.kind === 'channel_public') return [...directory.keys()];
  return conv.memberIds;
}

function firstLine(text = '') {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  source,
  me,
  directory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: WorkSource | null;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onCreated?: (t: Task) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [kind, setKind] = React.useState<Task['kind']>('task');
  const [priority, setPriority] = React.useState<Task['priority']>('normal');
  const [due, setDue] = React.useState('');
  const [assignees, setAssignees] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const requestId = React.useRef<string>('');

  React.useEffect(() => {
    if (!open) return;
    setTitle(firstLine(source?.text));
    setDescription('');
    setKind('task');
    setPriority('normal');
    setDue('');
    setAssignees([me]);
    setError(null);
    requestId.current = crypto.randomUUID();
  }, [open, source, me]);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const t = await api.createTask({
        title: title.trim(),
        description: description.trim(),
        kind,
        priority,
        assigneeIds: assignees,
        dueAt: dateToIso(due),
        conversationId: source?.conversation.conversationId ?? null,
        sourceMessageId: source?.messageId ?? null,
        clientRequestId: requestId.current,
      });
      toast({
        title: 'Task created',
        description: t.record
          ? `Linked to ${t.record.title}.`
          : source
            ? 'A card was posted in the conversation.'
            : undefined,
        tone: 'success',
      });
      onCreated?.(t);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={source?.messageId ? 'Create task from message' : 'New task'}
        description={
          source
            ? 'The task is posted in this conversation, and anyone assigned is notified.'
            : 'A task that isn’t tied to a conversation.'
        }
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="-mx-1 grid max-h-[min(58dvh,560px)] gap-3 overflow-y-auto px-1 pb-1">
            {source?.text ? (
              <blockquote className="line-clamp-3 rounded-md border-l-2 border-accent bg-surface-raised px-3 py-2 text-meta text-text-muted">
                {source.text}
              </blockquote>
            ) : null}
            <Field label="Title" htmlFor="task-title">
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
              />
            </Field>
            <Field label="Details (optional)" htmlFor="task-desc">
              <Textarea
                id="task-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Type" htmlFor="task-kind">
                <select
                  id="task-kind"
                  className={selectClass}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Task['kind'])}
                >
                  {TASK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" htmlFor="task-priority">
                <select
                  id="task-priority"
                  className={selectClass}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Task['priority'])}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due" htmlFor="task-due">
                <Input
                  id="task-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Assign to" htmlFor="task-assignees">
              <PeoplePicker
                label="Assign to"
                candidates={candidatesFor(source?.conversation ?? null, directory)}
                picked={assignees}
                onChange={setAssignees}
                directory={directory}
              />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-label font-normal text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || pending} loading={pending}>
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RequestApprovalDialog({
  open,
  onOpenChange,
  source,
  me,
  directory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: WorkSource | null;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onCreated?: (a: Approval) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<Approval['category']>('general');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [policy, setPolicy] = React.useState<'any' | 'all'>('any');
  const [due, setDue] = React.useState('');
  const [approvers, setApprovers] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const requestId = React.useRef('');

  React.useEffect(() => {
    if (!open) return;
    setTitle(firstLine(source?.text));
    setDescription('');
    setCategory('general');
    setAmount('');
    setPolicy('any');
    setDue('');
    setApprovers([]);
    setError(null);
    requestId.current = crypto.randomUUID();
  }, [open, source]);

  const amountMinor = amount.trim() ? Math.round(Number(amount) * 100) : null;
  const amountOk = amountMinor === null || (Number.isFinite(amountMinor) && amountMinor >= 0);
  const valid = title.trim() && approvers.length > 0 && amountOk && /^[A-Z]{3}$/.test(currency);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const a = await api.createApproval({
        title: title.trim(),
        description: description.trim(),
        category,
        amount: amountMinor !== null ? { amountMinor, currency } : null,
        approverIds: approvers,
        policy,
        dueAt: dateToIso(due),
        conversationId: source?.conversation.conversationId ?? null,
        sourceMessageId: source?.messageId ?? null,
        clientRequestId: requestId.current,
      });
      toast({
        title: 'Approval requested',
        description: 'Approvers were notified.',
        tone: 'success',
      });
      onCreated?.(a);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Request approval"
        description="Approvers decide from the card in the conversation or from Tasks & Approvals."
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="-mx-1 grid max-h-[min(58dvh,560px)] gap-3 overflow-y-auto px-1 pb-1">
            {source?.text ? (
              <blockquote className="line-clamp-3 rounded-md border-l-2 border-accent bg-surface-raised px-3 py-2 text-meta text-text-muted">
                {source.text}
              </blockquote>
            ) : null}
            <Field label="What needs approval" htmlFor="appr-title">
              <Input
                id="appr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
              />
            </Field>
            <Field label="Details (optional)" htmlFor="appr-desc">
              <Textarea
                id="appr-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Category" htmlFor="appr-cat">
                <select
                  id="appr-cat"
                  className={selectClass}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Approval['category'])}
                >
                  {APPROVAL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Amount"
                htmlFor="appr-amount"
                error={amountOk ? undefined : 'Enter a number'}
              >
                <Input
                  id="appr-amount"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Currency" htmlFor="appr-cur">
                <Input
                  id="appr-cur"
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Due" htmlFor="appr-due">
                <Input
                  id="appr-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Approvers" htmlFor="appr-approvers">
              <PeoplePicker
                label="Approvers"
                candidates={candidatesFor(source?.conversation ?? null, directory).filter(
                  (id) => id !== me,
                )}
                picked={approvers}
                onChange={setApprovers}
                directory={directory}
                emptyText="Add people to this conversation to ask them for approval."
              />
            </Field>
            {approvers.length > 1 ? (
              <div
                role="radiogroup"
                aria-label="Decision rule"
                className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-sunken p-1"
              >
                {(
                  [
                    ['any', 'Any one approver'],
                    ['all', 'Everyone must approve'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={policy === v}
                    onClick={() => setPolicy(v)}
                    className={cn(
                      'h-9 rounded-md text-label transition-colors',
                      policy === v ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-label font-normal text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending} loading={pending}>
              Request approval
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve or reject with an optional comment. */
export function DecideDialog({
  approval,
  decision,
  onOpenChange,
  onDecided,
}: {
  approval: Approval | null;
  decision: 'approve' | 'reject';
  onOpenChange: (o: boolean) => void;
  onDecided?: (a: Approval) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [comment, setComment] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setComment('');
    setError(null);
  }, [approval, decision]);

  const submit = async () => {
    if (!approval) return;
    setPending(true);
    setError(null);
    try {
      const a = await api.decide(approval.approvalId, { decision, comment: comment.trim() });
      toast({ title: decision === 'approve' ? 'Approved' : 'Rejected', tone: 'success' });
      onDecided?.(a);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={!!approval} onOpenChange={onOpenChange}>
      <DialogContent
        title={decision === 'approve' ? 'Approve request' : 'Reject request'}
        description={approval?.title}
      >
        <Field
          label={
            decision === 'reject' ? 'Reason (shared with the requester)' : 'Comment (optional)'
          }
          htmlFor="decide-comment"
        >
          <Textarea
            id="decide-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            autoFocus
          />
        </Field>
        {error ? (
          <p role="alert" className="mt-3 text-label font-normal text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={decision === 'reject' ? 'danger' : 'primary'}
            onClick={() => void submit()}
            loading={pending}
            disabled={pending}
          >
            {decision === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewProjectDialog({
  open,
  onOpenChange,
  me,
  directory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onCreated?: (p: Project) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [due, setDue] = React.useState('');
  const [isPrivate, setPrivate] = React.useState(false);
  const [members, setMembers] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setDue('');
    setPrivate(false);
    setMembers([]);
    setError(null);
  }, [open]);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const p = await api.createProject({
        name: name.trim(),
        description: description.trim(),
        dueAt: dateToIso(due),
        memberIds: members,
        private: isPrivate,
      });
      toast({ title: 'Project created', description: `#${p.name} is ready.`, tone: 'success' });
      onCreated?.(p);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New project"
        description="Creates the project and its channel. Tasks and approvals in the channel count toward the project."
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="-mx-1 grid max-h-[min(58dvh,560px)] gap-3 overflow-y-auto px-1 pb-1">
            <Field label="Project name" htmlFor="proj-name">
              <Input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Q1 brand tracker"
                required
                autoFocus
              />
            </Field>
            <Field label="Description (optional)" htmlFor="proj-desc">
              <Textarea
                id="proj-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due (optional)" htmlFor="proj-due">
                <Input
                  id="proj-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Field label="Channel" htmlFor="proj-vis">
                <select
                  id="proj-vis"
                  className={selectClass}
                  value={isPrivate ? 'private' : 'public'}
                  onChange={(e) => setPrivate(e.target.value === 'private')}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </Field>
            </div>
            <Field label="Members" htmlFor="proj-members">
              <PeoplePicker
                label="Members"
                candidates={[...directory.keys()].filter((id) => id !== me)}
                picked={members}
                onChange={setMembers}
                directory={directory}
                emptyText="No one else here yet. Invite people from Administration."
              />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-label font-normal text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending} loading={pending}>
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
