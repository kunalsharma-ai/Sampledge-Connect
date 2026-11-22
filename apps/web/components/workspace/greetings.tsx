'use client';
import * as React from 'react';
import { Gift, PartyPopper, Search, Send, Shuffle, Sparkles, WifiOff } from 'lucide-react';
import {
  GREETING_CATEGORIES,
  GREETING_STYLES,
  GREETING_TONES,
  MAX_GREETING_TITLE,
  MAX_GREETING_TO,
  MAX_MESSAGE_LENGTH,
  greetingOccasion,
  offeredOccasions,
  searchOccasions,
  upcomingOccasions,
  type GreetingCard,
  type GreetingCategory,
  type GreetingOccasion,
  type GreetingPolicy,
  type GreetingStyleId,
} from '@sampledge/contracts';
import { greetingBannerDataUrl, greetingCardLook } from '@sampledge/design-tokens';
import { Button, Dialog, DialogContent, Input, Textarea, cn, useToast } from '@sampledge/ui';
import { useGreetingPolicy } from '@/lib/greetings';
import { FeatureHelp } from '../feature-help';

const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';

function useLook(occasionId: string, styleId: string) {
  return React.useMemo(() => {
    const occ = greetingOccasion(occasionId);
    const look = greetingCardLook(occasionId, styleId, { quiet: occ?.quiet });
    return { look, src: greetingBannerDataUrl(look.svg) };
  }, [occasionId, styleId]);
}

