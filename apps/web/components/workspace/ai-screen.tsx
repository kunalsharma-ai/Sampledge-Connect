'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  BellRing,
  Bot,
  CopyCheck,
  ExternalLink,
  FileText,
  Gauge,
  Lock,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  AiDigest,
  AiPrioritizedNotifications,
  AiSearchHit,
  Conversation,
  Notification,
} from '@sampledge/contracts';
import { Avatar, Badge, Button, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { aiErrorText, type AiApi } from '@/lib/ai';
import { ActionItemRow, EngineBadge } from './ai-parts';
import { avatarOf, conversationTitle, nameOf, relativeShort } from './helpers';

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; sources: AiSearchHit[]; engine: string };

type Tab = 'attention' | 'status' | 'search';

const PROMPTS = [
  'What did we decide about pricing?',
  'What is still blocking the bid?',
  'Who is preparing the proposal deck?',
];

function where(c: Conversation | undefined, me: string, dir: Map<string, DirectoryEntry>) {
  if (!c) return 'a conversation';
  const t = conversationTitle(c, me, dir);
  return c.kind === 'dm' ? `your DM with ${t.split(' ')[0]}` : c.kind === 'group' ? t : `#${t}`;
}

function SourceCard({
  hit,
  conversations,
  me,
  directory,
  onOpen,
  index,
}: {
  hit: AiSearchHit;
  conversations: Map<string, Conversation>;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpen: (conversationId: string) => void;
  index?: number;
}) {
  return (
    <button
      onClick={() => onOpen(hit.conversationId)}
      className="group flex w-full items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-sm"
    >
      {index !== undefined ? (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
          {index}
        </span>
      ) : (
        <Avatar
          name={nameOf(hit.senderId, directory)}
          src={avatarOf(hit.senderId, directory)}
          size="xs"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-meta text-text-subtle">
          <span className="font-semibold text-text">
            {nameOf(hit.senderId, directory).split(' ')[0]}
          </span>
          in {where(conversations.get(hit.conversationId), me, directory)} ·{' '}
          {relativeShort(hit.createdAt)}
          {hit.fromTranscript ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
              <FileText className="size-2.5" /> Transcript
            </span>
          ) : null}
          <ExternalLink className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 line-clamp-2 block text-label font-normal text-text">
          {hit.text}
        </span>
      </span>
    </button>
  );
}

/** The AI Assistant module: ask, needs-attention ranking, status digest, semantic search. */
export function AiScreen({
  ai,
  conversations,
  notifications,
  me,
  directory,
  onOpenConversation,
}: {
  ai: AiApi;
  conversations: Conversation[];
  notifications: Notification[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpenConversation: (id: string) => void;
}) {
  const byId = React.useMemo(
    () => new Map(conversations.map((c) => [c.conversationId, c])),
    [conversations],
  );
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [question, setQuestion] = React.useState('');
  const [asking, setAsking] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('attention');
  /** Phones show one pane at a time. */
  const [pane, setPane] = React.useState<'ask' | 'tools'>('ask');
  const [error, setError] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const status = ai.status;

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, asking]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || asking) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text }]);
    setQuestion('');
    setAsking(true);
    setError(null);
    try {
      const r = await ai.ask(text, history);
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: r.answer, sources: r.sources, engine: r.engine },
      ]);
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setAsking(false);
    }
  };

  const unavailable = !ai.online
    ? {
        state: 'offline' as const,
        title: 'The assistant needs a connection',
        description:
          'Your messages and drafts still work offline. AI features come back when you reconnect.',
      }
    : status && !status.enabled
      ? {
          state: 'permission-denied' as const,
          title: 'The assistant is turned off',
          description: status.canManage
            ? 'Turn it on for your organization with the switch above.'
            : 'Your organization’s admin turned the AI assistant off.',
        }
      : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <span className="flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent2 text-accent-fg shadow-sm">
          <Bot className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-h3 text-text">AI Assistant</h1>
          <p className="hidden truncate text-meta text-text-subtle sm:block">
            Private to your organization. It only reads what you can read.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status ? <EngineBadge engine={status.engine} className="hidden sm:inline-flex" /> : null}
          {status?.canManage ? (
            <label className="flex items-center gap-2 text-meta text-text-muted">
              <span className="hidden sm:inline">On for everyone</span>
              <button
                role="switch"
                aria-checked={status.enabled}
                aria-label="AI assistant for the organization"
                disabled={!ai.online}
                onClick={() => void ai.setEnabled(!status.enabled).catch(() => undefined)}
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors disabled:opacity-50',
                  status.enabled ? 'bg-accent' : 'bg-border-strong',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform',
                    status.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                  )}
                />
              </button>
            </label>
          ) : null}
        </div>
      </header>

      {unavailable ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <StateView {...unavailable} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1">
          <div className="flex gap-1 border-b border-border px-3 py-2 lg:hidden">
            {(
              [
                { id: 'ask', label: 'Ask' },
                { id: 'tools', label: 'Needs you · Status · Search' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => setPane(p.id)}
                aria-pressed={pane === p.id}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-meta transition-colors',
                  pane === p.id ? 'bg-accent-soft text-text' : 'text-text-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Ask */}
          <section
            aria-label="Ask the assistant"
            className={cn(
              'min-h-0 flex-col border-border lg:flex lg:border-r',
              pane === 'ask' ? 'flex' : 'hidden',
            )}
          >
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              {turns.length === 0 ? (
                <div className="mx-auto max-w-xl pt-6 text-center">
                  <motion.span
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-accent-fg shadow-lg"
                  >
                    <Sparkles className="size-6" />
                  </motion.span>
                  <h2 className="mt-5 font-display text-h2 text-text">Ask about your work</h2>
                  <p className="mt-2 text-label font-normal text-text-muted">
                    Answers come from conversations you can read, with links to every source. The
                    assistant drafts; you decide what gets sent.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => void ask(p)}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-text transition-all hover:-translate-y-px hover:border-accent hover:bg-accent-soft"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <ul className="mx-auto mt-8 hidden max-w-lg gap-2 text-left sm:grid sm:grid-cols-3">
                    {[
                      { icon: Lock, t: 'Your access only', d: 'Never sees chats you can’t open.' },
                      { icon: ShieldCheck, t: 'Confirm first', d: 'Nothing is sent without you.' },
                      { icon: Plug, t: 'Self-hosted', d: 'Runs on your own servers.' },
                    ].map((x) => (
                      <li
                        key={x.t}
                        className="rounded-lg border border-border bg-surface-raised p-3"
                      >
                        <x.icon className="size-4 text-accent" />
                        <p className="mt-2 text-label text-text">{x.t}</p>
                        <p className="text-meta text-text-subtle">{x.d}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  <AnimatePresence initial={false}>
                    {turns.map((t, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className={cn('flex gap-3', t.role === 'user' && 'justify-end')}
                      >
                        {t.role === 'assistant' ? (
                          <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent2 text-accent-fg">
                            <Bot className="size-3.5" />
                          </span>
                        ) : null}
                        <div
                          className={cn('min-w-0', t.role === 'user' ? 'max-w-[80%]' : 'flex-1')}
                        >
                          <div
                            className={cn(
                              'whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-message shadow-sm',
                              t.role === 'user'
                                ? 'rounded-tr-sm bg-bubble-own text-bubble-own-fg'
                                : 'rounded-tl-sm border border-border bg-bubble-other text-text',
                            )}
                          >
                            {t.text}
                          </div>
                          {t.role === 'assistant' && t.sources.length ? (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-overline uppercase text-text-subtle">Sources</p>
                              {t.sources.slice(0, 5).map((s, j) => (
                                <SourceCard
                                  key={s.messageId}
                                  hit={s}
                                  index={j + 1}
                                  conversations={byId}
                                  me={me}
                                  directory={directory}
                                  onOpen={onOpenConversation}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {asking ? (
                    <div className="flex items-center gap-3 text-meta text-text-subtle">
                      <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <Bot className="size-3.5 animate-pulse motion-reduce:animate-none" />
                      </span>
                      Reading conversations you can access…
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(question);
              }}
              className="border-t border-border p-3 sm:px-8"
            >
              {error ? (
                <p className="mx-auto mb-2 max-w-2xl text-meta text-danger">{error}</p>
              ) : null}
              <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-surface-raised p-2 shadow-sm focus-within:border-accent">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                  rows={1}
                  maxLength={1000}
                  placeholder="Ask about decisions, owners, deadlines…"
                  aria-label="Ask the assistant"
                  className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-message text-text outline-none placeholder:text-text-subtle"
                />
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Ask"
                  disabled={!question.trim()}
                  loading={asking}
                >
                  <ArrowUp />
                </Button>
              </div>
              {status?.engine === 'basic' ? (
                <p className="mx-auto mt-2 max-w-2xl text-center text-meta text-text-subtle">
                  Built-in mode finds the right messages. For written answers and translation,
                  connect your model server in Administration › Integrations.
                </p>
              ) : null}
            </form>
          </section>

          {/* Side tools */}
          <aside className={cn('min-h-0 flex-col lg:flex', pane === 'tools' ? 'flex' : 'hidden')}>
            <div
              role="tablist"
              aria-label="Assistant tools"
              className="flex shrink-0 gap-1 border-b border-border px-3 py-2"
            >
              {(
                [
                  { id: 'attention', label: 'Needs you', icon: BellRing },
                  { id: 'status', label: 'Status', icon: Gauge },
                  { id: 'search', label: 'Search', icon: Search },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-meta transition-colors',
                    tab === t.id
                      ? 'bg-accent-soft text-text'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text',
                  )}
                >
                  <t.icon className="size-3.5" /> {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === 'attention' ? (
                <AttentionTab
                  ai={ai}
                  notifications={notifications}
                  byId={byId}
                  me={me}
                  directory={directory}
                  onOpen={onOpenConversation}
                />
              ) : tab === 'status' ? (
                <StatusTab
                  ai={ai}
                  byId={byId}
                  me={me}
                  directory={directory}
                  onOpen={onOpenConversation}
                />
              ) : (
                <SearchTab
                  ai={ai}
                  byId={byId}
                  me={me}
                  directory={directory}
                  onOpen={onOpenConversation}
                />
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

type TabProps = {
  ai: AiApi;
  byId: Map<string, Conversation>;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpen: (id: string) => void;
};

const PRIORITY_TONE = { high: 'danger', normal: 'accent', low: 'neutral' } as const;

function AttentionTab({
  ai,
  notifications,
  byId,
  me,
  directory,
  onOpen,
}: TabProps & { notifications: Notification[] }) {
  const [data, setData] = React.useState<AiPrioritizedNotifications | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const unreadKey = notifications
    .filter((n) => !n.readAt)
    .map((n) => n.notificationId)
    .join(',');
  React.useEffect(() => {
    ai.priority().then(setData, (e) => setError(aiErrorText(e)));
  }, [ai, unreadKey]);
  const byNotif = new Map(notifications.map((n) => [n.notificationId, n]));
  if (error)
    return <StateView state="error" title="Couldn’t rank notifications" description={error} />;
  if (!data) return <StateView state="loading" />;
  const items = data.items.filter((i) => byNotif.has(i.notificationId));
  if (!items.length)
    return (
      <StateView
        state="empty"
        title="Nothing needs you right now"
        description="Unread mentions and replies are ranked here by urgency."
      />
    );
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const n = byNotif.get(i.notificationId)!;
        return (
          <li key={i.notificationId}>
            <button
              onClick={() => onOpen(n.conversationId)}
              className="w-full rounded-lg border border-border bg-surface p-3 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-sm"
            >
              <span className="flex items-center gap-2">
                <Avatar
                  name={nameOf(n.actorId, directory)}
                  src={avatarOf(n.actorId, directory)}
                  size="xs"
                />
                <span className="min-w-0 flex-1 truncate text-meta text-text-muted">
                  <span className="font-semibold text-text">{nameOf(n.actorId, directory)}</span> in{' '}
                  {where(byId.get(n.conversationId), me, directory)}
                </span>
                <Badge tone={PRIORITY_TONE[i.priority]} className="px-1.5 text-[10px] capitalize">
                  {i.priority}
                </Badge>
              </span>
              <span className="mt-1.5 line-clamp-2 block text-label font-normal text-text">
                {n.preview}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {i.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] text-text-subtle"
                  >
                    {r}
                  </span>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_STYLE = {
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  on_track: { label: 'On track', tone: 'success' },
  quiet: { label: 'Quiet', tone: 'neutral' },
} as const;

function StatusTab({ ai, byId, me, directory, onOpen }: TabProps) {
  const [hours, setHours] = React.useState(168);
  const [data, setData] = React.useState<AiDigest | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(
    async (h: number) => {
      setBusy(true);
      setError(null);
      try {
        setData(await ai.digest(h));
      } catch (e) {
        setError(aiErrorText(e));
      } finally {
        setBusy(false);
      }
    },
    [ai],
  );
  React.useEffect(() => void load(168), [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-text">Status across your conversations</p>
        <select
          value={hours}
          onChange={(e) => {
            setHours(Number(e.target.value));
            void load(Number(e.target.value));
          }}
          aria-label="Period"
          className="rounded-md border border-border bg-surface px-2 py-1 text-meta text-text"
        >
          <option value={24}>Last 24 hours</option>
          <option value={168}>Last 7 days</option>
          <option value={336}>Last 14 days</option>
        </select>
      </div>
      <p className="text-meta text-text-subtle">
        Project-level status arrives when Samptrek projects are linked (Phase 2). Until then this
        covers your active chats.
      </p>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {!data ? (
        <StateView state="loading" />
      ) : (
        <div className={cn('space-y-2', busy && 'opacity-60')}>
          {data.items.length === 0 ? (
            <StateView state="empty" title="No recent activity" />
          ) : (
            data.items.map((i) => {
              const s = STATUS_STYLE[i.status];
              return (
                <button
                  key={i.conversationId}
                  onClick={() => onOpen(i.conversationId)}
                  className="w-full rounded-lg border border-border bg-surface p-3 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-label text-text">
                      {where(byId.get(i.conversationId), me, directory)}
                    </span>
                    <Badge tone={s.tone} className="px-1.5 text-[10px]">
                      {s.label}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-meta text-text-muted">{i.summary}</span>
                </button>
              );
            })
          )}
          {data.suggestedTasks.length ? (
            <div className="pt-2">
              <p className="mb-1.5 flex items-center justify-between text-overline uppercase text-text-subtle">
                Suggested tasks
                <Badge tone="planned" className="px-1.5 text-[10px] normal-case">
                  Create task · Planned Phase 2
                </Badge>
              </p>
              <ul className="space-y-1.5">
                {data.suggestedTasks.slice(0, 8).map((t) => (
                  <ActionItemRow
                    key={`${t.conversationId}-${t.text}`}
                    item={t}
                    directory={directory}
                    me={me}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchTab({ ai, byId, me, directory, onOpen }: TabProps) {
  const [mode, setMode] = React.useState<'search' | 'duplicates'>('search');
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<AiSearchHit[] | null>(null);
  const [pending, setPending] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async () => {
    if (q.trim().length < (mode === 'search' ? 2 : 8)) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'search') {
        const r = await ai.search(q.trim());
        setHits(r.hits);
        setPending(r.pendingIndex);
      } else {
        setHits((await ai.duplicates(q.trim())).matches);
        setPending(0);
      }
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-border bg-surface p-0.5">
        {(
          [
            { id: 'search', label: 'Search by meaning', icon: Search },
            { id: 'duplicates', label: 'Asked before?', icon: CopyCheck },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              setHits(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-meta transition-colors',
              mode === m.id ? 'bg-accent-soft text-text' : 'text-text-muted hover:text-text',
            )}
          >
            <m.icon className="size-3.5" /> {m.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            mode === 'search'
              ? 'e.g. panel pricing for Germany'
              : 'Paste the question you’re about to ask'
          }
          aria-label={mode === 'search' ? 'Search by meaning' : 'Check for duplicates'}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-label font-normal text-text outline-none focus:border-accent"
        />
        <Button type="submit" size="sm" loading={busy}>
          {mode === 'search' ? 'Search' : 'Check'}
        </Button>
      </form>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {hits === null ? (
        <p className="text-meta text-text-subtle">
          {mode === 'search'
            ? 'Finds messages by what they mean, not just exact words, across every conversation you can read.'
            : 'Before posting a question, see if someone already asked or answered it.'}
        </p>
      ) : hits.length === 0 ? (
        <StateView
          state="empty"
          title={mode === 'search' ? 'No matches' : 'Looks new'}
          description={
            mode === 'search'
              ? 'Try different words.'
              : 'Nobody has asked this in conversations you can read.'
          }
        />
      ) : (
        <div className="space-y-1.5">
          {mode === 'duplicates' ? (
            <p className="text-meta text-warning">Similar messages already exist:</p>
          ) : null}
          {hits.map((h) => (
            <SourceCard
              key={h.messageId}
              hit={h}
              conversations={byId}
              me={me}
              directory={directory}
              onOpen={onOpen}
            />
          ))}
          {pending > 0 ? (
            <p className="text-meta text-text-subtle">
              {pending} newer messages are still being indexed.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
