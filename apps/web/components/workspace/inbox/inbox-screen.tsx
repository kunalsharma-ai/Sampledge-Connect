'use client';
import * as React from 'react';
import { Inbox, LayoutDashboard, Plug, Plus, Search, Settings2 } from 'lucide-react';
import {
  CONNECTOR_CATALOG,
  type Connector,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxSettings,
  type InboxTemplate,
  type ListInboxQuery,
} from '@sampledge/contracts';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  cn,
  useToast,
} from '@sampledge/ui';
import { useTenantChange, type DirectoryEntry } from '@/lib/engine';
import { useInboxData, useInboxDetail } from '@/lib/inbox';
import { nameOf } from '../helpers';
import { ChannelsPanel } from './channels';
import { ClientPanel } from './client-panel';
import { InboxConversationView } from './conversation';
import { InboxDashboard } from './dashboard';
import { InboxSettingsPanel } from './settings';
import {
  PROVIDER_META,
  PriorityDot,
  ProviderMark,
  Segmented,
  SlaPill,
  TestModeBadge,
  relTime,
  selectClass,
} from './shared';

type Tab = 'inbox' | 'dashboard' | 'channels' | 'settings';
type View = 'mine' | 'unassigned' | 'active' | 'breached' | 'resolved';

const VIEW_QUERY: Record<View, ListInboxQuery> = {
  mine: { assignee: 'me', status: 'active' },
  unassigned: { assignee: 'unassigned', status: 'active' },
  active: { status: 'active' },
  breached: { sla: 'breached', status: 'active' },
  resolved: { status: 'resolved' },
};

/**
 * The unified Client Inbox: every external conversation from every connected channel, worked
 * by agents, with internal notes kept apart from what clients see.
 */
