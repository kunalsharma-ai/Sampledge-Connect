'use client';
import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Bot,
  CalendarPlus,
  CheckSquare,
  FolderKanban,
  Hash,
  Lock,
  MessageSquarePlus,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Plug,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  ConnectivityIndicator,
  StateView,
  Tooltip,
  TypingIndicator,
  cn,
} from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import {
  useConversations,
  useEngine,
  useMessages,
  usePendingReactions,
  useReceipts,
  useUnreadCounts,
} from '@/lib/engine';
import type { LocalMessage } from '@sampledge/offline';
import { CommandPalette } from './command-palette';
import { Composer } from './composer';
import { ContextPanel } from './context-panel';
import { ConversationList } from './conversation-list';
import { AdminDialog, NewConversationDialog, SettingsDialog, SyncCenterDialog } from './dialogs';
import { conversationTitle, nameOf, senderNameOf } from './helpers';
import { MODULES, type ModuleId } from './modules';
import { NotificationsScreen } from './notifications-screen';
import { IntegrationsScreen } from './integrations-screen';
import { NotifyLevelMenu } from './notify-level-menu';
import { useNotifications } from '@/lib/notifications';
import { NavRail } from './nav-rail';
import { Timeline } from './timeline';
import { MeetingReminderToast, MeetingsScreen, NewMeetingDialog } from './meetings';
import { RecordingsScreen } from './recordings-screen';
import { AiScreen } from './ai-screen';
import { AiSummaryCard } from './ai-summary-card';
import { languageName, preferredLanguage, useAi } from '@/lib/ai';
import type { MeetingSystemMetadata } from '@sampledge/contracts';
import { CallButtons, CallErrorToast, CallStage, IncomingCall, LiveCallBanner } from './calls';
import { ProjectsScreen } from './projects-screen';
import { TasksScreen } from './tasks-screen';
import { ConversationWorkProvider } from './work-cards';
import { CreateTaskDialog, RequestApprovalDialog, type WorkSource } from './work-dialogs';

const LS_RAIL = 'sampledge.rail';
const LS_PANEL = 'sampledge.panel';

