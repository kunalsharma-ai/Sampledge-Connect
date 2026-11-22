'use client';
import * as React from 'react';
import {
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  type Approval,
  type Conversation,
  type Project,
  type Task,
  type UpdateApprovalRequest,
  type UpdateProjectRequest,
  type UpdateTaskRequest,
} from '@sampledge/contracts';
import { Button, Dialog, DialogContent, Field, Input, Textarea, useToast } from '@sampledge/ui';
import { useEngine, type DirectoryEntry } from '@/lib/engine';
import { useWorkApi } from '@/lib/work';
import { candidatesFor } from './work-dialogs';
import { PRIORITY_LABEL, PeoplePicker, dateToIso, isoToDate, selectClass } from './work-ui';

/**
 * Editing tasks, approval requests and projects (docs/editing.md). Every change goes through
 * this device's action queue, so it shows at once, works offline and reaches everyone when
 * the server confirms it.
 */

function Actions({
  onCancel,
  disabled,
  label = 'Save changes',
}: {
  onCancel: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

/** Only the fields that changed, so two people editing different fields don't clash. */
function diff<T extends object>(before: Partial<T>, after: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[])
    if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) out[k] = after[k];
  return out;
}

export function EditTaskDialog({
  task,
  conversation,
  directory,
  onOpenChange,
  onSaved,
}: {
  task: Task | null;
  conversation: Conversation | null;
  directory: Map<string, DirectoryEntry>;
  onOpenChange: (o: boolean) => void;
  onSaved?: (t: Task) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<Task['priority']>('normal');
  const [due, setDue] = React.useState('');
  const [assignees, setAssignees] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setDue(isoToDate(task.dueAt));
    setAssignees(task.assigneeIds);
  }, [task]);
  if (!task) return null;
  const before: UpdateTaskRequest = {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.dueAt,
    assigneeIds: task.assigneeIds,
  };
  const changes = diff<UpdateTaskRequest>(before, {
    title: title.trim(),
    description: description.trim(),
    priority,
    // Keep the original time of day when only other fields changed.
    dueAt: due === isoToDate(task.dueAt) ? task.dueAt : dateToIso(due),
    assigneeIds: assignees,
  });
  const save = async () => {
    try {
      onSaved?.(await api.queueTaskUpdate(task, changes));
      toast({ title: 'Task updated', tone: 'success' });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Couldn’t update the task',
        description: (e as Error).message,
        tone: 'danger',
      });
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit task"
        description="Everyone on the task sees the change. Newly assigned people are notified."
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" htmlFor="edit-task-title">
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </Field>
          <Field label="Details" htmlFor="edit-task-desc">
            <Textarea
              id="edit-task-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority" htmlFor="edit-task-priority">
              <select
                id="edit-task-priority"
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
            <Field label="Due" htmlFor="edit-task-due">
              <Input
                id="edit-task-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Assigned to" htmlFor="edit-task-assignees">
            <PeoplePicker
              label="Assigned to"
              candidates={candidatesFor(conversation, directory)}
              picked={assignees}
              onChange={setAssignees}
              directory={directory}
            />
          </Field>
          <Actions
            onCancel={() => onOpenChange(false)}
            disabled={!title.trim() || Object.keys(changes).length === 0}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Whether you can still edit this request: yours, pending, and nobody has decided. */
export const canEditApproval = (a: Approval, me: string) =>
  a.requesterId === me &&
  a.status === 'pending' &&
  a.decisions.length === 0 &&
  a.origin !== 'module';