export function ClientInboxScreen({
  me,
  directory,
  role,
}: {
  me: string;
  directory: Map<string, DirectoryEntry>;
  role: string;
}) {
  const supervisor = role === 'owner' || role === 'admin';
  const [tab, setTab] = React.useState<Tab>('inbox');
  const [view, setView] = React.useState<View>('active');
  const [q, setQ] = React.useState('');
  const [provider, setProvider] = React.useState('');
  const query = React.useMemo<ListInboxQuery>(
    () => ({
      ...VIEW_QUERY[view],
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(provider ? { provider: provider as ListInboxQuery['provider'] } : {}),
    }),
    [view, q, provider],
  );
  const data = useInboxData(query);
  const { api, online } = data;
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const loaded = useInboxDetail(api, activeId, online, data.tick);
  const { setDetail, reload } = loaded;
  // Queued (not yet confirmed) changes from this device show at once.
  const detail = loaded.detail
    ? { ...loaded.detail, conversation: data.overlay(loaded.detail.conversation) }
    : null;
  // Opening a conversation, or a new client message arriving while it is open, marks it read
  // on every device of this agent (queued, so it also works offline).
  const unreadOpen = loaded.detail?.conversation.unread ? loaded.detail.conversation : null;
  React.useEffect(() => {
    if (unreadOpen) void data.markRead(unreadOpen.conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOpen?.conversationId, unreadOpen?.lastMessage?.at]);
  const [settings, setSettings] = React.useState<InboxSettings | null>(null);
  const [templates, setTemplates] = React.useState<InboxTemplate[]>([]);
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [starting, setStarting] = React.useState(false);
  const [adminTick, setAdminTick] = React.useState(0);
  // Channels, templates or settings changed on any device: read them again.
  useTenantChange('inbox', () => setAdminTick((t) => t + 1));

  React.useEffect(() => {
    if (!online) return;
    void api.settings().then(setSettings, () => undefined);
    void api.templates().then(setTemplates, () => undefined);
    void api.connectors().then(setConnectors, () => undefined);
  }, [api, online, tab, adminTick]);

  const items = data.list ? data.list.items.map(data.overlay) : null;
  React.useEffect(() => {
    if (!activeId && items?.length && typeof window !== 'undefined' && window.innerWidth >= 1024)
      setActiveId(items[0]!.conversationId);
  }, [items, activeId]);

  const counts = data.list?.counts;
  const anyTest = connectors.some((c) => c.environment === 'test');
  const handoffConnectors = connectors.filter(
    (c) => CONNECTOR_CATALOG[c.provider].mode === 'handoff',
  );
  const openConversation = (id: string) => {
    setTab('inbox');
    setView('active');
    setActiveId(id);
  };

  if (data.error?.code === 'FORBIDDEN')
    return (
      <main className="flex flex-1 items-center justify-center pb-16 md:pb-0">
        <StateView
          state="permission-denied"
          description="The Client Inbox is for members of your organization. Ask an admin for access."
        />
      </main>
    );

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" aria-label="Client Inbox">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <Inbox className="size-5 text-accent" />
        <h1 className="font-display text-h3 text-text">Client Inbox</h1>
        {anyTest ? <TestModeBadge className="hidden sm:inline-flex" /> : null}
        <nav
          className="ml-2 flex items-center gap-1"
          role="tablist"
          aria-label="Client Inbox sections"
        >
          {(
            [
              ['inbox', 'Conversations', Inbox, true],
              ['dashboard', 'Dashboard', LayoutDashboard, supervisor],
              ['channels', 'Channels', Plug, supervisor],
              ['settings', 'Settings', Settings2, supervisor],
            ] as const
          )
            .filter((x) => x[3])
            .map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-label transition-colors',
                  tab === id
                    ? 'bg-surface-raised text-text shadow-sm'
                    : 'text-text-muted hover:text-text',
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
        </nav>
        <div className="flex-1" />
        {tab === 'inbox' && handoffConnectors.length ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setStarting(true)}
            disabled={!online}
          >
            <Plus /> <span className="hidden md:inline">Log a conversation</span>
          </Button>
        ) : null}
      </header>

      {tab === 'dashboard' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InboxDashboard
            api={api}
            directory={directory}
            online={online}
            onOpen={openConversation}
          />
        </div>
      ) : tab === 'channels' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChannelsPanel
            api={api}
            online={online}
            settings={settings}
            onOpenConversation={openConversation}
          />
        </div>
      ) : tab === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InboxSettingsPanel
            api={api}
            directory={directory}
            settings={settings}
            onSaved={setSettings}
            online={online}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section
            className={cn(
              'flex w-full shrink-0 flex-col border-r border-border lg:w-[360px]',
              activeId ? 'hidden lg:flex' : 'flex',
            )}
            aria-label="Client conversations"
          >
            <div className="space-y-2.5 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search clients, subjects, tags"
                  className="h-9 pl-9"
                  aria-label="Search the inbox"
                />
              </div>
              <Segmented
                label="Inbox view"
                value={view}
                onChange={setView}
                options={[
                  { id: 'mine', label: 'Mine', count: counts?.mine },
                  { id: 'unassigned', label: 'Unassigned', count: counts?.unassigned },
                  { id: 'active', label: 'All open', count: counts?.active },
                  { id: 'breached', label: 'Overdue', count: counts?.breached, tone: 'danger' },
                  { id: 'resolved', label: 'Resolved' },
                ]}
              />
              <select
                className={cn(selectClass, 'w-full')}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                aria-label="Channel"
              >
                <option value="">All channels</option>
                {[...new Set(connectors.map((c) => c.provider))].map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_META[p].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {items === null ? (
                <StateView
                  state={online ? 'loading' : 'offline'}
                  description={
                    online ? undefined : 'Your cached inbox appears here once it has loaded online.'
                  }
                />
              ) : items.length === 0 ? (
                <StateView
                  state="empty"
                  title={
                    view === 'mine'
                      ? 'Nothing assigned to you'
                      : view === 'breached'
                        ? 'No overdue clients'
                        : 'No conversations'
                  }
                  description={
                    connectors.length
                      ? 'New client messages from your channels land here.'
                      : supervisor
                        ? 'Connect a channel first. Test mode works without real credentials.'
                        : 'An admin needs to connect a client channel.'
                  }
                  action={
                    !connectors.length && supervisor ? (
                      <Button size="sm" onClick={() => setTab('channels')}>
                        <Plug /> Connect a channel
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul data-testid="inbox-list">
                  {items.map((c) => (
                    <ConversationRow
                      key={c.conversationId}
                      c={c}
                      active={c.conversationId === activeId}
                      directory={directory}
                      me={me}
                      onSelect={() => setActiveId(c.conversationId)}
                    />
                  ))}
                </ul>
              )}
            </div>
            {!online ? (
              <p className="border-t border-border bg-warning/8 px-4 py-2 text-meta text-warning">
                Offline: showing your cached inbox. Replies, notes and changes are saved and sent on
                reconnect.
              </p>
            ) : null}
          </section>

          {activeId && detail ? (
            <>
              <InboxConversationView
                detail={detail}
                me={me}
                directory={directory}
                api={api}
                online={online}
                pending={data.outbox}
                templates={templates}
                onEnqueue={data.enqueue}
                onDiscardPending={(id) => data.discard(id)}
                onRetryPending={(id) => data.retry(id)}
                onChanged={(d?: InboxConversationDetail) => (
                  d ? setDetail(d) : void reload(),
                  void data.refresh()
                )}
                onBack={() => setActiveId(null)}
              />
              <ClientPanel
                detail={detail}
                me={me}
                directory={directory}
                api={api}
                settings={settings}
                online={online}
                onChanged={(d) => (setDetail(d), void data.refresh())}
                onQueueUpdate={data.queueUpdate}
              />
            </>
          ) : (
            <div className="hidden flex-1 lg:flex">
              <StateView
                state={activeId ? 'loading' : 'empty'}
                title={activeId ? 'Loading conversation' : 'Pick a conversation'}
                className="m-auto"
              />
            </div>
          )}
        </div>
      )}

      {starting ? (
        <StartHandoffDialog
          connectors={handoffConnectors}
          onClose={() => setStarting(false)}
          onCreate={async (body) => {
            const d = await api.createHandoff(body);
            setStarting(false);
            void data.refresh();
            openConversation(d.conversation.conversationId);
          }}
        />
      ) : null}
    </main>
  );
}

