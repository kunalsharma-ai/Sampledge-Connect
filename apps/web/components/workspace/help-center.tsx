'use client';
import * as React from 'react';
import {
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudOff,
  Headset,
  Inbox,
  LifeBuoy,
  MessageCircleQuestion,
  Search,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  FEATURE_HELP,
  FEATURE_HELP_CATEGORIES,
  FEATURE_HELP_CATEGORY_LABELS,
  HELP_FAQS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_SUBJECT_MAX,
  SUPPORT_TEXT_MAX,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  featureHelp,
  searchFaqs,
  searchFeatureHelp,
  type FeatureHelpCategory,
  type FeatureHelpEntry,
  type HelpFaq,
  type SupportQuery,
  type SupportRoute,
  type SupportStatus,
  type SupportTopic,
} from '@sampledge/contracts';
import { Avatar, cn, useToast } from '@sampledge/ui';
import { GuideBody, HelpBadge } from '../feature-help';
import {
  usePendingSupport,
  useSupportActions,
  useSupportQueries,
  type SupportScope,
} from '@/lib/support';

type Tab = 'home' | 'guides' | 'faqs' | 'ask' | 'mine' | 'team';

/**
 * The Help center: every feature guide, answers to common questions, and a way to ask anything
 * else (to the organization's admins or SampConnect support), with replies in one place.
 */
