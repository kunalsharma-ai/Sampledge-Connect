'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarClock,
  CheckSquare,
  Clock,
  CloudOff,
  CornerDownRight,
  FileText,
  Hash,
  Lock,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Search,
  Users,
  X,
} from 'lucide-react';
import type { Conversation, SearchResponse, SearchType } from '@sampledge/contracts';
import { Avatar, Badge, Button, Kbd, Skeleton, StateView, cn } from '@sampledge/ui';
import { motion as tokens } from '@sampledge/design-tokens';
import type { DirectoryEntry } from '@/lib/engine';
import {
  NO_FILTERS,
  useSearch,
  type DateRange,
  type SearchFilters,
  type SearchTab,
} from '@/lib/search';
import { conversationTitle, formatDay, formatTime, nameOf } from './helpers';

/** Wraps matched ranges in <mark>. */
export function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={i} className="rounded-[3px] bg-accent/20 px-0.5 font-medium text-text">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const TABS: { id: SearchTab; label: string; icon: typeof Search }[] = [
  { id: 'all', label: 'All', icon: Search },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: Paperclip },
  { id: 'people', label: 'People', icon: Users },
  { id: 'conversations', label: 'Channels & chats', icon: Hash },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'meetings', label: 'Meetings', icon: CalendarClock },
];
const RANGES: { id: DateRange; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'day', label: 'Past 24 hours' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
];
const TIPS = [
  { op: 'from:@ravi', text: 'messages and files from a person' },
  { op: 'in:#fieldwork', text: 'only inside one channel or chat' },
  { op: 'has:file', text: 'messages that carry an attachment' },
  { op: 'after:2026-10-01', text: 'on or after a date (also before:)' },
  { op: '"exact phrase"', text: 'words that must appear together' },
];

const fmtBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

export interface SearchScreenProps {
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  initialQuery?: { q: string; nonce: number } | null;
  onOpenMessage: (
    conversationId: string,
    messageId: string | null,
    threadRootId: string | null,
  ) => void;
  onOpenConversation: (conversationId: string) => void;
  onMessagePerson: (userId: string) => void;
  onOpenTasks: () => void;
  onOpenMeeting: (m: { meetingId: string; startsAt: string }) => void;
}