function ConversationRow({
  c,
  active,
  directory,
  me,
  onSelect,
}: {
  c: InboxConversation;
  active: boolean;
  directory: Map<string, DirectoryEntry>;
  me: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors',
          active ? 'bg-accent-soft/60' : 'hover:bg-surface-raised/60',
          c.sla.state === 'breached' &&
            'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-danger',
        )}
      >
        <div className="relative">
          <Avatar name={c.client.name} />
          <ProviderMark
            provider={c.provider}
            size="sm"
            className="absolute -bottom-1 -right-1 rounded-[5px] ring-2 ring-bg"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'truncate text-label',
                c.unread ? 'font-semibold text-text' : 'text-text',
              )}
            >
              {c.client.name}
            </span>
            {c.client.company ? (
              <span className="hidden truncate text-meta text-text-subtle xl:inline">
                {c.client.company}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-meta text-text-subtle">
              {relTime(c.lastMessage?.at ?? c.updatedAt)}
            </span>
          </div>
          <p className="truncate text-meta text-text-muted">{c.subject}</p>
          <p
            className={cn(
              'mt-0.5 line-clamp-1 text-label font-normal',
              c.unread ? 'text-text' : 'text-text-subtle',
            )}
          >
            {c.lastMessage?.direction === 'outbound' ? 'You: ' : ''}
            {c.lastMessage?.preview ?? ''}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <PriorityDot priority={c.priority} />
            <SlaPill sla={c.sla} compact />
            {c.escalation ? (
              <span className="rounded-full bg-danger/12 px-1.5 text-meta text-danger">
                L{c.escalation.level}
              </span>
            ) : null}
            {c.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="truncate rounded-full bg-surface-raised px-1.5 text-meta text-text-subtle"
              >
                #{t}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              {c.awaitingReply ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-fg">
                  {c.awaitingReply}
                </span>
              ) : null}
              {c.assigneeId ? (
                <span
                  title={c.assigneeId === me ? 'Assigned to you' : nameOf(c.assigneeId, directory)}
                >
                  <Avatar name={nameOf(c.assigneeId, directory)} size="xs" />
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function StartHandoffDialog({
  connectors,
  onClose,
  onCreate,
}: {
  connectors: Connector[];
  onClose: () => void;
  onCreate: (b: {
    connectorId: string;
    clientName: string;
    handle: string;
    subject: string;
    firstMessage?: string;
  }) => Promise<void>;
}) {
  const { toast } = useToast();
  const [connectorId, setConnectorId] = React.useState(connectors[0]?.connectorId ?? '');
  const [clientName, setClientName] = React.useState('');
  const [handle, setHandle] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [firstMessage, setFirstMessage] = React.useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Log a conversation"
        description="For handoff channels like Signal and iMessage: record a conversation the client started in their own app."
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onCreate({
                connectorId,
                clientName,
                handle,
                subject,
                ...(firstMessage.trim() ? { firstMessage } : {}),
              });
            } catch (err) {
              toast({
                title: 'Could not start',
                description: (err as Error).message,
                tone: 'danger',
              });
            }
          }}
        >
          <Field label="Channel" htmlFor="ho-ch">
            <select
              id="ho-ch"
              className={cn(selectClass, 'w-full')}
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
            >
              {connectors.map((c) => (
                <option key={c.connectorId} value={c.connectorId}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client name" htmlFor="ho-name">
              <Input
                id="ho-name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </Field>
            <Field label="Phone or Apple ID" htmlFor="ho-handle">
              <Input
                id="ho-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="+44 7700 900123"
              />
            </Field>
          </div>
          <Field label="Subject" htmlFor="ho-subj">
            <Input id="ho-subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="What they wrote (optional)" htmlFor="ho-first">
            <Input
              id="ho-first"
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!connectorId || !clientName.trim() || !handle.trim() || !subject.trim()}
            >
              Start
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