export function HelpCenter({
  myName,
  isAdmin,
  online,
  network,
}: {
  myName: string;
  isAdmin: boolean;
  online: boolean;
  network: boolean;
}) {
  const [tab, setTab] = React.useState<Tab>('home');
  const [q, setQ] = React.useState('');
  const [guide, setGuide] = React.useState<string | null>(null);
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);
  const [askAbout, setAskAbout] = React.useState<string | null>(null);
  const [focusQuery, setFocusQuery] = React.useState<string | null>(null);
  const mine = useSupportQueries('mine');
  const unreadMine = (mine.items ?? []).filter(
    (x) => x.lastReplySide && x.lastReplySide !== 'requester' && x.status === 'answered',
  ).length;
  const team = useSupportQueries('org', isAdmin && !network);
  const teamOpen = (team.items ?? []).filter(
    (x) => x.status === 'open' || x.status === 'in_progress',
  ).length;

  const visibleGuide = (e: FeatureHelpEntry) =>
    e.audience === 'everyone' || (e.audience === 'admins' && isAdmin);
  const faqs = HELP_FAQS.filter((f) => !f.adminOnly || isAdmin);

  const openGuide = (id: string) => {
    setGuide(id);
    setTab('guides');
    setQ('');
  };
  const ask = (featureId: string | null = null) => {
    setAskAbout(featureId);
    setTab('ask');
    setQ('');
  };

  const tabs: { id: Tab; label: string; icon: typeof BookOpen; count?: number }[] = [
    { id: 'home', label: 'Overview', icon: Sparkles },
    { id: 'guides', label: 'Feature guides', icon: BookOpen },
    { id: 'faqs', label: 'FAQs', icon: CircleHelp },
    { id: 'ask', label: 'Ask a question', icon: MessageCircleQuestion },
    { id: 'mine', label: 'My questions', icon: Inbox, count: unreadMine },
    ...(isAdmin && !network
      ? [{ id: 'team' as Tab, label: 'Team questions', icon: Users, count: teamOpen }]
      : []),
  ];

  const searching = q.trim().length > 0;
  const guideHits = searching ? searchFeatureHelp(q).filter(visibleGuide).slice(0, 6) : [];
  const faqHits = searching ? searchFaqs(q, faqs).slice(0, 8) : [];

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-20 md:pb-0">
      {/* Hero */}
      <section className="relative shrink-0 overflow-hidden bg-[linear-gradient(135deg,#0B5A41,#0F6B4F_35%,#12825C_70%,#169A6C)] px-4 pb-8 pt-7 text-white sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[#F5B83D]/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-[#8FE0B6]/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:18px_18px]"
        />
        <div className="relative mx-auto max-w-5xl">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#F8C95A]">
            <LifeBuoy className="size-3.5" /> Help center
          </p>
          <h1 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.3rem)] font-semibold leading-tight">
            How can we help, {myName.split(' ')[0]}?
          </h1>
          <p className="mt-1 max-w-2xl text-body text-white/85">
            Guides for every feature, quick answers, and a direct line to your admins or SampConnect
            support.
          </p>
          <label className="mt-5 flex max-w-2xl items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-[#0B3B2B] shadow-[0_12px_40px_rgba(0,0,0,0.25),0_0_0_2px_rgba(245,184,61,0.6)] focus-within:shadow-[0_12px_40px_rgba(0,0,0,0.25),0_0_0_3px_#F5B83D]">
            <Search className="size-5 text-[#12825C]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search guides and answers, e.g. “record a meeting”"
              aria-label="Search help"
              className="w-full bg-transparent text-body placeholder:text-[#4b6b5e] focus:outline-none"
            />
          </label>
          {!online ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-meta">
              <CloudOff className="size-3.5" /> Offline: guides and answers still work, and
              questions send when you’re back online.
            </p>
          ) : null}
        </div>
      </section>

      {/* Tabs */}
      <nav
        aria-label="Help center sections"
        className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface/85 px-4 backdrop-blur-xl sm:px-8"
      >
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setQ('');
              }}
              aria-current={!searching && tab === t.id ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-label transition-colors',
                !searching && tab === t.id
                  ? 'bg-[#12825C] text-white shadow-[0_0_0_1.5px_#F5B83D]'
                  : 'text-text-muted hover:bg-surface-raised hover:text-text',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
              {t.count ? (
                <span className="rounded-full bg-[#F5B83D] px-1.5 text-[11px] font-bold text-[#3d2a00]">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8">
        {searching ? (
          <SearchResults
            q={q}
            guides={guideHits}
            faqs={faqHits}
            onGuide={openGuide}
            onAsk={() => ask()}
          />
        ) : tab === 'home' ? (
          <Overview
            faqs={faqs}
            isAdmin={isAdmin}
            mine={mine.items ?? []}
            onTab={setTab}
            onGuide={openGuide}
            onFaqs={(id) => {
              setOpenFaq(id);
              setTab('faqs');
            }}
            onOpenQuery={(id) => {
              setFocusQuery(id);
              setTab('mine');
            }}
            visibleGuide={visibleGuide}
          />
        ) : tab === 'guides' ? (
          <Guides
            selected={guide}
            onSelect={setGuide}
            visible={visibleGuide}
            onAsk={(id) => ask(id)}
          />
        ) : tab === 'faqs' ? (
          <Faqs
            faqs={faqs}
            open={openFaq}
            onOpen={setOpenFaq}
            onGuide={openGuide}
            onAsk={() => ask()}
          />
        ) : tab === 'ask' ? (
          <AskForm
            featureId={askAbout}
            network={network}
            onSent={() => setTab('mine')}
            online={online}
          />
        ) : tab === 'mine' ? (
          <QueryInbox
            scope="mine"
            list={mine}
            focus={focusQuery}
            onAsk={() => ask()}
            online={online}
          />
        ) : (
          <QueryInbox scope="org" list={team} focus={focusQuery} online={online} />
        )}
      </div>
    </main>
  );
}

// ─── overview ───────────────────────────────────────────────────────────────

const CATEGORY_STYLE: Record<FeatureHelpCategory, string> = {
  basics: 'from-[#12825C]/20 to-[#12825C]/5',
  messaging: 'from-[#2563EB]/18 to-[#2563EB]/4',
  meetings: 'from-[#8B5CF6]/18 to-[#8B5CF6]/4',
  work: 'from-[#F5B83D]/22 to-[#F5B83D]/5',
  clients: 'from-[#0D9488]/18 to-[#0D9488]/4',
  discover: 'from-[#EC4899]/16 to-[#EC4899]/4',
  network: 'from-[#0EA5E9]/18 to-[#0EA5E9]/4',
  personal: 'from-[#F97316]/16 to-[#F97316]/4',
  admin: 'from-[#64748B]/20 to-[#64748B]/5',
};

function Overview({
  faqs,
  isAdmin,
  mine,
  onTab,
  onGuide,
  onFaqs,
  onOpenQuery,
  visibleGuide,
}: {
  faqs: HelpFaq[];
  isAdmin: boolean;
  mine: SupportQuery[];
  onTab: (t: Tab) => void;
  onGuide: (id: string) => void;
  onFaqs: (id: string) => void;
  onOpenQuery: (id: string) => void;
  visibleGuide: (e: FeatureHelpEntry) => boolean;
}) {
  const popular = [
    'not-answered',
    'offline',
    'edit-delete',
    'record',
    'invite-external',
    'ai-private',
  ]
    .map((id) => faqs.find((f) => f.id === id))
    .filter((f): f is HelpFaq => !!f);
  const guides = (FEATURE_HELP as readonly FeatureHelpEntry[]).filter(visibleGuide);
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <ActionCard
          icon={BookOpen}
          title="Feature guides"
          text={`${guides.length} short guides: what each feature does and how to use it.`}
          onClick={() => onTab('guides')}
        />
        <ActionCard
          icon={CircleHelp}
          title="Frequently asked"
          text={`${faqs.length} quick answers to the questions people ask most.`}
          onClick={() => onTab('faqs')}
        />
        <ActionCard
          icon={Headset}
          title="Ask a question"
          text="Can’t find it? Ask your admins or SampConnect support."
          onClick={() => onTab('ask')}
          accent
        />
      </div>

      {mine.length ? (
        <section>
          <SectionTitle icon={Inbox}>Your recent questions</SectionTitle>
          <div className="mt-3 grid gap-2">
            {mine.slice(0, 3).map((x) => (
              <button
                key={x.queryId}
                type="button"
                onClick={() => onOpenQuery(x.queryId)}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-[#F5B83D]/60"
              >
                <StatusPill status={x.status} />
                <span className="min-w-0 flex-1 truncate text-label text-text">{x.subject}</span>
                <span className="text-meta text-text-subtle">{ago(x.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionTitle icon={Sparkles}>Popular questions</SectionTitle>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {popular.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFaqs(f.id)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-all hover:-translate-y-px hover:border-[#F5B83D]/60 hover:shadow-md"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#12825C]/12 text-[#12825C] dark:text-[#4FD1A1]">
                <CircleHelp className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-label text-text">{f.question}</span>
              <ArrowRight className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle icon={BookOpen}>Browse by topic</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_HELP_CATEGORIES.filter((c) => c !== 'admin' || isAdmin).map((c) => {
            const items = guides.filter((g) => g.category === c);
            if (!items.length) return null;
            return (
              <div
                key={c}
                className={cn(
                  'rounded-2xl border border-border bg-gradient-to-br p-4',
                  CATEGORY_STYLE[c],
                )}
              >
                <p className="font-display text-h3 text-text">{FEATURE_HELP_CATEGORY_LABELS[c]}</p>
                <ul className="mt-2 space-y-1">
                  {items.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => onGuide(g.id)}
                        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-meta text-text-muted hover:text-text"
                      >
                        <ArrowRight className="size-3 text-[#C98A0B]" />
                        {g.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  text,
  onClick,
  accent,
}: {
  icon: typeof BookOpen;
  title: string;
  text: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg',
        accent
          ? 'border-[#F5B83D]/70 bg-[linear-gradient(135deg,#12825C,#0F6B4F)] text-white'
          : 'border-border bg-surface hover:border-[#F5B83D]/60',
      )}
    >
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-xl shadow-[0_0_0_1.5px_#F5B83D]',
          accent ? 'bg-white/15 text-[#F8C95A]' : 'bg-[#12825C] text-[#F8C95A]',
        )}
      >
        <Icon className="size-5" />
      </span>
      <p className={cn('mt-3 font-display text-h3', accent ? 'text-white' : 'text-text')}>
        {title}
      </p>
      <p className={cn('mt-1 text-meta', accent ? 'text-white/85' : 'text-text-muted')}>{text}</p>
      <ArrowRight
        className={cn(
          'absolute right-4 top-5 size-4 transition-transform group-hover:translate-x-1',
          accent ? 'text-[#F8C95A]' : 'text-text-subtle',
        )}
      />
    </button>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof BookOpen; children: string }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-h3 text-text">
      <Icon className="size-4 text-[#C98A0B]" /> {children}
    </h2>
  );
}

// ─── search ─────────────────────────────────────────────────────────────────

function SearchResults({
  q,
  guides,
  faqs,
  onGuide,
  onAsk,
}: {
  q: string;
  guides: FeatureHelpEntry[];
  faqs: HelpFaq[];
  onGuide: (id: string) => void;
  onAsk: () => void;
}) {
  const [open, setOpen] = React.useState<string | null>(faqs[0]?.id ?? null);
  return (
    <div className="space-y-6" data-testid="help-search">
      {guides.length ? (
        <section>
          <SectionTitle icon={BookOpen}>Guides</SectionTitle>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {guides.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onGuide(g.id)}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left hover:border-[#F5B83D]/60"
              >
                <HelpBadge size="sm" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-label text-text">{g.title}</span>
                  <span className="block text-meta text-text-subtle">{g.summary}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {faqs.length ? (
        <section>
          <SectionTitle icon={CircleHelp}>Answers</SectionTitle>
          <div className="mt-3 space-y-2">
            {faqs.map((f) => (
              <FaqItem
                key={f.id}
                f={f}
                open={open === f.id}
                onToggle={() => setOpen(open === f.id ? null : f.id)}
                onGuide={onGuide}
              />
            ))}
          </div>
        </section>
      ) : null}
      <StillNeedHelp
        text={
          guides.length || faqs.length
            ? 'Not what you were looking for?'
            : `Nothing matches “${q.trim()}”.`
        }
        onAsk={onAsk}
      />
    </div>
  );
}

function StillNeedHelp({ text, onAsk }: { text: string; onAsk: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#F5B83D]/50 bg-[linear-gradient(135deg,rgba(18,130,92,0.10),rgba(245,184,61,0.10))] p-5">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#12825C] text-[#F8C95A] shadow-[0_0_0_2px_#F5B83D]">
        <Headset className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label text-text">{text}</p>
        <p className="text-meta text-text-muted">
          Ask your admins or SampConnect support. You’ll see the answer here and get notified.
        </p>
      </div>
      <button
        type="button"
        onClick={onAsk}
        className="rounded-full bg-[#12825C] px-4 py-2 text-label text-white shadow-[0_0_0_1.5px_#F5B83D] hover:bg-[#0F6B4F]"
      >
        Ask a question
      </button>
    </div>
  );
}

// ─── guides ─────────────────────────────────────────────────────────────────

function Guides({
  selected,
  onSelect,
  visible,
  onAsk,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  visible: (e: FeatureHelpEntry) => boolean;
  onAsk: (featureId: string) => void;
}) {
  const all = (FEATURE_HELP as readonly FeatureHelpEntry[]).filter(visible);
  const entry = selected ? featureHelp(selected) : all[0];
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <nav
        aria-label="Feature guides"
        className={cn('space-y-3', selected ? 'hidden md:block' : 'block')}
      >
        {FEATURE_HELP_CATEGORIES.map((c) => {
          const items = all.filter((e) => e.category === c);
          return items.length ? (
            <div key={c}>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#C98A0B]">
                {FEATURE_HELP_CATEGORY_LABELS[c]}
              </p>
              {items.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-current={entry?.id === e.id || undefined}
                  className={cn(
                    'block w-full rounded-lg px-2 py-1.5 text-left text-label transition-colors',
                    entry?.id === e.id
                      ? 'bg-[#12825C]/12 text-text ring-1 ring-[#F5B83D]/60'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text',
                  )}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ) : null;
        })}
      </nav>
      {entry ? (
        <article
          className={cn(
            'flex flex-col overflow-hidden rounded-2xl border border-[#F5B83D]/40 bg-surface shadow-lg md:sticky md:top-16 md:max-h-[calc(100dvh-6rem)]',
            selected ? 'flex' : 'hidden md:flex',
          )}
        >
          <GuideBody
            key={entry.id}
            entry={entry}
            primary={false}
            closable={false}
            onBack={selected ? () => onSelect(null) : undefined}
            onRelated={onSelect}
          />
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-meta text-text-muted">
            Still unsure?
            <button
              type="button"
              onClick={() => onAsk(entry.id)}
              className="font-medium text-[#12825C] hover:underline dark:text-[#4FD1A1]"
            >
              Ask about {entry.title}
            </button>
          </div>
        </article>
      ) : null}
    </div>
  );
}

// ─── FAQs ───────────────────────────────────────────────────────────────────

function Faqs({
  faqs,
  open,
  onOpen,
  onGuide,
  onAsk,
}: {
  faqs: HelpFaq[];
  open: string | null;
  onOpen: (id: string | null) => void;
  onGuide: (id: string) => void;
  onAsk: () => void;
}) {
  const [cat, setCat] = React.useState<FeatureHelpCategory | 'all'>('all');
  const cats = FEATURE_HELP_CATEGORIES.filter((c) => faqs.some((f) => f.category === c));
  const shown = cats.filter((c) => cat === 'all' || c === cat);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter questions">
        {(['all', ...cats] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={cn(
              'rounded-full border px-3 py-1 text-meta transition-colors',
              cat === c
                ? 'border-[#F5B83D] bg-[#12825C] text-white'
                : 'border-border text-text-muted hover:border-[#12825C]/50 hover:text-text',
            )}
          >
            {c === 'all' ? `All (${faqs.length})` : FEATURE_HELP_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      {shown.map((c) => (
        <section key={c}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#C98A0B]">
            {FEATURE_HELP_CATEGORY_LABELS[c]}
          </h2>
          <div className="space-y-2">
            {faqs
              .filter((f) => f.category === c)
              .map((f) => (
                <FaqItem
                  key={f.id}
                  f={f}
                  open={open === f.id}
                  onToggle={() => onOpen(open === f.id ? null : f.id)}
                  onGuide={onGuide}
                />
              ))}
          </div>
        </section>
      ))}
      <StillNeedHelp text="Didn’t find your answer?" onAsk={onAsk} />
    </div>
  );
}

function FaqItem({
  f,
  open,
  onToggle,
  onGuide,
}: {
  f: HelpFaq;
  open: boolean;
  onToggle: () => void;
  onGuide: (id: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  const guide = f.featureId ? featureHelp(f.featureId) : undefined;
  const panel = `faq-${f.id}`;
  return (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-xl border bg-surface transition-colors',
        open ? 'border-[#F5B83D]/70 shadow-md' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            open ? 'bg-[#12825C] text-[#F8C95A]' : 'bg-surface-raised text-text-subtle',
          )}
        >
          Q
        </span>
        <span className="min-w-0 flex-1 text-label text-text">{f.question}</span>
        <ChevronDown
          className={cn('size-4 text-text-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div id={panel} className="border-t border-border/60 px-4 pb-4 pl-[52px] pt-3">
          <p className="text-body text-text">{f.answer}</p>
          {guide ? (
            <button
              type="button"
              onClick={() => onGuide(guide.id)}
              className="mt-2 inline-flex items-center gap-1.5 text-meta font-medium text-[#12825C] hover:underline dark:text-[#4FD1A1]"
            >
              <BookOpen className="size-3.5" /> Read the {guide.title} guide
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── ask ────────────────────────────────────────────────────────────────────

function AskForm({
  featureId,
  network,
  online,
  onSent,
}: {
  featureId: string | null;
  network: boolean;
  online: boolean;
  onSent: () => void;
}) {
  const { ask } = useSupportActions();
  const { toast } = useToast();
  const [topic, setTopic] = React.useState<SupportTopic>('question');
  // Network accounts have no organization admins: questions go to SampConnect support.
  const [route, setRoute] = React.useState<SupportRoute>(network ? 'platform' : 'org');
  const [feature, setFeature] = React.useState(featureId ?? '');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const ready = subject.trim().length >= 3 && body.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await ask({
        subject: subject.trim(),
        body: body.trim(),
        topic,
        route,
        featureId: feature || null,
      });
      toast({
        title: online ? 'Question sent' : 'Question saved',
        description: online
          ? 'You’ll be notified when someone replies.'
          : 'It sends as soon as you’re back online.',
        tone: 'success',
      });
      onSent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5" data-testid="ask-form">
      <div>
        <h2 className="font-display text-h2 text-text">Ask a question</h2>
        <p className="mt-1 text-label font-normal text-text-muted">
          Tell us what you need. Replies appear under My questions, on all your devices.
        </p>
      </div>

      {network ? null : (
        <fieldset>
          <legend className="mb-2 text-label text-text">Who should answer?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <RouteCard
              active={route === 'org'}
              onClick={() => setRoute('org')}
              icon={Building2}
              title="My organization’s admins"
              text="Access, settings, how your team works."
            />
            <RouteCard
              active={route === 'platform'}
              onClick={() => setRoute('platform')}
              icon={Headset}
              title="SampConnect support"
              text="Problems with the app, billing, or anything else."
            />
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-label text-text">What is it about?</legend>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(t)}
              aria-pressed={topic === t}
              className={cn(
                'rounded-full border px-3 py-1.5 text-meta transition-colors',
                topic === t
                  ? 'border-[#F5B83D] bg-[#12825C] text-white'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {SUPPORT_TOPIC_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-label text-text">Feature (optional)</span>
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-label text-text focus:border-[#12825C] focus:outline-none focus:ring-2 focus:ring-[#F5B83D]/50"
        >
          <option value="">Not about one feature</option>
          {FEATURE_HELP.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-label text-text">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUPPORT_SUBJECT_MAX}
          placeholder="e.g. How do I share a recording with a client?"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-label text-text placeholder:text-text-subtle focus:border-[#12825C] focus:outline-none focus:ring-2 focus:ring-[#F5B83D]/50"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-label text-text">Details</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={SUPPORT_TEXT_MAX}
          rows={6}
          placeholder="What were you trying to do, and what happened?"
          className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-label font-normal text-text placeholder:text-text-subtle focus:border-[#12825C] focus:outline-none focus:ring-2 focus:ring-[#F5B83D]/50"
        />
      </label>

      <div className="flex items-center justify-end gap-3">
        {!online ? (
          <span className="flex items-center gap-1 text-meta text-text-muted">
            <CloudOff className="size-3.5" /> Sends when you’re online
          </span>
        ) : null}
        <button
          type="submit"
          disabled={!ready || busy}
          className="flex items-center gap-2 rounded-full bg-[#12825C] px-5 py-2.5 text-label text-white shadow-[0_0_0_1.5px_#F5B83D] transition-colors hover:bg-[#0F6B4F] disabled:opacity-50"
        >
          <Send className="size-4" /> Send question
        </button>
      </div>
    </form>
  );
}

function RouteCard({
  active,
  onClick,
  icon: Icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BookOpen;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
        active
          ? 'border-[#F5B83D] bg-[#12825C]/10 shadow-[0_0_0_1px_#F5B83D]'
          : 'border-border bg-surface hover:border-[#12825C]/50',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-[#12825C] text-[#F8C95A]' : 'bg-surface-raised text-text-subtle',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-label text-text">{title}</span>
        <span className="block text-meta text-text-muted">{text}</span>
      </span>
    </button>
  );
}

// ─── query lists (mine, team, SampConnect support) ──────────────────────────

const STATUS_STYLE: Record<SupportStatus, string> = {
  open: 'bg-[#F5B83D]/20 text-[#8a5a00] dark:text-[#F8C95A]',
  in_progress: 'bg-[#2563EB]/15 text-[#1d4ed8] dark:text-[#93b4ff]',
  answered: 'bg-[#12825C]/15 text-[#0F6B4F] dark:text-[#4FD1A1]',
  resolved: 'bg-surface-raised text-text-subtle',
};

function StatusPill({ status }: { status: SupportStatus | 'sending' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        status === 'sending' ? 'bg-surface-raised text-text-subtle' : STATUS_STYLE[status],
      )}
    >
      {status === 'sending' ? 'Waiting to send' : SUPPORT_STATUS_LABELS[status]}
    </span>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** A list of queries with the selected one's thread beside it. Used by Help and the console. */
export function QueryInbox({
  scope,
  list,
  focus,
  onAsk,
  online,
}: {
  scope: SupportScope;
  list: { items: SupportQuery[] | null; error: string | null };
  focus?: string | null;
  onAsk?: () => void;
  online: boolean;
}) {
  const pending = usePendingSupport();
  const [filter, setFilter] = React.useState<'active' | 'all'>(scope === 'mine' ? 'all' : 'active');
  const [selected, setSelected] = React.useState<string | null>(focus ?? null);
  React.useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);

  const waiting =
    scope === 'mine'
      ? pending
          .filter((a) => a.key.startsWith('support|new|'))
          .map((a) => a.body as { subject: string; clientId: string })
      : [];
  const items = (list.items ?? []).filter((x) => filter === 'all' || x.status !== 'resolved');
  const current = items.find((x) => x.queryId === selected) ?? null;

  if (list.items === null && !waiting.length)
    return (
      <p className="py-10 text-center text-meta text-text-muted">
        {list.error ?? 'Loading questions…'}
      </p>
    );

  if (!items.length && !waiting.length && filter === 'all')
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#12825C] text-[#F8C95A] shadow-[0_0_0_2px_#F5B83D]">
          <MessageCircleQuestion className="size-6" />
        </span>
        <p className="mt-4 font-display text-h3 text-text">
          {scope === 'mine' ? 'No questions yet' : 'No questions here'}
        </p>
        <p className="mt-1 text-meta text-text-muted">
          {scope === 'mine'
            ? 'When you ask something, the conversation with your admins or SampConnect support shows here.'
            : 'Questions people send will show here, live.'}
        </p>
        {onAsk ? (
          <button
            type="button"
            onClick={onAsk}
            className="mt-4 rounded-full bg-[#12825C] px-4 py-2 text-label text-white shadow-[0_0_0_1.5px_#F5B83D]"
          >
            Ask a question
          </button>
        ) : null}
      </div>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]" data-testid={`queries-${scope}`}>
      <div className={cn('space-y-2', current ? 'hidden lg:block' : 'block')}>
        <div className="flex gap-1 rounded-full border border-border bg-surface p-0.5 text-meta">
          {(['active', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'flex-1 rounded-full px-3 py-1',
                filter === f ? 'bg-[#12825C] text-white' : 'text-text-muted',
              )}
            >
              {f === 'active' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
        {waiting.map((w) => (
          <div
            key={w.clientId}
            className="rounded-xl border border-dashed border-border bg-surface px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <StatusPill status="sending" />
              <Clock3 className="size-3.5 text-text-subtle" />
            </div>
            <p className="mt-1.5 truncate text-label text-text">{w.subject}</p>
          </div>
        ))}
        {items.map((x) => {
          const fresh =
            x.lastReplySide &&
            (scope === 'mine'
              ? x.lastReplySide !== 'requester'
              : x.lastReplySide === 'requester') &&
            x.status !== 'resolved';
          return (
            <button
              key={x.queryId}
              type="button"
              onClick={() => setSelected(x.queryId)}
              aria-current={x.queryId === selected || undefined}
              className={cn(
                'block w-full rounded-xl border px-4 py-3 text-left transition-colors',
                x.queryId === selected
                  ? 'border-[#F5B83D] bg-[#12825C]/8'
                  : 'border-border bg-surface hover:border-[#12825C]/50',
              )}
            >
              <div className="flex items-center gap-2">
                <StatusPill status={x.status} />
                {x.route === 'platform' ? (
                  <span className="rounded-full bg-[#F5B83D]/15 px-2 py-0.5 text-[11px] text-[#8a5a00] dark:text-[#F8C95A]">
                    SampConnect support
                  </span>
                ) : null}
                {fresh ? (
                  <span className="size-2 rounded-full bg-[#F5B83D]" aria-label="New reply" />
                ) : null}
                <span className="ml-auto text-[11px] text-text-subtle">{ago(x.updatedAt)}</span>
              </div>
              <p className="mt-1.5 truncate text-label text-text">{x.subject}</p>
              <p className="truncate text-meta text-text-subtle">
                {scope === 'mine'
                  ? `${x.replies.length} ${x.replies.length === 1 ? 'reply' : 'replies'}`
                  : `${x.requesterName}${x.organizationName ? ` · ${x.organizationName}` : ''}`}
              </p>
            </button>
          );
        })}
      </div>
      {current ? (
        <QueryThread q={current} scope={scope} online={online} onBack={() => setSelected(null)} />
      ) : (
        <div className="hidden items-center justify-center rounded-2xl border border-dashed border-border p-10 text-meta text-text-muted lg:flex">
          Select a question to see the conversation.
        </div>
      )}
    </div>
  );
}

function QueryThread({
  q,
  scope,
  online,
  onBack,
}: {
  q: SupportQuery;
  scope: SupportScope;
  online: boolean;
  onBack: () => void;
}) {
  const { reply, update } = useSupportActions();
  const pending = usePendingSupport().filter((a) =>
    a.key.startsWith(`support|reply|${q.queryId}|`),
  );
  const [text, setText] = React.useState('');
  const handler = scope !== 'mine';
  const guide = q.featureId ? featureHelp(q.featureId) : null;
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await reply(q, t, scope);
  };
  const sideLabel = (s: string) =>
    s === 'platform' ? 'SampConnect support' : s === 'org' ? 'Admin' : 'Asked';
  return (
    <article
      className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#F5B83D]/40 bg-surface shadow-lg"
      data-testid="query-thread"
    >
      <header className="relative overflow-hidden bg-[linear-gradient(135deg,#0F6B4F,#12825C)] px-5 py-4 text-white">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md px-1 text-white/80 hover:bg-white/15 lg:hidden"
            aria-label="Back to questions"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-h3">{q.subject}</h2>
            <p className="mt-0.5 text-meta text-white/80">
              {SUPPORT_TOPIC_LABELS[q.topic]}
              {guide ? ` · ${guide.title}` : ''} ·{' '}
              {q.route === 'platform' ? 'SampConnect support' : 'Organization admins'}
              {handler ? ` · from ${q.requesterName}` : ''}
              {q.organizationName ? ` (${q.organizationName})` : ''}
            </p>
          </div>
          <StatusPill status={q.status} />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] bg-[linear-gradient(90deg,#F5B83D,#F8C95A_50%,transparent)]"
        />
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <Bubble
          name={q.requesterName}
          label={sideLabel('requester')}
          at={q.createdAt}
          text={q.body}
          mine={scope === 'mine'}
        />
        {q.replies.map((r) => (
          <Bubble
            key={r.replyId}
            name={r.authorName}
            label={sideLabel(r.side)}
            at={r.createdAt}
            text={r.text}
            mine={scope === 'mine' ? r.side === 'requester' : r.side !== 'requester'}
            support={r.side === 'platform'}
          />
        ))}
        {pending.map((a) => (
          <Bubble
            key={a.key}
            name="You"
            label="Waiting to send"
            at={new Date(a.createdAt).toISOString()}
            text={(a.body as { text: string }).text}
            mine
            pending
          />
        ))}
      </div>
      <footer className="space-y-2 border-t border-border p-3">
        {q.status === 'resolved' && scope === 'mine' ? (
          <p className="text-meta text-text-muted">Resolved. Write again to reopen it.</p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            maxLength={SUPPORT_TEXT_MAX}
            placeholder={handler ? 'Write an answer…' : 'Add more details or reply…'}
            aria-label="Reply"
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-label font-normal text-text focus:border-[#12825C] focus:outline-none focus:ring-2 focus:ring-[#F5B83D]/50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!text.trim()}
            aria-label="Send reply"
            className="flex size-11 items-center justify-center rounded-full bg-[#12825C] text-white shadow-[0_0_0_1.5px_#F5B83D] disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-meta">
          {handler ? (
            <>
              <span className="text-text-subtle">Status:</span>
              {(['open', 'in_progress', 'answered', 'resolved'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void update(q, { status: s }, scope)}
                  aria-pressed={q.status === s}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5',
                    q.status === s
                      ? 'border-[#F5B83D] bg-[#12825C] text-white'
                      : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  {SUPPORT_STATUS_LABELS[s]}
                </button>
              ))}
              {scope === 'org' && q.route === 'org' ? (
                <button
                  type="button"
                  onClick={() => void update(q, { route: 'platform' }, scope)}
                  className="ml-auto flex items-center gap-1 rounded-full border border-[#F5B83D]/60 px-2.5 py-0.5 text-[#8a5a00] hover:bg-[#F5B83D]/10 dark:text-[#F8C95A]"
                >
                  <Headset className="size-3.5" /> Pass on to SampConnect support
                </button>
              ) : null}
            </>
          ) : q.status !== 'resolved' ? (
            <button
              type="button"
              onClick={() => void update(q, { status: 'resolved' }, scope)}
              className="rounded-full border border-border px-3 py-1 text-text-muted hover:border-[#12825C] hover:text-text"
            >
              Mark as resolved
            </button>
          ) : null}
          {!online ? (
            <span className="ml-auto flex items-center gap-1 text-text-subtle">
              <CloudOff className="size-3.5" /> Replies send when you’re online
            </span>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function Bubble({
  name,
  label,
  at,
  text,
  mine,
  support,
  pending,
}: {
  name: string;
  label: string;
  at: string;
  text: string;
  mine: boolean;
  support?: boolean;
  pending?: boolean;
}) {
  return (
    <div className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
      {support ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#12825C] text-[#F8C95A] shadow-[0_0_0_1.5px_#F5B83D]">
          <Headset className="size-4" />
        </span>
      ) : (
        <Avatar name={name} size="sm" />
      )}
      <div className={cn('max-w-[80%]', mine && 'text-right')}>
        <p className="text-[11px] text-text-subtle">
          {name}
          {label && label !== name ? ` · ${label}` : ''} · {ago(at)}
        </p>
        <div
          className={cn(
            'mt-1 whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-label font-normal',
            mine
              ? 'rounded-tr-sm bg-[#12825C] text-white'
              : support
                ? 'rounded-tl-sm border border-[#F5B83D]/50 bg-[#F5B83D]/10 text-text'
                : 'rounded-tl-sm bg-surface-raised text-text',
            pending && 'opacity-60',
          )}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

/** The super admin console's queue: questions sent to SampConnect support. */
export function PlatformSupportTab({ online }: { online: boolean }) {
  const list = useSupportQueries('platform');
  return <QueryInbox scope="platform" list={list} online={online} />;
}
