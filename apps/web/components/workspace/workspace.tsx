'use client';
import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Hash,
  Lock,
  MessageSquarePlus,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
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
  useReceipts,
  useUnreadCounts,
} from '@/lib/engine';
import { CommandPalette } from './command-palette';
import { Composer } from './composer';
import { ContextPanel } from './context-panel';
import { ConversationList } from './conversation-list';
import { AdminDialog, NewConversationDialog, SettingsDialog, SyncCenterDialog } from './dialogs';
import { conversationTitle, nameOf } from './helpers';
import { MODULES, type ModuleId } from './modules';
import { NavRail } from './nav-rail';
import { Timeline } from './timeline';

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
  useTick(1000);

  const active = conversations?.find((c) => c.conversationId === activeId) ?? null;
  const messages = useMessages(activeId);
  const receipts = useReceipts(activeId) ?? [];
  const unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0);
  const directoryWithPresence = (() => {
    const m = new Map(directory);
    for (const [id, p] of engine.presence) {
      const u = m.get(id);
      if (u) m.set(id, { ...u, presence: p });
    }
    return m;
  })();

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
        onSignOut={() => void signOut()}
      />

      {mod.built ? (
        <>
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
                <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
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
                  onSend={async (text) => {
                    await engine.compose(active.conversationId, text);
                  }}
                  onTyping={(t) => engine.setTyping(active.conversationId, t)}
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
                />
              </div>
            ) : null}
          </AnimatePresence>
        </>
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

      <MobileNav active={module} onSelect={selectModule} unreadTotal={unreadTotal} />

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
          { id: 'a:theme', label: 'Change theme', icon: Palette, run: () => setDialog('settings') },
          ...(isAdmin
            ? [
                {
                  id: 'a:admin',
                  label: 'Administration',
                  icon: ShieldCheck,
                  run: () => setDialog('admin'),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

const MOBILE: ModuleId[] = ['messages', 'channels', 'notifications', 'settings'];

function MobileNav({
  active,
  onSelect,
  unreadTotal,
}: {
  active: ModuleId;
  onSelect: (m: ModuleId) => void;
  unreadTotal: number;
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
          </button>
        );
      })}
    </nav>
  );
}
