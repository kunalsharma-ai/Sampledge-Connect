'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  BookOpen,
  Compass,
  Heart,
  Lightbulb,
  MapPin,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import {
  FEATURE_HELP_AUDIENCE_LABELS,
  FEATURE_HELP_CATEGORIES,
  FEATURE_HELP_CATEGORY_LABELS,
  featureHelp,
  searchFeatureHelp,
  type FeatureHelpEntry,
  type FeatureHelpId,
} from '@sampledge/contracts';
import { cn } from '@sampledge/ui';

/**
 * The gold-ringed "i" next to a feature. It opens a short guide (what, why, where, how) from the
 * shared content in @sampledge/contracts, so web and mobile explain features the same way.
 *
 * Brand colors are fixed (SampConnect green and gold), not the theme accent, so the symbol reads
 * as the same help mark on every theme.
 */
const OPEN_GUIDE = 'sc:open-feature-guide';

/** Opens the full feature guide, optionally at one feature. */
export function openFeatureGuide(id?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_GUIDE, { detail: id ?? null }));
}

export function FeatureHelp({
  id,
  className,
  size = 'md',
  inDialog = false,
}: {
  id: FeatureHelpId;
  className?: string;
  size?: 'sm' | 'md';
  /** Inside a modal dialog, open the full guide on top instead of a popover. */
  inDialog?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState<string>(id);
  const [pos, setPos] = React.useState<React.CSSProperties>({});
  const trigger = React.useRef<HTMLButtonElement>(null);
  const entry = featureHelp(current) ?? featureHelp(id);

  const place = React.useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 640) {
      setPos({ left: 8, right: 8, bottom: 8, maxHeight: vh - 72 });
      return;
    }
    const width = Math.min(380, vw - 24);
    const left = Math.max(12, Math.min(r.left - 16, vw - width - 12));
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    if (below >= 360 || below >= above)
      setPos({ left, top: r.bottom + 10, width, maxHeight: below - 8 });
    else setPos({ left, bottom: vh - r.top + 10, width, maxHeight: above - 8 });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, place]);

  if (!entry) return null;
  if (inDialog)
    return (
      <HelpMark
        label={`About ${entry.title}`}
        size={size}
        className={className}
        onClick={() => openFeatureGuide(id)}
      />
    );
  return (
    <DialogPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setCurrent(id);
          place();
        }
        setOpen(o);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <HelpMark
          ref={trigger}
          label={`About ${featureHelp(id)!.title}`}
          size={size}
          className={className}
        />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="feature-help"
          style={pos}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed z-[80] flex flex-col overflow-hidden rounded-2xl border border-[#F5B83D]/40 bg-surface shadow-2xl shadow-black/30 outline-none data-[state=open]:animate-[sc-dialog-in_var(--sc-duration-base)_var(--sc-ease-emphasized)]"
        >
          <GuideBody
            entry={entry}
            onBack={current !== id ? () => setCurrent(id) : undefined}
            onRelated={setCurrent}
            onAll={() => {
              setOpen(false);
              openFeatureGuide(entry.id);
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const MARK =
  'group relative inline-flex shrink-0 items-center justify-center rounded-full align-middle bg-[radial-gradient(circle_at_30%_25%,#1FA374,#12825C_55%,#0B5A41)] text-[#F8C95A] shadow-[0_0_0_1.5px_#F5B83D,0_2px_6px_rgba(15,107,79,0.35)]';

function Glyph({ size }: { size: 'sm' | 'md' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={size === 'sm' ? 'size-3' : 'size-3.5'}>
      <circle cx="12" cy="5.6" r="2.2" fill="currentColor" />
      <path d="M9.4 10h4.1v8.2h1.6V20H8.9v-1.8h1.7v-6.4H9.4z" fill="currentColor" />
    </svg>
  );
}

/** The symbol without a button, for use inside another control. */
export function HelpBadge({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(MARK, size === 'sm' ? 'size-[18px]' : 'size-[22px]', className)}
    >
      <Glyph size={size} />
    </span>
  );
}

/** The help symbol itself: a green disc, gold ring, gold "i". */
export const HelpMark = React.forwardRef<
  HTMLButtonElement,
  {
    label: string;
    size?: 'sm' | 'md';
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function HelpMark({ label, size = 'md', className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      data-feature-help
      {...props}
      className={cn(
        MARK,
        'transition-[transform,box-shadow] duration-200 hover:scale-110 hover:shadow-[0_0_0_1.5px_#F8C95A,0_0_14px_rgba(245,184,61,0.55)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B83D] focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'data-[state=open]:scale-110 data-[state=open]:shadow-[0_0_0_1.5px_#F8C95A,0_0_14px_rgba(245,184,61,0.55)]',
        size === 'sm' ? 'size-[18px]' : 'size-[22px]',
        className,
      )}
    >
      <Glyph size={size} />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[#F8C95A] opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
});

export function GuideBody({
  entry,
  onBack,
  onRelated,
  onAll,
  primary = true,
  closable = true,
}: {
  entry: FeatureHelpEntry;
  onBack?: () => void;
  onRelated: (id: string) => void;
  onAll?: () => void;
  /** false inside the full guide, which owns the dialog title. */
  primary?: boolean;
  /** false outside a dialog (the Help center page). */
  closable?: boolean;
}) {
  const audience = FEATURE_HELP_AUDIENCE_LABELS[entry.audience];
  const Title = primary ? DialogPrimitive.Title : 'h2';
  const Desc = primary ? DialogPrimitive.Description : 'p';
  return (
    <>
      <div className="relative shrink-0 overflow-hidden bg-[linear-gradient(135deg,#0F6B4F,#12825C_60%,#169a6c)] px-5 pb-4 pt-4 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full bg-[#F5B83D]/25 blur-2xl"
        />
        <div className="relative flex items-start gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="-ml-1 mt-0.5 rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 shadow-[0_0_0_1.5px_#F5B83D]">
              <Sparkles className="size-4 text-[#F8C95A]" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#F8C95A]">
              {FEATURE_HELP_CATEGORY_LABELS[entry.category]}
            </p>
            <Title className="font-display text-h3 leading-tight text-white">{entry.title}</Title>
            <Desc className="mt-1 text-meta text-white/85">{entry.summary}</Desc>
            {audience ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#F5B83D] px-2 py-0.5 text-[11px] font-semibold text-[#3d2a00]">
                <ShieldCheck className="size-3" /> {audience}
              </span>
            ) : null}
          </div>
          {closable ? (
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          ) : null}
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] bg-[linear-gradient(90deg,#F5B83D,#F8C95A_50%,transparent)]"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Part icon={Lightbulb} label="What it is">
          {entry.what}
        </Part>
        <Part icon={Heart} label="Why it helps">
          {entry.why}
        </Part>
        <Part icon={MapPin} label="Where to find it">
          {entry.where.web}
          <span className="mt-1 flex items-start gap-1.5 text-meta text-text-subtle">
            <Smartphone className="mt-0.5 size-3 shrink-0" /> On your phone: {entry.where.mobile}
          </span>
        </Part>
        <section>
          <PartLabel icon={Compass} label="How to use it" />
          <ol className="mt-2 space-y-2">
            {entry.how.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-label font-normal text-text">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#12825C] text-[11px] font-bold text-[#F8C95A]">
                  {i + 1}
                </span>
                <span className="pt-px">{step}</span>
              </li>
            ))}
          </ol>
        </section>
        {entry.tips?.length ? (
          <div className="rounded-xl border border-[#F5B83D]/40 bg-[#F5B83D]/10 px-3 py-2.5">
            {entry.tips.map((t) => (
              <p key={t} className="flex gap-2 text-meta text-text">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#C98A0B]" />
                {t}
              </p>
            ))}
          </div>
        ) : null}
        {entry.related?.length ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              Related
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {entry.related.map((r) => {
                const e = featureHelp(r);
                return e ? (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onRelated(r)}
                    className="rounded-full border border-[#12825C]/40 px-2.5 py-1 text-meta text-text transition-colors hover:border-[#F5B83D] hover:bg-[#12825C]/10"
                  >
                    {e.title}
                  </button>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
      </div>
      {onAll ? (
        <div className="shrink-0 border-t border-border px-5 py-2.5">
          <button
            type="button"
            onClick={onAll}
            className="flex items-center gap-1.5 text-meta font-medium text-[#12825C] hover:underline dark:text-[#4fd1a1]"
          >
            <BookOpen className="size-3.5" /> All feature guides
          </button>
        </div>
      ) : null}
    </>
  );
}

function PartLabel({ icon: Icon, label }: { icon: typeof Heart; label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
      <Icon className="size-3.5 text-[#C98A0B]" /> {label}
    </p>
  );
}

function Part({
  icon,
  label,
  children,
}: {
  icon: typeof Heart;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <PartLabel icon={icon} label={label} />
      <div className="mt-1 text-label font-normal text-text">{children}</div>
    </section>
  );
}

/**
 * The full guide: every feature, searchable, grouped by category. Mounted once in the workspace
 * and opened with openFeatureGuide() (from a help card, the command palette or Settings).
 */
export function FeatureGuideHost({
  isAdmin,
  isPlatform,
}: {
  isAdmin: boolean;
  isPlatform: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    const on = (e: Event) => {
      setSelected((e as CustomEvent<string | null>).detail);
      setQ('');
      setOpen(true);
    };
    window.addEventListener(OPEN_GUIDE, on);
    return () => window.removeEventListener(OPEN_GUIDE, on);
  }, []);

  const visible = (e: FeatureHelpEntry) =>
    e.audience === 'everyone' || (e.audience === 'admins' ? isAdmin : isPlatform);
  const results = searchFeatureHelp(q).filter(visible);
  const entry = selected ? featureHelp(selected) : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[50] bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="feature-guide"
          className="fixed left-1/2 top-1/2 z-[60] flex h-[min(640px,calc(100dvh-2rem))] w-[min(860px,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[#F5B83D]/40 bg-surface shadow-2xl outline-none data-[state=open]:animate-[sc-dialog-in_var(--sc-duration-slow)_var(--sc-ease-emphasized)]"
        >
          <aside
            className={cn(
              'flex w-full shrink-0 flex-col border-r border-border md:w-[300px]',
              entry ? 'hidden md:flex' : 'flex',
            )}
          >
            <div className="bg-[linear-gradient(135deg,#0F6B4F,#12825C)] px-4 pb-3 pt-4 text-white">
              <p className="flex items-center gap-2 font-display text-h3">
                <BookOpen className="size-4 text-[#F8C95A]" /> Feature guides
              </p>
              <DialogPrimitive.Title className="sr-only">Feature guides</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-meta text-white/85">
                What each part of SampConnect does, and how to use it.
              </DialogPrimitive.Description>
              <label className="mt-3 flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-[#F5B83D]">
                <Search className="size-3.5 text-white/80" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search guides"
                  aria-label="Search guides"
                  className="w-full bg-transparent text-label text-white placeholder:text-white/70 focus:outline-none"
                />
              </label>
            </div>
            <nav aria-label="Feature guides" className="min-h-0 flex-1 overflow-y-auto p-2">
              {q.trim() ? (
                results.length ? (
                  results.map((e) => (
                    <GuideLink key={e.id} e={e} active={e.id === selected} onSelect={setSelected} />
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-meta text-text-muted">
                    No guide matches.
                  </p>
                )
              ) : (
                FEATURE_HELP_CATEGORIES.map((c) => {
                  const items = results.filter((e) => e.category === c);
                  return items.length ? (
                    <div key={c} className="mb-2">
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#C98A0B]">
                        {FEATURE_HELP_CATEGORY_LABELS[c]}
                      </p>
                      {items.map((e) => (
                        <GuideLink
                          key={e.id}
                          e={e}
                          active={e.id === selected}
                          onSelect={setSelected}
                        />
                      ))}
                    </div>
                  ) : null;
                })
              )}
            </nav>
          </aside>
          <div className={cn('min-w-0 flex-1 flex-col', entry ? 'flex' : 'hidden md:flex')}>
            {entry ? (
              <GuideBody
                key={entry.id}
                entry={entry}
                onBack={() => setSelected(null)}
                onRelated={setSelected}
                primary={false}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-[#12825C] shadow-[0_0_0_2px_#F5B83D]">
                  <Sparkles className="size-6 text-[#F8C95A]" />
                </span>
                <p className="mt-4 font-display text-h3 text-text">Pick a feature to learn about</p>
                <p className="mt-1 max-w-xs text-meta text-text-muted">
                  Look for the gold <span className="font-semibold">i</span> next to any feature to
                  open its guide right where you are.
                </p>
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="absolute right-3 top-3 rounded-md p-1 text-text-subtle hover:bg-surface-raised"
                >
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function GuideLink({
  e,
  active,
  onSelect,
}: {
  e: FeatureHelpEntry;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(e.id)}
      aria-current={active || undefined}
      className={cn(
        'block w-full rounded-lg px-3 py-2 text-left transition-colors',
        active ? 'bg-[#12825C]/12 ring-1 ring-[#F5B83D]/60' : 'hover:bg-surface-raised',
      )}
    >
      <span className="block text-label text-text">{e.title}</span>
      <span className="block truncate text-meta text-text-subtle">{e.summary}</span>
    </button>
  );
}