/** A greeting card as it appears in a conversation (and as the live preview in the picker). */
export function GreetingCardView({
  card,
  text,
  from,
  className,
  pending,
}: {
  card: GreetingCard;
  text: string;
  /** Sender's name for the signature line. */
  from?: string | null;
  className?: string;
  pending?: boolean;
}) {
  const { look, src } = useLook(card.occasionId, card.styleId);
  const p = look.panel;
  return (
    <figure
      data-testid="greeting-card"
      className={cn(
        'sc-greeting w-[min(360px,100%)] overflow-hidden rounded-2xl shadow-md ring-1',
        pending && 'opacity-80',
        className,
      )}
      style={{ background: p.bg, color: p.fg, ['--tw-ring-color' as string]: p.border }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="block aspect-[32/15] w-full select-none"
        loading="lazy"
      />
      <figcaption className="-mt-1 px-5 pb-4 pt-0">
        {card.to ? (
          <p className="text-label italic" style={{ color: p.muted, fontFamily: SERIF }}>
            Dear {card.to},
          </p>
        ) : null}
        <p
          className="mt-0.5 text-[1.45rem] font-semibold leading-tight tracking-tight"
          style={{
            fontFamily: look.titleFont === 'serif' ? SERIF : undefined,
            color: p.fg,
          }}
        >
          {card.title}
        </p>
        <span
          aria-hidden
          className="my-2.5 block h-0.5 w-10 rounded-full"
          style={{ background: p.accent }}
        />
        <p className="whitespace-pre-wrap break-words text-message leading-relaxed">{text}</p>
        {from ? (
          <p className="mt-3 text-right text-label" style={{ color: p.muted, fontFamily: SERIF }}>
            With warm wishes, {from}
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

type Pick = 'upcoming' | GreetingCategory;

/**
 * Pick an occasion, a style and a message, edit anything, and send. The card is an ordinary
 * message, so it is saved on the device first and sent when online (works offline).
 */
export function GreetingComposerDialog({
  open,
  onOpenChange,
  onSend,
  recipientName,
  senderName,
  offline,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSend: (card: GreetingCard, text: string) => Promise<void> | void;
  /** First name of the other person in a DM, to prefill "Dear …". */
  recipientName?: string | null;
  senderName: string;
  offline: boolean;
}) {
  const { policy } = useGreetingPolicy();
  const { toast } = useToast();
  const offered = React.useMemo(() => offeredOccasions(policy), [policy]);
  const upcoming = React.useMemo(() => upcomingOccasions(offered), [offered]);
  const [tab, setTab] = React.useState<Pick>('upcoming');
  const [query, setQuery] = React.useState('');
  const [occasionId, setOccasionId] = React.useState<string>('');
  const [styleId, setStyleId] = React.useState<GreetingStyleId>('radiant');
  const [messageIndex, setMessageIndex] = React.useState(0);
  const [title, setTitle] = React.useState('');
  const [to, setTo] = React.useState('');
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const occasion = greetingOccasion(occasionId);

  const choose = React.useCallback((o: GreetingOccasion, keepStyle = true) => {
    setOccasionId(o.id);
    setTitle(o.titles[0] ?? o.name);
    setMessageIndex(0);
    setText(o.messages[0]?.text ?? '');
    if (!keepStyle) setStyleId(o.quiet ? 'minimal' : 'radiant');
    else if (o.quiet) setStyleId((s) => (s === 'festive' ? 'minimal' : s));
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setTo(recipientName ?? '');
    const first = upcoming[0] ?? offered[0];
    setTab(upcoming.length ? 'upcoming' : (offered[0]?.category ?? 'india'));
    if (first) choose(first, false);
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = React.useMemo(() => {
    if (query.trim()) return searchOccasions(offered, query);
    if (tab === 'upcoming') return upcoming;
    return offered.filter((o) => o.category === tab);
  }, [offered, upcoming, query, tab]);

  const tabs: { id: Pick; name: string }[] = [
    ...(upcoming.length ? [{ id: 'upcoming' as const, name: 'Coming up' }] : []),
    ...GREETING_CATEGORIES.filter((c) => !policy.hiddenCategories.includes(c.id)),
  ];

  const pickMessage = (i: number) => {
    if (!occasion) return;
    setMessageIndex(i);
    setText(occasion.messages[i]?.text ?? '');
  };
  const surprise = () => {
    if (!occasion) return;
    const n = occasion.messages.length;
    pickMessage((messageIndex + 1 + Math.floor(Math.random() * (n - 1))) % n);
    const styles = GREETING_STYLES.filter((s) => !(occasion.quiet && s.id === 'festive'));
    setStyleId(styles[Math.floor(Math.random() * styles.length)]!.id);
  };

  const card: GreetingCard | null = occasion
    ? {
        occasionId: occasion.id as GreetingCard['occasionId'],
        styleId,
        title: title.trim() || occasion.titles[0]!,
        to: to.trim() || null,
      }
    : null;
  const valid = !!card && text.trim().length > 0 && text.length <= MAX_MESSAGE_LENGTH;

  const submit = async () => {
    if (!card || !valid) return;
    setBusy(true);
    try {
      await onSend(card, text.trim());
      toast({
        title: offline ? 'Card saved. It sends when you’re back online' : 'Greeting card sent',
        tone: 'success',
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Couldn’t send the card', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Send a greeting card"
        description="Pick an occasion and a style, choose a message or write your own, then send."
        className="w-[min(1020px,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6"
      >
        <div className="mt-4 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,340px)]">
          {/* Occasions */}
          <section aria-label="Occasions" className="flex min-w-0 flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search: Diwali, birthday, Eid…"
                aria-label="Search occasions"
                className="pl-9"
              />
            </div>
            {!query.trim() ? (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Categories">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'h-7 rounded-full px-2.5 text-meta transition-colors',
                      tab === t.id
                        ? 'bg-accent text-accent-fg'
                        : 'bg-surface-raised text-text-muted ring-1 ring-border hover:text-text',
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            ) : null}
            <ul
              className="grid max-h-[220px] grid-cols-2 gap-1.5 overflow-y-auto pr-1 lg:max-h-[440px]"
              data-testid="greeting-occasions"
            >
              {list.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => choose(o)}
                    aria-pressed={o.id === occasionId}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label transition-colors',
                      o.id === occasionId
                        ? 'bg-accent/15 text-text ring-1 ring-accent'
                        : 'bg-surface-raised text-text-muted hover:text-text',
                    )}
                  >
                    <span aria-hidden className="text-lg leading-none">
                      {o.emoji}
                    </span>
                    <span className="line-clamp-2 leading-snug">{o.name}</span>
                  </button>
                </li>
              ))}
              {!list.length ? (
                <li className="col-span-2 px-2 py-6 text-center text-meta text-text-subtle">
                  No occasions match “{query}”.
                </li>
              ) : null}
            </ul>
          </section>

          {/* Style, message and edits */}
          <section aria-label="Card details" className="flex min-w-0 flex-col gap-4">
            {occasion ? (
              <>
                <div>
                  <p className="mb-1.5 text-label text-text">Style</p>
                  <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Style">
                    {GREETING_STYLES.map((s) => (
                      <StyleTile
                        key={s.id}
                        occasionId={occasion.id}
                        styleId={s.id}
                        name={s.name}
                        description={s.description}
                        selected={s.id === styleId}
                        onSelect={() => setStyleId(s.id)}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-label text-text">Message</p>
                    <Button type="button" variant="ghost" size="sm" onClick={surprise}>
                      <Shuffle /> Surprise me
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Message">
                    {occasion.messages.map((m, i) => (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={i === messageIndex && text === m.text}
                        onClick={() => pickMessage(i)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-left transition-colors',
                          i === messageIndex && text === m.text
                            ? 'bg-accent/12 ring-1 ring-accent'
                            : 'bg-surface-raised ring-1 ring-border hover:ring-border-strong',
                        )}
                      >
                        <span className="block text-meta font-medium text-accent">
                          {GREETING_TONES.find((t) => t.id === m.tone)?.name}
                        </span>
                        <span className="line-clamp-2 text-meta text-text-muted">{m.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-label text-text">
                    Headline
                    <Input
                      value={title}
                      maxLength={MAX_GREETING_TITLE}
                      onChange={(e) => setTitle(e.target.value)}
                      list="greeting-titles"
                    />
                    <datalist id="greeting-titles">
                      {occasion.titles.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </label>
                  <label className="flex flex-col gap-1.5 text-label text-text">
                    To (optional)
                    <Input
                      value={to}
                      maxLength={MAX_GREETING_TO}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="Priya, team, everyone"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5 text-label text-text">
                  <span className="flex items-center justify-between">
                    Your words
                    <span className="text-meta font-normal text-text-subtle">
                      Edit freely. It’s your card.
                    </span>
                  </span>
                  <Textarea
                    value={text}
                    rows={4}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="Message"
                  />
                </label>
              </>
            ) : (
              <p className="py-10 text-center text-label text-text-subtle">
                Greeting cards aren’t available in this organization.
              </p>
            )}
          </section>

          {/* Preview */}
          <section aria-label="Preview" className="flex min-w-0 flex-col gap-3">
            <p className="flex items-center gap-1.5 text-label text-text">
              Preview <FeatureHelp id="greeting-cards" size="sm" inDialog />
            </p>
            {card ? (
              <GreetingCardView
                card={card}
                text={text.trim() || '…'}
                from={senderName}
                className="w-full"
              />
            ) : null}
            {offline ? (
              <p className="flex items-center gap-1.5 text-meta text-warning">
                <WifiOff className="size-3.5" /> You’re offline. The card sends when you reconnect.
              </p>
            ) : null}
            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={!valid} loading={busy}>
                <Send /> Send card
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StyleTile({
  occasionId,
  styleId,
  name,
  description,
  selected,
  onSelect,
}: {
  occasionId: string;
  styleId: string;
  name: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { look, src } = useLook(occasionId, styleId);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${name}: ${description}`}
      title={description}
      onClick={onSelect}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg text-left ring-1 transition-all',
        selected
          ? 'ring-2 ring-accent'
          : 'ring-border hover:-translate-y-px hover:ring-border-strong',
      )}
      style={{ background: look.panel.bg }}
    >
      <img src={src} alt="" className="block aspect-[32/15] w-full" draggable={false} />
      <span
        className="truncate px-1.5 pb-1 text-[11px] font-medium"
        style={{ color: look.panel.fg }}
      >
        {name}
      </span>
    </button>
  );
}

/** The composer's greeting button. Hidden when the organization turned greeting cards off. */
export function GreetingButton({ onClick }: { onClick: () => void }) {
  const { policy } = useGreetingPolicy();
  if (!policy.enabled || !offeredOccasions(policy).length) return null;
  return (
    <button
      type="button"
      aria-label="Send a greeting card"
      title="Send a greeting card"
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-text"
      data-testid="greeting-button"
    >
      <Gift className="size-4" />
    </button>
  );
}

/** Administration → Greeting cards. */
export function GreetingsAdmin() {
  const { policy, savePolicy, online } = useGreetingPolicy();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<GreetingPolicy>(policy);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setDraft(policy), [policy]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const counts = React.useMemo(
    () =>
      Object.fromEntries(
        GREETING_CATEGORIES.map((c) => [
          c.id,
          offeredOccasions({ enabled: true, hiddenCategories: [] }).filter(
            (o) => o.category === c.id,
          ).length,
        ]),
      ),
    [],
  );
  const sample = (id: string, style: GreetingStyleId) => ({
    occasionId: id as GreetingCard['occasionId'],
    styleId: style,
    title: greetingOccasion(id)?.titles[0] ?? '',
    to: null,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="greetings-admin">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-h3 text-text">
          <PartyPopper className="size-5 text-accent" /> Greeting cards
          <FeatureHelp id="greeting-cards" size="sm" />
        </h2>
        <p className="mt-1 text-label text-text-muted">
          Ready-made cards for festivals and special moments that people can send in any chat, with
          heartfelt messages they can edit. Cards are ordinary messages: they work offline and sync
          to every device.
        </p>
        <label className="mt-5 flex items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-label="Offer greeting cards"
            onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
            className={cn(
              'mt-0.5 h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors',
              draft.enabled ? 'bg-accent' : 'bg-surface-sunken ring-1 ring-border',
            )}
          >
            <span
              className={cn(
                'block size-5 rounded-full bg-white shadow transition-transform',
                draft.enabled && 'translate-x-4',
              )}
            />
          </button>
          <span>
            <span className="block text-label text-text">Offer greeting cards</span>
            <span className="block text-meta text-text-subtle">
              When off, the card button disappears for everyone. Cards already sent stay in chats.
            </span>
          </span>
        </label>
        <fieldset className="mt-5" disabled={!draft.enabled}>
          <legend className="text-label text-text">Categories people can choose from</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {GREETING_CATEGORIES.map((c) => {
              const on = !draft.hiddenCategories.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-label text-text',
                    !draft.enabled && 'opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        hiddenCategories: on
                          ? [...d.hiddenCategories, c.id]
                          : d.hiddenCategories.filter((x) => x !== c.id),
                      }))
                    }
                    className="size-4 accent-[var(--sc-accent)]"
                  />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-meta text-text-subtle">{counts[c.id]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-5 flex items-center justify-end gap-3">
          {!online ? (
            <span className="text-meta text-warning">Saving needs a connection</span>
          ) : null}
          <Button
            disabled={!dirty || !online}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await savePolicy(draft);
                toast({ title: 'Greeting card rules saved', tone: 'success' });
              } catch (e) {
                toast({
                  title: 'Couldn’t save',
                  description: (e as Error).message,
                  tone: 'danger',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </section>
      <aside className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 text-label text-text-muted">
          <Sparkles className="size-4 text-accent" /> What people see
        </p>
        <GreetingCardView
          card={sample('diwali', 'elegant')}
          text="May every diya you light tonight bring a little more warmth into your home."
          from="Aarav"
          className="w-full"
        />
      </aside>
    </div>
  );
}