export function EditApprovalDialog({
  approval,
  onOpenChange,
}: {
  approval: Approval | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { engine } = useEngine();
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [due, setDue] = React.useState('');
  React.useEffect(() => {
    if (!approval) return;
    setTitle(approval.title);
    setDescription(approval.description);
    setAmount(approval.amount ? String(approval.amount.amountMinor / 100) : '');
    setCurrency(approval.amount?.currency ?? 'USD');
    setDue(isoToDate(approval.dueAt));
  }, [approval]);
  if (!approval) return null;
  const amountMinor = amount.trim() ? Math.round(Number(amount) * 100) : null;
  const amountOk =
    (amountMinor === null || (Number.isFinite(amountMinor) && amountMinor >= 0)) &&
    /^[A-Z]{3}$/.test(currency);
  const changes = diff<UpdateApprovalRequest>(
    {
      title: approval.title,
      description: approval.description,
      amount: approval.amount,
      dueAt: approval.dueAt,
    },
    {
      title: title.trim(),
      description: description.trim(),
      amount: amountMinor !== null ? { amountMinor, currency } : null,
      dueAt: due === isoToDate(approval.dueAt) ? approval.dueAt : dateToIso(due),
    },
  );
  const save = async () => {
    await engine.queueAction({
      key: `approval-edit|${approval.approvalId}`,
      method: 'PATCH',
      path: `/v1/approvals/${approval.approvalId}`,
      body: changes,
      label: `Edit “${approval.title}”`,
      conversationId: approval.conversationId ?? undefined,
    });
    toast({
      title: 'Request updated',
      description: 'Approvers see the new version.',
      tone: 'success',
    });
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit approval request"
        description="You can change it until someone decides. After that, cancel it and ask again."
        className="w-[min(520px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="What needs approving" htmlFor="edit-approval-title">
            <Input
              id="edit-approval-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </Field>
          <Field label="Details" htmlFor="edit-approval-desc">
            <Textarea
              id="edit-approval-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
          </Field>
          <div className="grid grid-cols-[1fr_90px_1fr] gap-3">
            <Field label="Amount" htmlFor="edit-approval-amount">
              <Input
                id="edit-approval-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Currency" htmlFor="edit-approval-currency">
              <Input
                id="edit-approval-currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Decide by" htmlFor="edit-approval-due">
              <Input
                id="edit-approval-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
          </div>
          <Actions
            onCancel={() => onOpenChange(false)}
            disabled={!title.trim() || !amountOk || Object.keys(changes).length === 0}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PROJECT_STATUS_LABEL: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On hold',
  at_risk: 'At risk',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Owners of a project made in SampConnect, and admins. */
export const canEditProject = (p: Project, me: string, isAdmin: boolean) =>
  p.source === 'connect' && (p.ownerIds.includes(me) || isAdmin);

export function EditProjectDialog({
  project,
  onOpenChange,
}: {
  project: Project | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { engine } = useEngine();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [status, setStatus] = React.useState<Project['status']>('active');
  const [due, setDue] = React.useState('');
  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description);
    setStatus(project.status);
    setDue(isoToDate(project.dueAt));
  }, [project]);
  if (!project) return null;
  const changes = diff<UpdateProjectRequest>(
    {
      name: project.name,
      description: project.description,
      status: project.status,
      dueAt: project.dueAt,
    },
    {
      name: name.trim(),
      description: description.trim(),
      status,
      dueAt: due === isoToDate(project.dueAt) ? project.dueAt : dateToIso(due),
    },
  );
  const save = async () => {
    await engine.queueAction({
      key: `project-edit|${project.projectId}`,
      method: 'PATCH',
      path: `/v1/projects/${project.projectId}`,
      body: changes,
      label: `Edit project “${project.name}”`,
    });
    toast({ title: 'Project updated', tone: 'success' });
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit project"
        description="A new name also renames the project channel."
        className="w-[min(520px,calc(100vw-2rem))]"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Name" htmlFor="edit-project-name">
            <Input
              id="edit-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="edit-project-desc">
            <Textarea
              id="edit-project-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" htmlFor="edit-project-status">
              <select
                id="edit-project-status"
                className={selectClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as Project['status'])}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due" htmlFor="edit-project-due">
              <Input
                id="edit-project-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
          </div>
          <Actions
            onCancel={() => onOpenChange(false)}
            disabled={!name.trim() || Object.keys(changes).length === 0}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rename a group or channel, or change a channel's description. */
export function EditConversationDialog({
  conversation,
  onOpenChange,
}: {
  conversation: Conversation | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { engine } = useEngine();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [topic, setTopic] = React.useState('');
  React.useEffect(() => {
    setName(conversation?.name ?? '');
    setTopic(conversation?.topic ?? '');
  }, [conversation]);
  if (!conversation) return null;
  const channel = conversation.kind === 'channel_public' || conversation.kind === 'channel_private';
  const body: { name?: string; topic?: string | null } = {};
  if (name.trim() !== (conversation.name ?? '')) body.name = name.trim();
  if (channel && topic.trim() !== (conversation.topic ?? '')) body.topic = topic.trim() || null;
  const save = async () => {
    await engine.queueAction({
      key: `conversation-edit|${conversation.conversationId}`,
      method: 'PATCH',
      path: `/v1/conversations/${conversation.conversationId}`,
      body,
      label: channel ? 'Edit channel details' : 'Rename group',
      conversationId: conversation.conversationId,
    });
    toast({ title: 'Saved for everyone', tone: 'success' });
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={channel ? 'Edit channel details' : 'Rename group'}
        description="Everyone in the conversation sees the change on every device."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Name" htmlFor="edit-conv-name">
            <Input
              id="edit-conv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required={channel}
              placeholder={channel ? undefined : 'Leave empty to use the members’ names'}
              autoFocus
            />
          </Field>
          {channel ? (
            <Field label="Description" htmlFor="edit-conv-topic">
              <Textarea
                id="edit-conv-topic"
                rows={2}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={250}
              />
            </Field>
          ) : null}
          <Actions
            onCancel={() => onOpenChange(false)}
            disabled={(channel && !name.trim()) || Object.keys(body).length === 0}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
