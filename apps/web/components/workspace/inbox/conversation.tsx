'use client';
import * as React from 'react';
import {
  ArrowLeft,
  Lock,
  MessageSquareReply,
  NotebookPen,
  RotateCw,
  Send,
  ShieldAlert,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import {
  CONNECTOR_CATALOG,
  renderTemplate,
  type InboxConversationDetail,
  type InboxTemplate,
  type InboxTimelineItem,
} from '@sampledge/contracts';
import { Avatar, Button, Textarea, cn, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import type { InboxApi, PendingInboxItem } from '@/lib/inbox';
import { formatDay, formatTime, nameOf } from '../helpers';
import { DeliveryState, PROVIDER_META, ProviderMark, SlaPill, TestModeBadge } from './shared';

type Mode = 'reply' | 'note';

/**
 * One client conversation: a single timeline of client messages, agent replies, internal
 * notes and activity. Notes are visually distinct and come from a separate API; the composer
 * makes the destination explicit before anything is sent.
 */
export function InboxConversationView({
  detail,
  me,
  directory,
  api,
  online,
  pending,
  templates,
  onEnqueue,
  onDiscardPending,
  onChanged,
  onBack,
}: {
  detail: InboxConversationDetail;
  me: string;
  directory: Map<string, DirectoryEntry>;
  api: InboxApi;
  online: boolean;
  pending: PendingInboxItem[];
  templates: InboxTemplate[];
  onEnqueue: (item: Omit<PendingInboxItem, 'id' | 'createdAt'>) => Promise<PendingInboxItem>;
  onDiscardPending: (id: string) => void;
  onChanged: (d?: InboxConversationDetail) => void;
  onBack: () => void;
}) {
  const { conversation: c, client } = detail;
  const { toast } = useToast();
  const [mode, setMode] = React.useState<Mode>('reply');
  const [text, setText] = React.useState('');
  const [templateId, setTemplateId] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [logText, setLogText] = React.useState('');
  const scroller = React.useRef<HTMLDivElement>(null);
  const descriptor = CONNECTOR_CATALOG[c.provider];
  const handoff = descriptor.mode === 'handoff';
  const agentName = directory.get(me)?.displayName ?? 'Agent';

  React.useEffect(() => {
    setText('');
    setMode('reply');
  }, [c.conversationId]);
  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [detail.timeline.length, pending.length, c.conversationId]);

  const slash = text.startsWith('/') ? text.slice(1).toLowerCase() : null;
  const matches =
    slash !== null
      ? templates
          .filter((t) => t.shortcut?.startsWith(slash) || t.name.toLowerCase().includes(slash))
          .slice(0, 6)
      : [];
  const applyTemplate = (t: InboxTemplate) => {
    setText(
      renderTemplate(t.body, { clientName: client.name, clientCompany: client.company, agentName }),
    );
    setTemplateId(t.templateId);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const item = await onEnqueue({
      kind: mode,
      conversationId: c.conversationId,
      text: body,
      ...(mode === 'reply' && templateId ? { templateId } : {}),
    });
    setText('');
    setTemplateId(undefined);
    try {
      if (online) {
        if (mode === 'reply')
          await api.reply(c.conversationId, { clientMessageId: item.id, text: body, templateId });
        else await api.note(c.conversationId, { clientNoteId: item.id, text: body, mentions: [] });
        onDiscardPending(item.id);
        onChanged();
      }
    } catch {
      toast({
        title: 'Saved on this device',
        description: 'It will be sent when the connection is back.',
        tone: 'info',
      });
    } finally {
      setBusy(false);
    }
  };

  const items = detail.timeline;
  let lastDay = '';

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Client conversation">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 py-3 backdrop-blur-xl sm:px-5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onBack}
          aria-label="Back to list"
        >
          <ArrowLeft />
        </Button>
        <ProviderMark provider={c.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-h3 text-text">{client.name}</h2>
            {client.company ? (
              <span className="hidden truncate text-label font-normal text-text-subtle sm:inline">
                · {client.company}
              </span>
            ) : null}
          </div>
          <p className="truncate text-meta text-text-muted">
            {c.subject} · via {PROVIDER_META[c.provider].name}
          </p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {c.testMode ? <TestModeBadge /> : null}
          <SlaPill sla={c.sla} />
        </div>
      </header>

      {descriptor.mode !== 'two_way' ? (
        <div className="flex items-start gap-2 border-b border-border bg-warning/8 px-5 py-2 text-meta text-text-muted">
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            <strong className="font-medium text-text">
              {handoff ? 'Handoff channel.' : 'Limited channel.'}
            </strong>{' '}
            {descriptor.limitations[0]}
          </span>
        </div>
      ) : null}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        data-testid="inbox-timeline"
      >
        <ol className="mx-auto flex max-w-3xl flex-col gap-3">
          {items.map((it) => {
            const at = itemAt(it);
            const day = formatDay(at);
            const header = day !== lastDay ? ((lastDay = day), day) : null;
            return (
              <React.Fragment key={itemKey(it)}>
                {header ? (
                  <li
                    className="my-2 flex items-center gap-3 text-meta text-text-subtle"
                    aria-hidden
                  >
                    <span className="h-px flex-1 bg-border" />
                    {header}
                    <span className="h-px flex-1 bg-border" />
                  </li>
                ) : null}
                <TimelineRow
                  item={it}
                  detail={detail}
                  directory={directory}
                  me={me}
                  api={api}
                  onChanged={onChanged}
                />
              </React.Fragment>
            );
          })}
          {pending
            .filter((p) => p.conversationId === c.conversationId)
            .map((p) =>
              p.kind === 'note' ? (
                <NoteCard
                  key={p.id}
                  author={agentName}
                  at={p.createdAt}
                  text={p.text}
                  pending
                  error={p.error}
                />
              ) : (
                <li key={p.id} className="flex justify-end">
                  <div className="max-w-[78%]">
                    <div className="rounded-2xl rounded-br-md bg-accent/80 px-3.5 py-2 text-body text-accent-fg">
                      {p.text}
                    </div>
                    <div className="mt-1 flex justify-end">
                      {p.error ? (
                        <span className="text-meta text-danger">
                          Not sent: {p.error}{' '}
                          <button className="underline" onClick={() => onDiscardPending(p.id)}>
                            Discard
                          </button>
                        </span>
                      ) : (
                        <DeliveryState state="pending" provider={c.provider} />
                      )}
                    </div>
                  </div>
                </li>
              ),
            )}
        </ol>
      </div>

      {handoff ? (
        <form
          className="flex items-center gap-2 border-t border-border bg-surface-sunken/40 px-4 py-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!logText.trim()) return;
            try {
              onChanged(await api.logInbound(c.conversationId, logText.trim()));
              setLogText('');
            } catch (err) {
              toast({
                title: 'Could not log message',
                description: (err as Error).message,
                tone: 'danger',
              });
            }
          }}
        >
          <input
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder={`Log a message ${client.name.split(' ')[0]} sent in ${PROVIDER_META[c.provider].name}…`}
            className="h-8 flex-1 rounded-md border border-border bg-surface px-2.5 text-label text-text placeholder:text-text-subtle"
            disabled={!online}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!online || !logText.trim()}>
            Log client message
          </Button>
        </form>
      ) : null}

      <div className="shrink-0 border-t border-border bg-surface/60 p-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto max-w-3xl">
          <div role="tablist" aria-label="Composer mode" className="mb-2 flex items-center gap-1">
            <ModeTab
              active={mode === 'reply'}
              onClick={() => setMode('reply')}
              icon={MessageSquareReply}
            >
              Reply to client
            </ModeTab>
            <ModeTab
              active={mode === 'note'}
              onClick={() => setMode('note')}
              icon={NotebookPen}
              tone="note"
            >
              Internal note
            </ModeTab>
            <span className="ml-auto hidden text-meta text-text-subtle sm:inline">
              {mode === 'reply'
                ? handoff
                  ? `Opens ${PROVIDER_META[c.provider].name} to send`
                  : c.testMode
                    ? 'Test mode: captured by the sandbox'
                    : `Sends to ${client.name.split(' ')[0]} on ${PROVIDER_META[c.provider].name}`
                : 'Only your team sees notes'}
            </span>
          </div>
          <div
            className={cn(
              'relative rounded-xl border bg-surface-sunken transition-colors',
              mode === 'note'
                ? 'border-amber-400/50 bg-amber-400/[0.06]'
                : 'border-border focus-within:border-accent',
            )}
          >
            {matches.length ? (
              <ul
                className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
                role="listbox"
                aria-label="Templates"
              >
                {matches.map((t) => (
                  <li key={t.templateId}>
                    <button
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-raised"
                      onClick={() => applyTemplate(t)}
                    >
                      <span className="text-label text-text">
                        {t.name}{' '}
                        {t.shortcut ? (
                          <span className="text-text-subtle">/{t.shortcut}</span>
                        ) : null}
                      </span>
                      <span className="line-clamp-1 text-meta text-text-muted">{t.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Textarea
              aria-label={mode === 'reply' ? 'Reply to client' : 'Internal note'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (!e.target.value) setTemplateId(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !matches.length) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder={
                mode === 'reply'
                  ? `Reply to ${client.name.split(' ')[0]}… Type / for templates`
                  : 'Add a note for your team. The client never sees it.'
              }
              className="resize-none border-0 bg-transparent focus-visible:ring-0"
            />
            <div className="flex items-center gap-2 px-2 pb-2">
              <TemplateMenu templates={templates} onPick={applyTemplate} />
              {!online ? (
                <span className="text-meta text-warning">
                  Offline: saved here, sent on reconnect
                </span>
              ) : null}
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={!text.trim() || busy}
                variant={mode === 'note' ? 'secondary' : 'primary'}
              >
                {mode === 'note' ? <StickyNote /> : <Send />}
                {mode === 'note' ? 'Add note' : handoff ? 'Prepare handoff' : 'Send reply'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  tone?: 'note';
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-label transition-colors',
        active
          ? tone === 'note'
            ? 'bg-amber-400/15 text-amber-500 dark:text-amber-300'
            : 'bg-accent-soft text-accent'
          : 'text-text-muted hover:bg-surface-raised hover:text-text',
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function TemplateMenu({
  templates,
  onPick,
}: {
  templates: InboxTemplate[];
  onPick: (t: InboxTemplate) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!templates.length}
      >
        <Sparkles /> Templates
      </Button>
      {open ? (
        <ul className="absolute bottom-full left-0 z-10 mb-2 max-h-72 w-80 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {templates.map((t) => (
            <li key={t.templateId}>
              <button
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-raised"
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                }}
              >
                <span className="text-label text-text">{t.name}</span>
                <span className="line-clamp-2 text-meta text-text-muted">{t.body}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const itemAt = (it: InboxTimelineItem) =>
  it.type === 'message'
    ? it.message.createdAt
    : it.type === 'note'
      ? it.note.createdAt
      : it.activity.createdAt;
const itemKey = (it: InboxTimelineItem) =>
  it.type === 'message'
    ? it.message.messageId
    : it.type === 'note'
      ? it.note.noteId
      : it.activity.activityId;

function NoteCard({
  author,
  at,
  text,
  pending,
  error,
}: {
  author: string;
  at: string;
  text: string;
  pending?: boolean;
  error?: string;
}) {
  return (
    <li className="mx-auto w-full max-w-[86%]" data-kind="note">
      <div className="rounded-xl border border-dashed border-amber-400/50 bg-amber-400/[0.07] px-4 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-meta font-medium text-amber-600 dark:text-amber-300">
          <Lock className="size-3" /> Internal note · {author} · {formatTime(at)}
          {pending ? (
            <span className="font-normal text-text-subtle">
              · {error ? `not saved: ${error}` : 'saving'}
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-body text-text">{text}</p>
      </div>
    </li>
  );
}

function TimelineRow({
  item,
  detail,
  directory,
  me,
  api,
  onChanged,
}: {
  item: InboxTimelineItem;
  detail: InboxConversationDetail;
  directory: Map<string, DirectoryEntry>;
  me: string;
  api: InboxApi;
  onChanged: () => void;
}) {
  const c = detail.conversation;
  if (item.type === 'activity') {
    const who = item.activity.actorId
      ? item.activity.actorId === me
        ? 'You'
        : nameOf(item.activity.actorId, directory)
      : 'System';
    return (
      <li className="flex justify-center">
        <span className="rounded-full bg-surface-raised/70 px-3 py-1 text-meta text-text-subtle">
          {item.activity.summary} · {who} · {formatTime(item.activity.createdAt)}
        </span>
      </li>
    );
  }
  if (item.type === 'note') {
    const n = item.note;
    return (
      <NoteCard
        author={n.authorId === me ? 'You' : nameOf(n.authorId, directory)}
        at={n.createdAt}
        text={n.text}
      />
    );
  }
  const m = item.message;
  if (m.direction === 'inbound') {
    const identity = detail.client.identities.find((x) => x.accountId === m.accountId);
    return (
      <li className="flex items-end gap-2" data-direction="inbound">
        <div className="relative">
          <Avatar name={identity?.displayName ?? detail.client.name} size="sm" />
          <ProviderMark
            provider={c.provider}
            size="sm"
            className="absolute -bottom-1 -right-1.5 size-3.5 rounded-[4px] text-[6px]"
          />
        </div>
        <div className="max-w-[78%]">
          <div className="mb-0.5 text-meta text-text-subtle">
            {identity?.displayName ?? detail.client.name} · {formatTime(m.createdAt)}
          </div>
          <div className="rounded-2xl rounded-bl-md border border-border bg-surface-raised px-3.5 py-2 text-body text-text shadow-sm">
            {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
            {m.attachments.map((a, i) => (
              <p key={i} className="mt-1 text-meta text-text-muted">
                📎 {a.name}
              </p>
            ))}
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className="flex justify-end" data-direction="outbound">
      <div className="max-w-[78%]">
        <div className="mb-0.5 text-right text-meta text-text-subtle">
          {m.authorId === me ? 'You' : m.authorId ? nameOf(m.authorId, directory) : 'Agent'} ·{' '}
          {formatTime(m.createdAt)}
        </div>
        <div className="rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-body text-accent-fg shadow-sm">
          <p className="whitespace-pre-wrap">{m.text}</p>
        </div>
        <div className="mt-1 flex items-center justify-end gap-2">
          <DeliveryState
            state={m.deliveryState}
            error={m.error}
            handoffUrl={m.handoffUrl}
            provider={c.provider}
          />
          {m.deliveryState === 'failed' ? (
            <button
              className="inline-flex items-center gap-1 text-meta font-medium text-accent hover:underline"
              onClick={async () => {
                await api.retry(c.conversationId, m.messageId);
                onChanged();
              }}
            >
              <RotateCw className="size-3" /> Retry
            </button>
          ) : null}
        </div>
        {m.sandboxRequest ? (
          <details className="mt-1 text-right">
            <summary className="cursor-pointer text-meta text-text-subtle hover:text-text">
              What would be sent
            </summary>
            <pre className="mt-1 max-w-full overflow-x-auto rounded-md border border-border bg-surface-sunken p-2 text-left font-mono text-[11px] leading-relaxed text-text-muted">
              {`${m.sandboxRequest.method} ${m.sandboxRequest.url}\n${JSON.stringify(m.sandboxRequest.body, null, 2)}`}
            </pre>
          </details>
        ) : null}
      </div>
    </li>
  );
}