function useStoredBool(key: string, initial: boolean) {
  const [v, setV] = React.useState(initial);
  React.useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s !== null) setV(s === '1');
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = React.useCallback(
    (next: boolean) => {
      setV(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set] as const;
}

/** Re-render on an interval to read engine-held ephemeral state (typing, presence). */
function useTick(ms: number) {
  const [, setN] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function Workspace() {
  const { session } = useAuth();
  const { engine, state, directory, signOut } = useEngine();
  const me = session!.user.userId;
  const isAdmin = session!.user.role === 'owner' || session!.user.role === 'admin';
  const conversations = useConversations();
  const unread = useUnreadCounts(me);
  const [module, setModule] = React.useState<ModuleId>('messages');
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [railExpanded, setRailExpanded] = useStoredBool(LS_RAIL, true);
  const [panelOpen, setPanelOpen] = useStoredBool(LS_PANEL, true);
  const [dialog, setDialog] = React.useState<null | 'new' | 'sync' | 'settings' | 'admin'>(null);
  const [palette, setPalette] = React.useState(false);
  const [scheduleIn, setScheduleIn] = React.useState<string | null>(null);
  const [focusMeeting, setFocusMeeting] = React.useState<{
    meetingId: string;
    startsAt: string;
  } | null>(null);
  const [workDialog, setWorkDialog] = React.useState<{
    kind: 'task' | 'approval';
    source: WorkSource;
  } | null>(null);
  const openConversation = React.useCallback((id: string) => {
    setModule('messages');
    setActiveId(id);
  }, []);
  useTick(1000);

  const active = conversations?.find((c) => c.conversationId === activeId) ?? null;
  const messages = useMessages(activeId);
  const receipts = useReceipts(activeId) ?? [];
  const pendingReactions = usePendingReactions(activeId);
  const [replyTo, setReplyTo] = React.useState<LocalMessage | null>(null);
  React.useEffect(() => setReplyTo(null), [activeId]);
  const ai = useAi();
  const [prefill, setPrefill] = React.useState<{ text: string; nonce: number } | null>(null);
  React.useEffect(() => setPrefill(null), [activeId]);
  const unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0);
  const notifications = useNotifications();
  const unreadNotifIn = React.useMemo(
    () =>
      new Set((notifications.items ?? []).filter((n) => !n.readAt).map((n) => n.conversationId)),
    [notifications.items],
  );
  const { markRead: markNotificationsRead } = notifications;
  // Opening a conversation clears its mention and reply notifications.
  React.useEffect(() => {
    if (activeId && module !== 'notifications' && unreadNotifIn.has(activeId))
      void markNotificationsRead({ conversationId: activeId });
  }, [activeId, module, unreadNotifIn, markNotificationsRead]);
  const directoryWithPresence = (() => {
    const m = new Map(directory);
    for (const [id, p] of engine.presence) {
      const u = m.get(id);
      if (u) m.set(id, { ...u, presence: p });
    }
    return m;
  })();

  // Deep link: /app?c=<conversationId> (used by the chat widget's "Open in Connect").
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (!c) return;
    setModule('messages');
    setActiveId(c);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Open the most recent conversation on wide screens.
  React.useEffect(() => {
    if (activeId || !conversations?.length || window.innerWidth < 1024) return;
    const first = [...conversations].sort((a, b) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
    )[0];
    if (first) setActiveId(first.conversationId);
  }, [conversations, activeId]);

  // Mark read when viewing.
  const maxSeq =
    messages?.reduce(
      (m, x) => (x.serverSequence != null && x.senderId !== me ? Math.max(m, x.serverSequence) : m),
      0,
    ) ?? 0;
  React.useEffect(() => {
    if (!activeId || !maxSeq || document.visibilityState !== 'visible') return;
    void engine.markRead(activeId, maxSeq);
  }, [activeId, maxSeq, engine]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectModule = (m: ModuleId) => {
    if (m === 'settings') return setDialog('settings');
    if (m === 'admin') return setDialog('admin');
    setModule(m);
  };

  const mod = MODULES.find((m) => m.id === module)!;
  const typingNames = activeId
    ? engine
        .typingIn(activeId)
        .filter((id) => id !== me)
        .map((id) => nameOf(id, directory).split(' ')[0]!)
    : [];
  const offline = state.connectivity === 'offline';
  const readOnly = active ? active.myRole === null || !!active.archivedAt : false;

  return (
    <div className="flex h-dvh overflow-hidden">
      <NavRail
        active={module}
        onSelect={selectModule}
        expanded={railExpanded}
        onToggle={() => setRailExpanded(!railExpanded)}
        tenantName={session!.tenant.name}
        userName={session!.user.displayName}
        isAdmin={isAdmin}
        unreadTotal={unreadTotal}
        notificationCount={notifications.unreadCount}
        onSignOut={() => void signOut()}
      />

      {module === 'meetings' ? (
        <MeetingsScreen
          me={me}
          directory={directory}
          conversations={conversations ?? []}
          onOpenConversation={openConversation}
          focus={focusMeeting}
        />
      ) : module === 'recordings' ? (
        <RecordingsScreen
          me={me}
          directory={directory}
          isAdmin={isAdmin}
          online={state.connectivity === 'online'}
          onOpenConversation={openConversation}
        />
      ) : module === 'tasks' ? (
        <TasksScreen
          me={me}
          directory={directory}
          conversations={conversations ?? []}
          onOpenConversation={openConversation}
        />
      ) : module === 'projects' ? (
        <ProjectsScreen me={me} directory={directory} onOpenConversation={openConversation} />
      ) : module === 'ai' ? (
        <AiScreen
          ai={ai}
          conversations={conversations ?? []}
          notifications={notifications.items ?? []}
          me={me}
          directory={directory}
          onOpenConversation={openConversation}
        />
      ) : module === 'integrations' ? (
        <IntegrationsScreen online={state.connectivity === 'online'} />
      ) : module === 'notifications' ? (
        <NotificationsScreen
          api={notifications}
          conversations={conversations ?? []}
          me={me}
          directory={directory}
          onOpen={(n) => {
            if (!n.readAt) void notifications.markRead({ notificationIds: [n.notificationId] });
            setModule('messages');
            setActiveId(n.conversationId);
          }}
        />
      ) : mod.built ? (
        <ConversationWorkProvider conversationId={active?.conversationId ?? null} me={me}>
          <div
            className={cn(
              'h-full min-w-0 pb-16 md:pb-0 lg:block',
              active ? 'hidden' : 'block w-full lg:w-auto',
            )}
          >
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              onSelect={setActiveId}
              me={me}
              directory={directoryWithPresence}
              unread={unread}
              onNew={() => setDialog('new')}
              onOpenPalette={() => setPalette(true)}
              filter={module === 'channels' ? 'channels' : 'all'}
            />
          </div>

          <main
            className={cn(
              'relative min-w-0 flex-1 flex-col pb-16 md:pb-0 lg:flex',
              active ? 'flex' : 'hidden',
            )}
          >
            {active ? (
              <>
                <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
                  <button
                    onClick={() => setActiveId(null)}
                    aria-label="Back to conversations"
                    className="-ml-1 rounded-sm p-1.5 text-text-muted hover:bg-surface-raised lg:hidden"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  {active.kind === 'dm' ? (
                    <Avatar name={conversationTitle(active, me, directory)} size="sm" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                      {active.kind === 'channel_private' ? (
                        <Lock className="size-3.5" />
                      ) : active.kind === 'group' ? (
                        <Users className="size-3.5" />
                      ) : (
                        <Hash className="size-3.5" />
                      )}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate font-display text-h3 text-text">
                      {conversationTitle(active, me, directory)}
                    </h1>
                    <div className="h-4 min-w-0 text-meta text-text-subtle">
                      {typingNames.length ? (
                        <TypingIndicator names={typingNames} />
                      ) : (
                        <span className="block truncate">
                          {active.kind === 'dm'
                            ? (directory.get(active.memberIds.find((id) => id !== me) ?? '')
                                ?.title ?? 'Direct message')
                            : (active.topic ?? `${active.memberIds.length} members`)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setDialog('sync')} aria-label="Open Sync Center">
                    <ConnectivityIndicator
                      state={state.connectivity}
                      queued={state.queued}
                      compact
                    />
                  </button>
                  <Tooltip
                    content={offline ? 'Scheduling needs a connection' : 'Schedule a meeting here'}
                    side="bottom"
                  >
                    <span>
                      <button
                        className="rounded-sm p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-40"
                        aria-label="Schedule a meeting here"
                        disabled={offline || readOnly}
                        onClick={() => setScheduleIn(active.conversationId)}
                      >
                        <CalendarPlus className="size-4" />
                      </button>
                    </span>
                  </Tooltip>
                  <CallButtons conversation={active} offline={offline} readOnly={readOnly} />
                  <NotifyLevelMenu conversation={active} offline={offline} />
                  <Tooltip content={panelOpen ? 'Hide details' : 'Show details'} side="bottom">
                    <button
                      onClick={() => setPanelOpen(!panelOpen)}
                      aria-label={panelOpen ? 'Hide details' : 'Show details'}
                      className="hidden rounded-sm p-1.5 text-text-muted hover:bg-surface-raised hover:text-text min-[1400px]:block"
                    >
                      {panelOpen ? (
                        <PanelRightClose className="size-4" />
                      ) : (
                        <PanelRightOpen className="size-4" />
                      )}
                    </button>
                  </Tooltip>
                </header>
                <LiveCallBanner conversation={active} directory={directory} offline={offline} />
                {state.failed > 0 ? (
                  <button
                    onClick={() => setDialog('sync')}
                    className="border-b border-danger/30 bg-danger/10 px-6 py-2 text-left text-meta text-danger"
                  >
                    {state.failed} message{state.failed === 1 ? '' : 's'} couldn’t be sent. Open the
                    Sync Center to retry.
                  </button>
                ) : null}
                <Timeline
                  key={active.conversationId}
                  conversation={active}
                  messages={messages}
                  receipts={receipts}
                  me={me}
                  directory={directory}
                  onRetry={(id) => void engine.retry(id)}
                  onDiscard={(id) => void engine.discard(id)}
                  pendingReactions={pendingReactions}
                  onReact={(m, emoji, add) => {
                    if (m.messageId)
                      void engine.react(
                        { messageId: m.messageId, conversationId: m.conversationId },
                        emoji,
                        add ? 'add' : 'remove',
                      );
                  }}
                  onReply={(m) => setReplyTo(m)}
                  offline={offline}
                  onOpenMeeting={(meta: MeetingSystemMetadata) => {
                    setFocusMeeting({ meetingId: meta.meetingId, startsAt: meta.startsAt });
                    setModule('meetings');
                  }}
                  onCreateTask={
                    offline || readOnly
                      ? undefined
                      : (m) =>
                          setWorkDialog({
                            kind: 'task',
                            source: {
                              conversation: active,
                              messageId: m.messageId,
                              text: m.content.text,
                            },
                          })
                  }
                  onRequestApproval={
                    offline || readOnly
                      ? undefined
                      : (m) =>
                          setWorkDialog({
                            kind: 'approval',
                            source: {
                              conversation: active,
                              messageId: m.messageId,
                              text: m.content.text,
                            },
                          })
                  }
                  onTranslate={
                    ai.available
                      ? async (messageId) => {
                          const lang = preferredLanguage();
                          const r = await ai.translate(messageId, lang);
                          return { text: r.text, label: languageName(lang) };
                        }
                      : undefined
                  }
                />
                <Composer
                  placeholder={`Message ${active.kind === 'dm' ? conversationTitle(active, me, directory) : '#' + conversationTitle(active, me, directory)}`}
                  disabled={readOnly}
                  disabledReason={
                    active.archivedAt
                      ? 'This conversation is archived.'
                      : 'Join this channel to send messages.'
                  }
                  offline={offline}
                  conversationId={active.conversationId}
                  onSend={async (text, mentions, attachments) => {
                    const reply = replyTo?.messageId ?? null;
                    setReplyTo(null);
                    await engine.compose(active.conversationId, text, {
                      mentions,
                      replyToMessageId: reply,
                      attachments,
                    });
                  }}
                  members={active.memberIds
                    .filter((id) => id !== me && directory.has(id))
                    .map((id) => ({
                      userId: id,
                      displayName: directory.get(id)!.displayName,
                      subtitle: directory.get(id)!.title ?? undefined,
                    }))}
                  replyTo={
                    replyTo
                      ? {
                          name:
                            replyTo.senderId === me ? 'yourself' : senderNameOf(replyTo, directory),
                          text:
                            replyTo.content.text ||
                            `${replyTo.attachments?.length ?? 0} attachment(s)`,
                        }
                      : null
                  }
                  onCancelReply={() => setReplyTo(null)}
                  onTyping={(t) => engine.setTyping(active.conversationId, t)}
                  prefill={prefill}
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <StateView
                  state="empty"
                  title={
                    conversations?.length === 0 ? 'Your workspace is ready' : 'Pick a conversation'
                  }
                  description={
                    conversations?.length === 0
                      ? 'Start a direct message, a group, or a channel for your team.'
                      : 'Choose a conversation from the list, or press Ctrl+K to jump to one.'
                  }
                />
              </div>
            )}
          </main>

          <AnimatePresence>
            {active && panelOpen ? (
              <div key="panel" className="hidden min-[1400px]:block">
                <ContextPanel
                  conversation={active}
                  me={me}
                  directory={directory}
                  presence={engine.presence}
                  onClose={() => setPanelOpen(false)}
                  aiCard={
                    ai.status?.enabled !== false ? (
                      <AiSummaryCard
                        ai={ai}
                        conversationId={active.conversationId}
                        where={
                          active.kind === 'dm'
                            ? conversationTitle(active, me, directory)
                            : `#${conversationTitle(active, me, directory)}`
                        }
                        me={me}
                        directory={directory}
                        canPost={!readOnly}
                        onUseReply={(text) => setPrefill({ text, nonce: Date.now() })}
                      />
                    ) : null
                  }
                />
              </div>
            ) : null}
          </AnimatePresence>
        </ConversationWorkProvider>
      ) : (
        <main className="flex flex-1 items-center justify-center p-6 pb-20 md:pb-6">
          <div className="max-w-md text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-xl border border-dashed border-border-strong text-text-subtle">
              <mod.icon className="size-6" />
            </span>
            <h1 className="mt-5 font-display text-h2 text-text">{mod.label}</h1>
            <Badge tone="planned" className="mt-3">
              Planned · {mod.phase}
            </Badge>
            <p className="mt-4 text-label font-normal text-text-muted">
              This module isn’t built yet. It’s listed so the navigation matches the product plan,
              and nothing here is simulated.
            </p>
          </div>
        </main>
      )}

      <IncomingCall conversations={conversations ?? []} me={me} directory={directory} />
      <CallStage
        conversations={conversations ?? []}
        me={me}
        directory={directory}
        onOpenConversation={(id) => {
          setModule('messages');
          setActiveId(id);
        }}
      />
      <CallErrorToast />
      <MeetingReminderToast onOpenConversation={openConversation} />
      <NewMeetingDialog
        open={!!scheduleIn}
        onOpenChange={(o) => !o && setScheduleIn(null)}
        me={me}
        directory={directory}
        conversationId={scheduleIn ?? undefined}
        onCreated={(m) => {
          setFocusMeeting({ meetingId: m.meetingId, startsAt: m.startsAt });
          setModule('meetings');
        }}
      />

      <CreateTaskDialog
        open={workDialog?.kind === 'task'}
        onOpenChange={(o) => !o && setWorkDialog(null)}
        source={workDialog?.source ?? null}
        me={me}
        directory={directory}
      />
      <RequestApprovalDialog
        open={workDialog?.kind === 'approval'}
        onOpenChange={(o) => !o && setWorkDialog(null)}
        source={workDialog?.source ?? null}
        me={me}
        directory={directory}
      />

      <MobileNav
        active={module}
        onSelect={selectModule}
        unreadTotal={unreadTotal}
        notificationCount={notifications.unreadCount}
      />

      <NewConversationDialog
        open={dialog === 'new'}
        onOpenChange={(o) => setDialog(o ? 'new' : null)}
        onCreated={(id) => {
          setModule('messages');
          setActiveId(id);
        }}
      />
      <SyncCenterDialog
        open={dialog === 'sync'}
        onOpenChange={(o) => setDialog(o ? 'sync' : null)}
      />
      <SettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(o) => setDialog(o ? 'settings' : null)}
      />
      {isAdmin ? (
        <AdminDialog
          open={dialog === 'admin'}
          onOpenChange={(o) => setDialog(o ? 'admin' : null)}
        />
      ) : null}
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        conversations={conversations ?? []}
        me={me}
        directory={directory}
        onSelect={(id) => {
          setModule('messages');
          setActiveId(id);
        }}
        actions={[
          {
            id: 'a:new',
            label: 'New conversation',
            icon: MessageSquarePlus,
            run: () => setDialog('new'),
          },
          {
            id: 'a:sync',
            label: 'Open Sync Center',
            icon: RefreshCw,
            run: () => setDialog('sync'),
          },
          {
            id: 'a:tasks',
            label: 'Tasks & Approvals',
            icon: CheckSquare,
            run: () => setModule('tasks'),
          },
          {
            id: 'a:projects',
            label: 'Projects',
            icon: FolderKanban,
            run: () => setModule('projects'),
          },
          { id: 'a:theme', label: 'Change theme', icon: Palette, run: () => setDialog('settings') },
          { id: 'a:ai', label: 'Ask the AI assistant', icon: Bot, run: () => setModule('ai') },
          ...(isAdmin
            ? [
                {
                  id: 'a:admin',
                  label: 'Administration',
                  icon: ShieldCheck,
                  run: () => setDialog('admin'),
                },
                {
                  id: 'a:integrations',
                  label: 'Manage integrations',
                  icon: Plug,
                  run: () => setModule('integrations'),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

const MOBILE: ModuleId[] = ['messages', 'tasks', 'meetings', 'notifications', 'settings'];

function MobileNav({
  active,
  onSelect,
  unreadTotal,
  notificationCount,
}: {
  active: ModuleId;
  onSelect: (m: ModuleId) => void;
  unreadTotal: number;
  notificationCount: number;
}) {
  return (
    <nav
      aria-label="Modules"
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-border bg-surface-glass backdrop-blur-xl md:hidden"
    >
      {MOBILE.map((id) => {
        const m = MODULES.find((x) => x.id === id)!;
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px]',
              on ? 'text-accent' : 'text-text-muted',
            )}
          >
            <m.icon className="size-5" />
            {m.label.split(' ')[0]}
            {id === 'messages' && unreadTotal > 0 ? (
              <span className="absolute right-[calc(50%-18px)] top-2 size-2 rounded-full bg-accent" />
            ) : null}
            {id === 'notifications' && notificationCount > 0 ? (
              <span className="absolute left-[calc(50%+4px)] top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-fg">
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
