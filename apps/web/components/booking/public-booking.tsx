'use client';
import * as React from 'react';
import {
  CalendarCheck,
  CalendarClock,
  Clock,
  Globe,
  Mic,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import type {
  BookingConfirmation,
  BookingSlotsResponse,
  PublicBookingPage,
} from '@sampledge/contracts';
import { Button, Field, Input, StateView, Textarea, cn } from '@sampledge/ui';
import { Wordmark } from '@/components/brand';
import { ApiFailure, apiRequest } from '@/lib/api';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

type Slot = BookingSlotsResponse['slots'][number];

/**
 * The public booking page (`/book/<slug>`): pick a day, a free time, leave a name and email.
 * Times are shown in the visitor's own time zone. Free times refresh every 30 seconds and right
 * before booking, so a time someone else just took disappears.
 */
export function PublicBooking({ slug }: { slug: string }) {
  const base = `/v1/book/${encodeURIComponent(slug)}`;
  const [page, setPage] = React.useState<PublicBookingPage | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [day, setDay] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Slot | null>(null);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<BookingConfirmation | null>(null);

  const loadSlots = React.useCallback(async () => {
    const from = new Date();
    const out: Slot[] = [];
    // Up to four 14-day pages (the page's own horizon is at most 90 days).
    for (let i = 0; i < 4; i++) {
      const a = new Date(from.getTime() + i * 14 * 86_400_000);
      const b = new Date(a.getTime() + 14 * 86_400_000);
      const r = await apiRequest<BookingSlotsResponse>(
        'GET',
        `${base}/slots?from=${encodeURIComponent(a.toISOString())}&to=${encodeURIComponent(b.toISOString())}`,
      );
      out.push(...r.slots);
      if (page && b.toISOString() > page.closesAt) break;
    }
    setSlots(out);
    return out;
  }, [base, page]);

  React.useEffect(() => {
    apiRequest<PublicBookingPage>('GET', base)
      .then(setPage)
      .catch((e) => {
        if (e instanceof ApiFailure && e.status === 404) setMissing(true);
        else setError((e as Error).message);
      });
  }, [base]);

  React.useEffect(() => {
    if (!page || done) return;
    void loadSlots().catch((e) => setError((e as Error).message));
    const t = setInterval(() => void loadSlots().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, [page, done, loadSlots]);

  const byDay = React.useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = dayKey(new Date(s.startsAt));
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots]);
  const days = [...byDay.keys()];
  const activeDay = day && byDay.has(day) ? day : (days[0] ?? null);
  React.useEffect(() => {
    if (picked && !slots?.some((s) => s.startsAt === picked.startsAt)) setPicked(null);
  }, [slots, picked]);

  const book = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest<BookingConfirmation>('POST', base, {
        body: {
          startsAt: picked.startsAt,
          name: name.trim(),
          email: email.trim(),
          notes,
          timeZone: LOCAL_TZ,
        },
      });
      setDone(r);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiFailure && e.status === 409) {
        setPicked(null);
        void loadSlots();
      }
    } finally {
      setBusy(false);
    }
  };

  if (missing)
    return (
      <Shell>
        <StateView
          state="empty"
          title="This booking page isn’t available"
          description="The link may be wrong, or the page was turned off. Ask the person who shared it for a new link."
        />
      </Shell>
    );
  if (!page)
    return (
      <Shell>
        {error ? (
          <StateView state="error" title="Couldn’t load this page" description={error} />
        ) : (
          <StateView state="loading" title="Loading…" />
        )}
      </Shell>
    );

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Shell>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section
          className="rounded-2xl border border-border bg-surface/80 p-6 shadow-sm backdrop-blur"
          data-testid="booking-info"
        >
          <p className="text-meta uppercase tracking-wide text-text-subtle">
            {page.organizationName}
          </p>
          <h1 className="mt-2 font-display text-h2 text-text">{page.title}</h1>
          {page.description ? (
            <p className="mt-2 whitespace-pre-wrap text-label font-normal text-text-muted">
              {page.description}
            </p>
          ) : null}
          <dl className="mt-5 space-y-2.5 text-label font-normal text-text-muted">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-text-subtle" />
              <dt className="sr-only">Length</dt>
              <dd>{page.durationMinutes} minutes</dd>
            </div>
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 size-4 text-text-subtle" />
              <dt className="sr-only">With</dt>
              <dd>
                {page.mode === 'all' || page.hosts.length === 1
                  ? `With ${page.hosts.map((h) => h.name).join(', ')}`
                  : `With one of ${page.hosts.map((h) => h.name).join(', ')}`}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              {page.media === 'video' ? (
                <Video className="size-4 text-text-subtle" />
              ) : (
                <Mic className="size-4 text-text-subtle" />
              )}
              <dt className="sr-only">Where</dt>
              <dd>
                {page.media === 'video' ? 'Video' : 'Audio'} call in your browser, no account needed
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-text-subtle" />
              <dt className="sr-only">Time zone</dt>
              <dd>Times shown in your time zone ({LOCAL_TZ})</dd>
            </div>
          </dl>
        </section>

        <section
          className="rounded-2xl border border-border bg-surface/80 p-6 shadow-sm backdrop-blur"
          aria-label="Pick a time"
        >
          {done ? (
            <div className="space-y-4" data-testid="booking-done">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
                <CalendarCheck className="size-6" />
              </span>
              <h2 className="font-display text-h3 text-text">You’re booked</h2>
              <p className="text-label font-normal text-text-muted">
                {longDay.format(new Date(done.startsAt))} · {time.format(new Date(done.startsAt))} –{' '}
                {time.format(new Date(done.endsAt))} with {done.hostNames.join(', ')}.
              </p>
              <p className="text-label font-normal text-text-muted">
                {done.emailed
                  ? `We emailed a calendar invite with your join link to ${email.trim()}.`
                  : 'Keep this join link: you’ll use it to join the call.'}
              </p>
              <a href={done.joinUrl}>
                <Button>
                  <CalendarClock /> Open your meeting page
                </Button>
              </a>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-label text-text">Pick a day</h2>
                {slots === null ? (
                  <p className="mt-2 text-meta text-text-subtle">Finding free times…</p>
                ) : days.length === 0 ? (
                  <p className="mt-2 text-meta text-text-subtle">
                    No free times right now. Please check back later.
                  </p>
                ) : (
                  <div
                    className="mt-2 flex gap-2 overflow-x-auto pb-1"
                    role="listbox"
                    aria-label="Days"
                  >
                    {days.map((k) => {
                      const d = new Date(byDay.get(k)![0]!.startsAt);
                      const on = k === activeDay;
                      return (
                        <button
                          key={k}
                          role="option"
                          aria-selected={on}
                          onClick={() => {
                            setDay(k);
                            setPicked(null);
                          }}
                          className={cn(
                            'flex min-w-16 shrink-0 flex-col items-center rounded-lg border px-3 py-2 transition-colors',
                            on
                              ? 'border-accent bg-accent text-accent-fg'
                              : 'border-border bg-surface text-text hover:border-accent',
                          )}
                        >
                          <span className="text-meta uppercase">{weekday.format(d)}</span>
                          <span className="text-label">{dayNum.format(d)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {activeDay ? (
                <div>
                  <h2 className="text-label text-text">
                    {longDay.format(new Date(byDay.get(activeDay)![0]!.startsAt))}
                  </h2>
                  <div
                    className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
                    data-testid="booking-times"
                  >
                    {byDay.get(activeDay)!.map((s) => {
                      const on = picked?.startsAt === s.startsAt;
                      return (
                        <button
                          key={s.startsAt}
                          aria-pressed={on}
                          onClick={() => setPicked(s)}
                          className={cn(
                            'rounded-md border px-2 py-2 text-label transition-colors',
                            on
                              ? 'border-accent bg-accent text-accent-fg'
                              : 'border-border bg-surface text-text hover:border-accent',
                          )}
                        >
                          {time.format(new Date(s.startsAt))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {picked ? (
                <form
                  className="space-y-3 border-t border-border pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void book();
                  }}
                >
                  <p className="text-label text-text">
                    {longDay.format(new Date(picked.startsAt))} ·{' '}
                    {time.format(new Date(picked.startsAt))} –{' '}
                    {time.format(new Date(picked.endsAt))}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Your name" htmlFor="bk-name">
                      <Input
                        id="bk-name"
                        value={name}
                        maxLength={80}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field label="Email" htmlFor="bk-email">
                      <Input
                        id="bk-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Anything to share before the call? (optional)" htmlFor="bk-notes">
                    <Textarea
                      id="bk-notes"
                      rows={3}
                      maxLength={1000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" loading={busy} disabled={!name.trim() || !validEmail}>
                    <CalendarCheck /> Book this time
                  </Button>
                </form>
              ) : null}
              {error ? <p className="text-meta text-danger">{error}</p> : null}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sc-noise relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 right-[-120px] size-[480px] rounded-full bg-accent2/15 blur-[120px]" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex items-center justify-between">
          <Wordmark />
          <span className="flex items-center gap-1.5 text-meta text-text-subtle">
            <ShieldCheck className="size-3.5" /> No account needed
          </span>
        </header>
        {children}
      </div>
    </main>
  );
}