export function SearchScreen(props: SearchScreenProps) {
  const { conversations, me, directory } = props;
  const title = React.useCallback(
    (c: Conversation) => conversationTitle(c, me, directory),
    [me, directory],
  );
  const api = useSearch(conversations, title);
  const [q, setQ] = React.useState(props.initialQuery?.q ?? '');
  const [filters, setFilters] = React.useState<SearchFilters>(NO_FILTERS);
  const [tab, setTab] = React.useState<SearchTab>('all');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const byId = React.useMemo(
    () => new Map(conversations.map((c) => [c.conversationId, c])),
    [conversations],
  );

  // Search as you type (debounced); Enter also remembers it in recent searches.
  React.useEffect(() => {
    const t = setTimeout(() => void api.run(q, filters), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filters]);
  React.useEffect(() => {
    if (props.initialQuery) {
      setQ(props.initialQuery.q);
      void api.run(props.initialQuery.q, filters, { remember: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialQuery?.nonce]);
  React.useEffect(() => inputRef.current?.focus(), []);

  const r = api.result;
  const server = r?.server ?? null;
  const showLocal = !!r && !server;
  const count = (t: SearchType) =>
    server ? server[t].items.length : t === 'messages' && r ? r.local.length : 0;
  const plus = (t: SearchType) => (server?.[t].more ? '+' : '');
  const total = server
    ? (['messages', 'files', 'people', 'conversations', 'tasks', 'meetings'] as const).reduce(
        (n, t) => n + server[t].items.length,
        0,
      )
    : (r?.local.length ?? 0);

  const where = (conversationId: string) => {
    const c = byId.get(conversationId);
    if (!c) return 'a conversation';
    return c.kind === 'dm' ? title(c) : c.kind === 'group' ? title(c) : `#${title(c)}`;
  };

  const people = [...directory.values()]
    .filter((p) => p.status === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="search-screen">
      <header className="shrink-0 border-b border-border bg-surface/40 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-4xl px-4 pt-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Search className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-h3 text-text">Search</h1>
              <p className="text-meta text-text-subtle">
                Messages, files, people, channels, tasks and meetings you can open.
              </p>
            </div>
            {!api.online ? (
              <Badge tone="warning" className="gap-1">
                <CloudOff className="size-3.5" aria-hidden /> Offline
              </Badge>
            ) : null}
          </div>

          <form
            role="search"
            className="group relative mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void api.run(q, filters, { remember: true });
            }}
          >
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-subtle transition-colors group-focus-within:text-accent"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search everything… try from:@name, in:#channel, has:file"
              aria-label="Search everything"
              className="h-14 w-full rounded-xl border border-border bg-surface-sunken pl-12 pr-28 text-body text-text shadow-sm outline-none transition-[border-color,box-shadow] duration-[var(--sc-duration-fast)] placeholder:text-text-subtle focus:border-accent focus:shadow-[0_0_0_4px_var(--sc-color-accent-soft)]"
            />
            <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {api.loading ? (
                <span
                  className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
                  aria-label="Searching"
                />
              ) : null}
              {q ? (
                <button
                  type="button"
                  onClick={() => {
                    setQ('');
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-raised hover:text-text"
                >
                  <X className="size-4" />
                </button>
              ) : null}
              <Kbd className="hidden sm:inline-flex">Enter</Kbd>
            </span>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FilterSelect
              label="From"
              value={filters.from ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, from: v || null }))}
              options={[
                { value: '', label: 'Anyone' },
                ...people.map((p) => ({
                  value: p.userId,
                  label: p.userId === me ? `${p.displayName} (you)` : p.displayName,
                })),
              ]}
            />
            <FilterSelect
              label="In"
              value={filters.in ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, in: v || null }))}
              options={[
                { value: '', label: 'Anywhere' },
                ...conversations.map((c) => ({
                  value: c.conversationId,
                  label: where(c.conversationId),
                })),
              ]}
            />
            <FilterSelect
              label="Date"
              value={filters.range}
              onChange={(v) => setFilters((f) => ({ ...f, range: v as DateRange }))}
              options={RANGES.map((x) => ({ value: x.id, label: x.label }))}
            />
            <button
              type="button"
              aria-pressed={filters.hasFile}
              onClick={() => setFilters((f) => ({ ...f, hasFile: !f.hasFile }))}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta transition-colors',
                filters.hasFile
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text',
              )}
            >
              <Paperclip className="size-3.5" aria-hidden /> Has file
            </button>
            {filters !== NO_FILTERS &&
            (filters.from || filters.in || filters.hasFile || filters.range !== 'any') ? (
              <button
                type="button"
                onClick={() => setFilters(NO_FILTERS)}
                className="h-8 px-2 text-meta text-text-subtle underline-offset-2 hover:text-text hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <nav aria-label="Result types" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const n = t.id === 'all' ? total : count(t.id);
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-label transition-colors',
                    active ? 'text-text' : 'text-text-muted hover:text-text',
                  )}
                >
                  <t.icon className={cn('size-4', active && 'text-accent')} aria-hidden />
                  {t.label}
                  {r && n > 0 ? (
                    <span className="rounded-full bg-surface-raised px-1.5 text-meta tabular-nums text-text-subtle">
                      {n}
                      {t.id !== 'all' ? plus(t.id) : ''}
                    </span>
                  ) : null}
                  {active ? (
                    <motion.span
                      layoutId="search-tab"
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent"
                      transition={tokens.spring.gentle}
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
          {!r ? (
            <StartPanel
              recent={api.recent}
              onPick={(x) => {
                setQ(x);
                void api.run(x, filters, { remember: true });
              }}
              onRemove={api.removeRecent}
              onClear={api.clearRecent}
              onTip={(op) => {
                setQ((cur) => (cur ? `${cur} ${op}` : op));
                inputRef.current?.focus();
              }}
            />
          ) : (
            <>
              {r.unresolved.length ? (
                <p className="mb-3 text-meta text-warning">
                  No match for {r.unresolved.join(', ')}. That filter was ignored.
                </p>
              ) : null}
              {showLocal && !api.online ? (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-surface-raised/60 p-3 text-label font-normal text-text-muted">
                  <CloudOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    You’re offline, so this searches the messages saved on this device. Files,
                    people, tasks and meetings come back when you reconnect.
                  </span>
                </div>
              ) : null}
              {api.error ? (
                <p className="mb-3 text-meta text-danger" role="alert">
                  {api.error}
                </p>
              ) : null}
              <Results
                tab={tab}
                setTab={setTab}
                server={server}
                local={r.local}
                loading={api.loading}
                byId={byId}
                where={where}
                title={title}
                onMore={(t) => void api.more(t)}
                {...props}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const active = value !== '' && value !== 'any';
  return (
    <label
      className={cn(
        'relative flex h-8 items-center gap-1 rounded-full border pl-3 pr-2 text-meta transition-colors',
        active
          ? 'border-accent bg-accent-soft text-text'
          : 'border-border text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      <span className="text-text-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter: ${label}`}
        className="max-w-[160px] cursor-pointer truncate bg-transparent pr-1 text-meta text-text outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StartPanel({
  recent,
  onPick,
  onRemove,
  onClear,
  onTip,
}: {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
  onTip: (op: string) => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-label text-text">
            <Clock className="size-4 text-text-subtle" aria-hidden /> Recent searches
          </h2>
          {recent.length ? (
            <button onClick={onClear} className="text-meta text-text-subtle hover:text-text">
              Clear
            </button>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 text-label font-normal text-text-subtle">
            Searches you run with Enter show here on all your devices.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col" data-testid="recent-searches">
            {recent.map((x) => (
              <li
                key={x}
                className="group flex items-center gap-2 rounded-md hover:bg-surface-raised"
              >
                <button
                  onClick={() => onPick(x)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-label font-normal text-text-muted group-hover:text-text"
                >
                  <Search className="size-3.5 shrink-0 text-text-subtle" aria-hidden />
                  <span className="truncate">{x}</span>
                </button>
                <button
                  onClick={() => onRemove(x)}
                  aria-label={`Remove ${x}`}
                  className="mr-1 flex size-6 items-center justify-center rounded text-text-subtle opacity-0 hover:text-text focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-label text-text">Narrow it down</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {TIPS.map((t) => (
            <li key={t.op}>
              <button
                onClick={() => onTip(t.op)}
                className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-raised"
              >
                <code className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-meta text-accent">
                  {t.op}
                </code>
                <span className="text-meta text-text-muted">{t.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type ResultsProps = SearchScreenProps & {
  tab: SearchTab;
  setTab: (t: SearchTab) => void;
  server: SearchResponse | null;
  local: import('@sampledge/offline').LocalMessageHit[];
  loading: boolean;
  byId: Map<string, Conversation>;
  where: (id: string) => string;
  title: (c: Conversation) => string;
  onMore: (t: SearchType) => void;
};

function Results(p: ResultsProps) {
  const { tab, server, local, loading } = p;
  if (!server && loading && !local.length)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  const msgs = server ? server.messages.items : local;
  const empty =
    (server
      ? (['messages', 'files', 'people', 'conversations', 'tasks', 'meetings'] as const).every(
          (t) => (tab !== 'all' && tab !== t ? true : server[t].items.length === 0),
        )
      : msgs.length === 0) && !loading;
  if (empty)
    return (
      <StateView
        state="empty"
        title="Nothing found"
        description="Try fewer or shorter words, or clear a filter. Search only shows what you can open."
      />
    );

  const section = (t: SearchType, label: string, body: React.ReactNode, n: number) =>
    tab === 'all' ? (
      n > 0 ? (
        <section className="mb-6" key={t}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-meta font-medium uppercase tracking-wide text-text-subtle">
              {label}
            </h2>
            {server && (server[t].items.length > 3 || server[t].more) ? (
              <button onClick={() => p.setTab(t)} className="text-meta text-accent hover:underline">
                See all
              </button>
            ) : null}
          </div>
          {body}
        </section>
      ) : null
    ) : tab === t ? (
      <section key={t}>
        {body}
        {server?.[t].more ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => p.onMore(t)}>
              Show more
            </Button>
          </div>
        ) : null}
      </section>
    ) : null;
  const cap = <T,>(items: T[]) => (tab === 'all' ? items.slice(0, 3) : items);

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
      >
        {server
          ? section(
              'people',
              'People',
              <PeopleRow
                {...p}
                items={tab === 'all' ? server.people.items.slice(0, 4) : server.people.items}
              />,
              server.people.items.length,
            )
          : null}
        {server
          ? section(
              'conversations',
              'Channels & chats',
              <ConversationRows {...p} items={cap(server.conversations.items)} />,
              server.conversations.items.length,
            )
          : null}
        {section(
          'messages',
          server ? 'Messages' : 'Messages on this device',
          <MessageRows {...p} items={tab === 'all' ? msgs.slice(0, 5) : msgs} />,
          msgs.length,
        )}
        {server
          ? section(
              'files',
              'Files',
              <FileRows {...p} items={cap(server.files.items)} />,
              server.files.items.length,
            )
          : null}
        {server
          ? section(
              'tasks',
              'Tasks',
              <TaskRows {...p} items={cap(server.tasks.items)} />,
              server.tasks.items.length,
            )
          : null}
        {server
          ? section(
              'meetings',
              'Meetings',
              <MeetingRows {...p} items={cap(server.meetings.items)} />,
              server.meetings.items.length,
            )
          : null}
      </motion.div>
    </AnimatePresence>
  );
}

const card =
  'group flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-left transition-[border-color,transform,box-shadow] duration-[var(--sc-duration-fast)] hover:-translate-y-px hover:border-border-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

type MsgItem = {
  messageId: string | null;
  conversationId: string;
  senderId: string;
  snippet: string;
  matches: [number, number][];
  createdAt: string;
  replyToMessageId: string | null;
  fileNames: string[];
  status?: string;
  clientMessageId?: string;
};

function MessageRows(p: ResultsProps & { items: MsgItem[] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="search-messages">
      {p.items.map((m) => {
        const c = p.byId.get(m.conversationId);
        const isChannel = c?.kind === 'channel_public' || c?.kind === 'channel_private';
        return (
          <li key={m.messageId ?? m.clientMessageId}>
            <button
              className={card}
              onClick={() => p.onOpenMessage(m.conversationId, m.messageId, m.replyToMessageId)}
            >
              <Avatar
                name={nameOf(m.senderId, p.directory)}
                src={
                  (p.directory.get(m.senderId) as { avatarUrl?: string | null } | undefined)
                    ?.avatarUrl ?? undefined
                }
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 text-meta text-text-subtle">
                  <span className="text-label text-text">
                    {m.senderId === p.me ? 'You' : nameOf(m.senderId, p.directory)}
                  </span>
                  <span className="flex items-center gap-1">
                    {isChannel ? (
                      c?.kind === 'channel_private' ? (
                        <Lock className="size-3" aria-hidden />
                      ) : (
                        <Hash className="size-3" aria-hidden />
                      )
                    ) : (
                      <MessagesSquare className="size-3" aria-hidden />
                    )}
                    {c ? p.title(c) : 'Conversation'}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {formatDay(m.createdAt)} {formatTime(m.createdAt)}
                  </span>
                  {m.replyToMessageId ? (
                    <span className="flex items-center gap-1 text-accent">
                      <CornerDownRight className="size-3" aria-hidden /> In a thread
                    </span>
                  ) : null}
                  {m.status && m.status !== 'sent' && !m.messageId ? (
                    <Badge tone="warning">Not sent yet</Badge>
                  ) : null}
                </span>
                {m.snippet ? (
                  <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-message text-text-muted">
                    <Highlight text={m.snippet} ranges={m.matches} />
                  </span>
                ) : null}
                {m.fileNames.length ? (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {m.fileNames.slice(0, 4).map((f) => (
                      <span
                        key={f}
                        className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-meta text-text-muted"
                      >
                        <FileText className="size-3" aria-hidden /> {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PeopleRow(p: ResultsProps & { items: SearchResponse['people']['items'] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="search-people">
      {p.items.map((u) => {
        const d = p.directory.get(u.userId) as
          (DirectoryEntry & { avatarUrl?: string | null }) | undefined;
        return (
          <li key={u.userId} className={cn(card, 'items-center')}>
            <Avatar
              name={u.displayName}
              src={d?.avatarUrl ?? undefined}
              presence={d?.presence as never}
              size="md"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-text">
                <Highlight text={u.displayName} ranges={u.matches} />
                {u.userId === p.me ? <span className="text-text-subtle"> (you)</span> : null}
              </span>
              <span className="block truncate text-meta text-text-subtle">
                {[u.title, u.email].filter(Boolean).join(' · ')}
              </span>
            </span>
            {u.userId !== p.me ? (
              <Button size="sm" variant="secondary" onClick={() => p.onMessagePerson(u.userId)}>
                Message
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ConversationRows(p: ResultsProps & { items: SearchResponse['conversations']['items'] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="search-conversations">
      {p.items.map((c) => {
        const known = p.byId.get(c.conversationId);
        const label = known ? p.title(known) : (c.name ?? 'Conversation');
        const Icon =
          c.kind === 'channel_private' ? Lock : c.kind === 'channel_public' ? Hash : MessagesSquare;
        return (
          <li key={c.conversationId}>
            <button
              className={cn(card, 'items-center')}
              onClick={() => p.onOpenConversation(c.conversationId)}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface-raised text-text-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-text">{label}</span>
                <span className="block truncate text-meta text-text-subtle">
                  {c.topic ??
                    (c.kind === 'dm'
                      ? 'Direct message'
                      : `${c.memberIds.length} member${c.memberIds.length === 1 ? '' : 's'}`)}
                </span>
              </span>
              {c.archived ? <Badge>Archived</Badge> : null}
              {!c.isMember ? <Badge tone="accent">Not joined</Badge> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FileRows(p: ResultsProps & { items: SearchResponse['files']['items'] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="search-files">
      {p.items.map((f) => (
        <li key={f.attachmentId}>
          <button
            className={cn(card, 'items-center')}
            onClick={() => p.onOpenMessage(f.conversationId, f.messageId, null)}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FileText className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-text">
                <Highlight text={f.fileName} ranges={f.matches} />
              </span>
              <span className="block truncate text-meta text-text-subtle">
                {fmtBytes(f.sizeBytes)} · {nameOf(f.uploaderId, p.directory)} ·{' '}
                {p.where(f.conversationId)} · {formatDay(f.createdAt)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const STATUS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

function TaskRows(p: ResultsProps & { items: SearchResponse['tasks']['items'] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="search-tasks">
      {p.items.map((t) => (
        <li key={t.taskId}>
          <button className={cn(card, 'items-center')} onClick={() => p.onOpenTasks()}>
            <CheckSquare
              className={cn(
                'size-5 shrink-0',
                t.status === 'done' ? 'text-success' : 'text-text-subtle',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-text">
                <Highlight text={t.title} ranges={t.matches} />
              </span>
              <span className="block truncate text-meta text-text-subtle">
                {t.assigneeIds.length
                  ? t.assigneeIds.map((id) => nameOf(id, p.directory)).join(', ')
                  : 'Unassigned'}
                {t.dueAt ? ` · due ${formatDay(t.dueAt)}` : ''}
                {t.conversationId ? ` · ${p.where(t.conversationId)}` : ''}
              </span>
            </span>
            <Badge
              tone={t.status === 'done' ? 'success' : t.status === 'blocked' ? 'danger' : 'neutral'}
            >
              {STATUS[t.status] ?? t.status}
            </Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MeetingRows(p: ResultsProps & { items: SearchResponse['meetings']['items'] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="search-meetings">
      {p.items.map((m) => {
        const d = new Date(m.startsAt);
        return (
          <li key={m.meetingId}>
            <button
              className={cn(card, 'items-center')}
              onClick={() => p.onOpenMeeting({ meetingId: m.meetingId, startsAt: m.startsAt })}
            >
              <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-border bg-surface-sunken py-1">
                <span className="text-[10px] font-medium uppercase text-accent">
                  {d.toLocaleString(undefined, { month: 'short' })}
                </span>
                <span className="font-display text-h3 leading-none text-text">{d.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-text">
                  <Highlight text={m.title} ranges={m.matches} />
                </span>
                <span className="block truncate text-meta text-text-subtle">
                  {formatTime(m.startsAt)} to {formatTime(m.endsAt)} · organised by{' '}
                  {m.organizerId === p.me ? 'you' : nameOf(m.organizerId, p.directory)}
                </span>
              </span>
              {m.status === 'cancelled' ? <Badge tone="danger">Cancelled</Badge> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
