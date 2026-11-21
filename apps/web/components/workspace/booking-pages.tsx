'use client';
import * as React from 'react';
import { Check, Copy, ExternalLink, Link2, Plus, Trash2, X } from 'lucide-react';
import type { BookingPage } from '@sampledge/contracts';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  Textarea,
  cn,
} from '@sampledge/ui';
import { useEngineChange, type DirectoryEntry } from '@/lib/engine';
import { useMeetingsApi } from '@/lib/meetings';
import { nameOf } from './helpers';

const select =
  'h-10 w-full rounded-md border border-border bg-surface-sunken px-2 text-body text-text';
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

interface Draft {
  bookingPageId?: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  hostIds: string[];
  mode: 'all' | 'any';
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
  enabled: boolean;
}

/**
 * Booking pages: public links where people outside the organization pick a time with you or
 * your team. Free times follow each host's working hours and meetings.
 */
export function BookingPagesDialog({
  open,
  onOpenChange,
  me,
  directory,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const api = useMeetingsApi();
  const [pages, setPages] = React.useState<BookingPage[] | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');

  const load = React.useCallback(
    () =>
      api
        .bookingPages()
        .then(setPages)
        .catch((e) => setError((e as Error).message)),
    [api],
  );
  React.useEffect(() => {
    if (!open) return;
    setDraft(null);
    setError(null);
    void load();
  }, [open, load]);
  // Changes by any host, on any device, arrive live (and everything refetches after a reconnect).
  useEngineChange(['meetings'], (e) => {
    if (!open) return;
    if (e.type === 'reconnected' || (e.type === 'meetings' && e.area === 'booking_pages'))
      void load();
  });

  const startNew = () =>
    setDraft({
      slug: slugify(`${nameOf(me, directory)} intro`),
      title: 'Intro call',
      description: '',
      durationMinutes: 30,
      hostIds: [me],
      mode: 'any',
      bufferMinutes: 10,
      minNoticeMinutes: 240,
      horizonDays: 30,
      enabled: true,
    });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { bookingPageId, ...body } = draft;
      if (bookingPageId) await api.updateBookingPage(bookingPageId, body);
      else await api.createBookingPage(body);
      setDraft(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const people = [...directory.values()].filter(
    (u) =>
      u.status === 'active' &&
      !draft?.hostIds.includes(u.userId) &&
      (!q || u.displayName.toLowerCase().includes(q.toLowerCase())),
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          draft ? (draft.bookingPageId ? 'Edit booking page' : 'New booking page') : 'Booking pages'
        }
        description="Share a link and people outside your organization pick a time when you, or your team, are free."
        className="w-[min(640px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {draft ? (
          <div className="space-y-4" data-testid="booking-editor">
            <Field label="Title" htmlFor="bp-title">
              <Input
                id="bp-title"
                value={draft.title}
                maxLength={120}
                onChange={(e) => set('title', e.target.value)}
              />
            </Field>
            <Field label="Link" htmlFor="bp-slug">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-meta text-text-subtle">…/book/</span>
                <Input
                  id="bp-slug"
                  value={draft.slug}
                  maxLength={60}
                  onChange={(e) =>
                    set('slug', slugify(e.target.value) || e.target.value.toLowerCase())
                  }
                />
              </div>
            </Field>
            <Field label="Description (optional)" htmlFor="bp-desc">
              <Textarea
                id="bp-desc"
                rows={2}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>

            <div>
              <label htmlFor="bp-hosts" className="text-label text-text">
                Hosts
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {draft.hostIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-0.5 pl-1 pr-2 text-meta text-text"
                  >
                    <Avatar name={nameOf(id, directory)} size="xs" />
                    {id === me ? 'You' : nameOf(id, directory)}
                    {draft.hostIds.length > 1 ? (
                      <button
                        aria-label={`Remove ${nameOf(id, directory)}`}
                        onClick={() =>
                          set(
                            'hostIds',
                            draft.hostIds.filter((x) => x !== id),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              <Input
                id="bp-hosts"
                className="mt-2"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Add teammates by name"
              />
              {q ? (
                <ul className="mt-1 max-h-36 overflow-y-auto rounded-md border border-border bg-surface">
                  {people.slice(0, 6).map((u) => (
                    <li key={u.userId}>
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"
                        onClick={() => {
                          set('hostIds', [...draft.hostIds, u.userId]);
                          setQ('');
                        }}
                      >
                        <Avatar name={u.displayName} size="xs" />
                        <span className="text-label text-text">{u.displayName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Length" htmlFor="bp-dur">
                <select
                  id="bp-dur"
                  className={select}
                  value={draft.durationMinutes}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}
                >
                  {[15, 20, 30, 45, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Who attends" htmlFor="bp-mode">
                <select
                  id="bp-mode"
                  className={select}
                  value={draft.mode}
                  onChange={(e) => set('mode', e.target.value as Draft['mode'])}
                  disabled={draft.hostIds.length < 2}
                >
                  <option value="any">Any one free host</option>
                  <option value="all">All hosts</option>
                </select>
              </Field>
              <Field label="Gap between meetings" htmlFor="bp-buf">
                <select
                  id="bp-buf"
                  className={select}
                  value={draft.bufferMinutes}
                  onChange={(e) => set('bufferMinutes', Number(e.target.value))}
                >
                  {[0, 5, 10, 15, 30].map((d) => (
                    <option key={d} value={d}>
                      {d ? `${d} min` : 'None'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Earliest booking" htmlFor="bp-notice">
                <select
                  id="bp-notice"
                  className={select}
                  value={draft.minNoticeMinutes}
                  onChange={(e) => set('minNoticeMinutes', Number(e.target.value))}
                >
                  <option value={0}>Any time</option>
                  <option value={60}>1 h from now</option>
                  <option value={240}>4 h from now</option>
                  <option value={1440}>Next day</option>
                  <option value={2880}>2 days ahead</option>
                </select>
              </Field>
              <Field label="Book up to" htmlFor="bp-horizon">
                <select
                  id="bp-horizon"
                  className={select}
                  value={draft.horizonDays}
                  onChange={(e) => set('horizonDays', Number(e.target.value))}
                >
                  {[7, 14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} days ahead
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status" htmlFor="bp-enabled">
                <select
                  id="bp-enabled"
                  className={select}
                  value={draft.enabled ? 'on' : 'off'}
                  onChange={(e) => set('enabled', e.target.value === 'on')}
                >
                  <option value="on">Taking bookings</option>
                  <option value="off">Paused</option>
                </select>
              </Field>
            </div>
            <p className="text-meta text-text-subtle">
              Free times follow each host’s working hours and meetings. Bookings arrive as meetings
              in your calendar, with the booker invited as a guest.
            </p>
            {error ? <p className="text-meta text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Back
              </Button>
              <Button
                onClick={() => void save()}
                loading={saving}
                disabled={!draft.title.trim() || draft.slug.length < 3}
              >
                <Check /> Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="booking-pages">
            {pages === null ? (
              <p className="text-meta text-text-subtle">Loading…</p>
            ) : pages.length === 0 ? (
              <StateView
                state="empty"
                title="No booking pages yet"
                description="Create one and share its link in your email signature or proposals."
              />
            ) : (
              <ul className="space-y-2">
                {pages.map((p) => (
                  <li
                    key={p.bookingPageId}
                    className="rounded-lg border border-border bg-surface px-3 py-2.5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                        <Link2 className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-label text-text">
                          <span className="truncate">{p.title}</span>
                          {!p.enabled ? <Badge tone="warning">Paused</Badge> : null}
                        </p>
                        <p className="truncate text-meta text-text-subtle">
                          {p.durationMinutes} min ·{' '}
                          {p.hostIds.length === 1
                            ? 'Just you'
                            : `${p.hostIds.length} hosts · ${p.mode === 'all' ? 'all attend' : 'any one free host'}`}
                        </p>
                        <p className="truncate text-meta text-accent">{p.url}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label="Copy link"
                          onClick={() => {
                            void navigator.clipboard?.writeText(p.url);
                            setCopied(p.bookingPageId);
                            setTimeout(() => setCopied(null), 1500);
                          }}
                        >
                          {copied === p.bookingPageId ? <Check /> : <Copy />}
                        </Button>
                        <a href={p.url} target="_blank" rel="noreferrer" aria-label="Open page">
                          <Button size="sm" variant="ghost">
                            <ExternalLink />
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraft({
                              bookingPageId: p.bookingPageId,
                              slug: p.slug,
                              title: p.title,
                              description: p.description,
                              durationMinutes: p.durationMinutes,
                              hostIds: p.hostIds,
                              mode: p.mode,
                              bufferMinutes: p.bufferMinutes,
                              minNoticeMinutes: p.minNoticeMinutes,
                              horizonDays: p.horizonDays,
                              enabled: p.enabled,
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete page"
                          className={cn('text-danger hover:bg-danger/10 hover:text-danger')}
                          onClick={() =>
                            void api
                              .removeBookingPage(p.bookingPageId)
                              .then(load)
                              .catch((e) => setError((e as Error).message))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {error ? <p className="text-meta text-danger">{error}</p> : null}
            <div className="flex justify-end">
              <Button onClick={startNew}>
                <Plus /> New booking page
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
