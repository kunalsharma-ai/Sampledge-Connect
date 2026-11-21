'use client';
import * as React from 'react';
import {
  BriefcaseBusiness,
  CheckCircle2,
  FolderKanban,
  Link2,
  Mail,
  Phone,
  Plus,
  Siren,
  Tag,
  Users,
  X,
} from 'lucide-react';
import {
  INBOX_PRIORITIES,
  INBOX_STATUSES,
  type InboxConversationDetail,
  type InboxPriority,
  type InboxSettings,
  type InboxStatus,
} from '@sampledge/contracts';
import { Avatar, Badge, Button, Input, cn, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import type { InboxApi } from '@/lib/inbox';
import { PROVIDER_META, PRIORITY_STYLE, ProviderMark, SlaPill, selectClass } from './shared';

const STATUS_LABEL: Record<InboxStatus, string> = {
  open: 'Open',
  pending: 'Waiting on client',
  snoozed: 'Snoozed',
  resolved: 'Resolved',
};

function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-0">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="size-3.5 text-text-subtle" />
        <h3 className="text-meta font-semibold uppercase tracking-wider text-text-subtle">
          {title}
        </h3>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** Right-hand context: who the client is, who owns the conversation, SLA, escalation and linked work. */
export function ClientPanel({
  detail,
  me,
  directory,
  api,
  settings,
  online,
  onChanged,
}: {
  detail: InboxConversationDetail;
  me: string;
  directory: Map<string, DirectoryEntry>;
  api: InboxApi;
  settings: InboxSettings | null;
  online: boolean;
  onChanged: (d: InboxConversationDetail) => void;
}) {
  const { conversation: c, client } = detail;
  const { toast } = useToast();
  const [tag, setTag] = React.useState('');
  const [escalating, setEscalating] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [linking, setLinking] = React.useState(false);
  const [link, setLink] = React.useState({
    module: 'sampforce' as 'sampforce' | 'samptrek',
    externalId: '',
    label: '',
  });
  const agents = [...directory.values()].filter((u) => u.role !== 'guest');

  const run = async (fn: () => Promise<InboxConversationDetail>, done?: string) => {
    try {
      onChanged(await fn());
      if (done) toast({ title: done, tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not update', description: (e as Error).message, tone: 'danger' });
    }
  };
  const update = (body: Parameters<InboxApi['update']>[1], done?: string) =>
    run(() => api.update(c.conversationId, body), done);

  return (
    <aside
      className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface/30 min-[1280px]:flex"
      aria-label="Client details"
    >
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <Avatar name={client.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-h3 text-text">{client.name}</p>
            <p className="truncate text-label font-normal text-text-muted">
              {[client.title, client.company].filter(Boolean).join(' · ') || 'No company yet'}
            </p>
          </div>
        </div>
        <ul className="mt-3 space-y-1 text-label font-normal text-text-muted">
          {client.email ? (
            <li className="flex items-center gap-2">
              <Mail className="size-3.5" /> {client.email}
            </li>
          ) : null}
          {client.phone ? (
            <li className="flex items-center gap-2">
              <Phone className="size-3.5" /> {client.phone}
            </li>
          ) : null}
        </ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {client.identities.map((i) => (
            <span
              key={i.accountId}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-0.5 pl-0.5 pr-2 text-meta text-text-muted"
            >
              <ProviderMark provider={i.provider} size="sm" className="rounded-full" />
              {i.handle ?? i.displayName}
            </span>
          ))}
        </div>
        <p className="mt-2 text-meta text-text-subtle">
          {client.conversationCount} conversation{client.conversationCount === 1 ? '' : 's'} across{' '}
          {new Set(client.identities.map((i) => i.provider)).size} channel
          {new Set(client.identities.map((i) => i.provider)).size === 1 ? '' : 's'}
        </p>
      </div>

      <Section title="Ownership" icon={Users}>
        <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2 text-label">
          <label htmlFor="inbox-assignee" className="text-text-muted">
            Assignee
          </label>
          <select
            id="inbox-assignee"
            className={selectClass}
            value={c.assigneeId ?? ''}
            disabled={!online}
            onChange={(e) => void update({ assigneeId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {agents.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.userId === me ? `${u.displayName} (you)` : u.displayName}
              </option>
            ))}
          </select>
          <label htmlFor="inbox-team" className="text-text-muted">
            Team
          </label>
          <select
            id="inbox-team"
            className={selectClass}
            value={c.teamId ?? ''}
            disabled={!online}
            onChange={(e) => void update({ teamId: e.target.value || null })}
          >
            <option value="">Everyone</option>
            {(settings?.teams ?? []).map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.name}
              </option>
            ))}
          </select>
          <label htmlFor="inbox-status" className="text-text-muted">
            Status
          </label>
          <select
            id="inbox-status"
            className={selectClass}
            value={c.status}
            disabled={!online}
            onChange={(e) => {
              const status = e.target.value as InboxStatus;
              void update(
                status === 'snoozed'
                  ? { status, snoozedUntil: new Date(Date.now() + 24 * 3600_000).toISOString() }
                  : { status },
              );
            }}
          >
            {INBOX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'snoozed' ? 'Snoozed (24h)' : STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <label htmlFor="inbox-priority" className="text-text-muted">
            Priority
          </label>
          <select
            id="inbox-priority"
            className={cn(selectClass, PRIORITY_STYLE[c.priority].text)}
            value={c.priority}
            disabled={!online}
            onChange={(e) => void update({ priority: e.target.value as InboxPriority })}
          >
            {INBOX_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_STYLE[p].label}
              </option>
            ))}
          </select>
        </div>
        {c.status !== 'resolved' ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3 w-full"
            disabled={!online}
            onClick={() => void update({ status: 'resolved' }, 'Conversation resolved')}
          >
            <CheckCircle2 /> Resolve
          </Button>
        ) : null}
      </Section>

      <Section title="Service level" icon={Siren}>
        <div className="flex items-center gap-2">
          <SlaPill sla={c.sla} />
          {c.sla.state === 'none' ? (
            <span className="text-label font-normal text-text-muted">Nothing waiting on you</span>
          ) : null}
        </div>
        <p className="mt-2 text-meta text-text-subtle">
          {settings
            ? `${PRIORITY_STYLE[c.priority].label} priority: reply within ${settings.sla[c.priority] >= 60 ? `${settings.sla[c.priority] / 60}h` : `${settings.sla[c.priority]}m`}.`
            : null}
          {c.sla.firstResponseAt
            ? ` First reply ${new Date(c.sla.firstResponseAt).toLocaleString()}.`
            : ''}
        </p>
        {c.escalation ? (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-label">
            <p className="font-medium text-danger">Escalated · level {c.escalation.level}</p>
            <p className="font-normal text-text-muted">{c.escalation.reason}</p>
          </div>
        ) : null}
        {escalating ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) return;
              void run(
                () => api.escalate(c.conversationId, { reason: reason.trim() }),
                'Escalated to a supervisor',
              ).then(() => {
                setEscalating(false);
                setReason('');
              });
            }}
          >
            <Input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why does this need a supervisor?"
              aria-label="Escalation reason"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" type="submit" disabled={!reason.trim()}>
                Escalate
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEscalating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full"
            disabled={!online}
            onClick={() => setEscalating(true)}
          >
            <Siren /> {c.escalation ? 'Escalate further' : 'Escalate'}
          </Button>
        )}
      </Section>

      <Section title="Tags" icon={Tag}>
        <div className="flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-meta text-accent"
            >
              #{t}
              <button
                aria-label={`Remove ${t}`}
                disabled={!online}
                onClick={() => void update({ tags: c.tags.filter((x) => x !== t) })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (tag.trim()) void update({ tags: [...c.tags, tag.trim()] }).then(() => setTag(''));
            }}
          >
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="Add tag"
              aria-label="Add tag"
              disabled={!online}
              className="h-6 w-24 rounded-full border border-dashed border-border bg-transparent px-2 text-meta text-text placeholder:text-text-subtle"
            />
          </form>
        </div>
      </Section>

      <Section
        title="Linked work"
        icon={Link2}
        action={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Link a record"
            onClick={() => setLinking((v) => !v)}
            disabled={!online}
          >
            <Plus />
          </Button>
        }
      >
        <ul className="space-y-2">
          {c.links.map((l) => (
            <li
              key={l.linkId}
              className="group flex items-start gap-2.5 rounded-lg border border-border bg-surface-raised/60 px-3 py-2"
            >
              {l.module === 'sampforce' ? (
                <BriefcaseBusiness className="mt-0.5 size-4 text-accent" />
              ) : (
                <FolderKanban className="mt-0.5 size-4 text-accent-2" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-label text-text">{l.label}</p>
                <p className="text-meta text-text-subtle">
                  {l.module === 'sampforce' ? 'SampForce' : 'Samptrek'} {l.recordType} ·{' '}
                  {l.externalId}
                  {l.verified ? '' : ' · unverified'}
                </p>
              </div>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Unlink"
                onClick={() => void run(() => api.unlink(c.conversationId, l.linkId))}
              >
                <X className="size-3.5 text-text-subtle" />
              </button>
            </li>
          ))}
          {!c.links.length && !linking ? (
            <li className="text-label font-normal text-text-subtle">
              Link a SampForce opportunity or a Samptrek project.
            </li>
          ) : null}
        </ul>
        {linking ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.link(c.conversationId, {
                    module: link.module,
                    recordType: link.module === 'sampforce' ? 'opportunity' : 'project',
                    externalId: link.externalId.trim(),
                    label: link.label.trim(),
                  }),
                'Linked',
              ).then(() => {
                setLinking(false);
                setLink({ module: link.module, externalId: '', label: '' });
              });
            }}
          >
            <select
              className={cn(selectClass, 'w-full')}
              value={link.module}
              onChange={(e) =>
                setLink({ ...link, module: e.target.value as 'sampforce' | 'samptrek' })
              }
              aria-label="Module"
            >
              <option value="sampforce">SampForce opportunity</option>
              <option value="samptrek">Samptrek project</option>
            </select>
            <Input
              value={link.externalId}
              onChange={(e) => setLink({ ...link, externalId: e.target.value })}
              placeholder={
                link.module === 'sampforce'
                  ? 'Opportunity ID, e.g. OPP-1042'
                  : 'Project ID, e.g. PRJ-2207'
              }
              aria-label="Record ID"
            />
            <Input
              value={link.label}
              onChange={(e) => setLink({ ...link, label: e.target.value })}
              placeholder="Title"
              aria-label="Record title"
            />
            <p className="text-meta text-text-subtle">
              Records are verified once the {link.module === 'sampforce' ? 'SampForce' : 'Samptrek'}{' '}
              integration is connected.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                type="submit"
                disabled={!link.externalId.trim() || !link.label.trim()}
              >
                Link
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setLinking(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Section>

      <div className="px-5 py-4 text-meta text-text-subtle">
        Channel: {PROVIDER_META[c.provider].name}
        {c.testMode ? (
          <Badge tone="accent2" className="ml-2">
            Test
          </Badge>
        ) : null}
      </div>
    </aside>
  );
}
