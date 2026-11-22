'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Moon, Pencil, X } from 'lucide-react';
import { AVAILABILITIES, type Availability, type DndSchedule } from '@sampledge/contracts';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogContent,
  Field,
  Input,
  cn,
  useToast,
} from '@sampledge/ui';
import {
  AVAILABILITY_LABEL,
  CLEAR_AFTER,
  clearAfterToDate,
  useMyStatus,
  type ClearAfter,
} from '@/lib/status';
import { FeatureHelp } from '../feature-help';

const DOT: Record<Availability, string> = {
  auto: 'bg-success',
  busy: 'bg-danger',
  away: 'bg-warning',
  dnd: 'bg-danger',
};
const HINT: Record<Availability, string> = {
  auto: 'Online when you’re connected',
  busy: 'Shown as busy. Notifications still arrive',
  away: 'Shown as away while you’re connected',
  dnd: 'No push notifications. Everything still lands here',
};

const PRESETS: { emoji: string; text: string; clear: ClearAfter; availability?: Availability }[] = [
  { emoji: '📅', text: 'In a meeting', clear: '1h', availability: 'busy' },
  { emoji: '🎯', text: 'Focusing', clear: '4h', availability: 'dnd' },
  { emoji: '🚗', text: 'Commuting', clear: '30m' },
  { emoji: '🤒', text: 'Out sick', clear: 'today', availability: 'away' },
  { emoji: '🌴', text: 'On vacation', clear: 'week', availability: 'away' },
  { emoji: '🏠', text: 'Working remotely', clear: 'today' },
];

const EMOJIS = ['💬', '📅', '🎯', '🚗', '🍽️', '🤒', '🌴', '🏠', '✈️', '🎧', '📞', '☕'];

function untilLabel(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `until ${d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Your avatar in the navigation rail. Opens availability, custom status and quiet hours. Every
 * change works offline (queued) and reaches your other devices and everyone else live.
 */
export function StatusMenu({
  userName,
  userAvatar,
  expanded,
  onOpenSettings,
}: {
  userName: string;
  userAvatar?: string | null;
  expanded: boolean;
  onOpenSettings: () => void;
}) {
  const { status, dnd, schedule, setStatus } = useMyStatus();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dot =
    dnd || status.availability === 'busy'
      ? 'dnd'
      : status.availability === 'away'
        ? 'away'
        : 'online';
  const scheduledQuiet = dnd && status.availability !== 'dnd';
  const custom = status.text || status.emoji;

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Expanded, the visible name and status are the accessible name.
        aria-label={
          expanded
            ? undefined
            : `Your status: ${dnd ? 'Do not disturb' : AVAILABILITY_LABEL[status.availability]}${status.text ? `, ${status.text}` : ''}`
        }
        aria-haspopup="menu"
        data-testid="status-button"
        className={cn(
          'flex w-full min-w-0 items-center gap-3 rounded-md text-left hover:bg-surface-raised',
          expanded ? 'px-1.5 py-1' : 'justify-center p-0.5',
        )}
      >
        <Avatar name={userName} src={userAvatar} size="sm" presence={dot} />
        {expanded ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label text-text">{userName}</span>
            <span className="block truncate text-meta text-text-subtle">
              {custom
                ? `${status.emoji ?? ''} ${status.text ?? ''}`.trim()
                : dnd
                  ? 'Do not disturb'
                  : AVAILABILITY_LABEL[status.availability]}
            </span>
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="Your status"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setEditing(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-left hover:bg-surface-raised"
            >
              <span className="text-[16px]" aria-hidden>
                {status.emoji ?? '💬'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-text">
                  {status.text ?? 'Set a status message'}
                </span>
                {status.expiresAt ? (
                  <span className="block text-meta text-text-subtle">
                    Clears {untilLabel(status.expiresAt)?.replace(/^until /, 'at ')}
                  </span>
                ) : null}
              </span>
              <Pencil className="size-3.5 text-text-subtle" aria-hidden />
            </button>
            <p className="px-2.5 pb-1 pt-2 text-overline uppercase text-text-subtle">
              Availability
            </p>
            {AVAILABILITIES.map((a) => (
              <button
                key={a}
                role="menuitemradio"
                aria-checked={status.availability === a}
                onClick={() => {
                  setOpen(false);
                  setStatus({ ...status, availability: a });
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-raised"
              >
                <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[a])} />
                <span className="min-w-0 flex-1">
                  <span className="block text-label text-text">{AVAILABILITY_LABEL[a]}</span>
                  <span className="block text-meta text-text-subtle">{HINT[a]}</span>
                </span>
                {status.availability === a ? (
                  <Check className="mt-0.5 size-4 text-accent" aria-hidden />
                ) : null}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-raised"
            >
              <Moon className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-label text-text">Quiet hours</span>
                <span className="block text-meta text-text-subtle">
                  {scheduledQuiet
                    ? `On now, until ${schedule.end}`
                    : schedule.enabled
                      ? `${schedule.start}–${schedule.end}, ${dayList(schedule.days)}`
                      : 'Off'}
                </span>
              </span>
            </button>
            {custom || status.availability !== 'auto' ? (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setStatus({ availability: 'auto', emoji: null, text: null, expiresAt: null });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-label text-text-muted hover:bg-surface-raised hover:text-text"
              >
                <X className="size-4" aria-hidden />
                Clear status
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <StatusDialog open={editing} onOpenChange={setEditing} />
    </div>
  );
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayList(days: number[]) {
  const s = [...days].sort().join(',');
  if (s === '1,2,3,4,5') return 'weekdays';
  if (s === '0,1,2,3,4,5,6') return 'every day';
  if (s === '0,6') return 'weekends';
  return days.length
    ? [...days]
        .sort()
        .map((d) => DAY_SHORT[d])
        .join(', ')
    : 'no days';
}

/** Custom status: emoji, text, availability and when it clears itself. */
export function StatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { status, setStatus } = useMyStatus();
  const [emoji, setEmoji] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [availability, setAvailability] = React.useState<Availability>('auto');
  const [clear, setClear] = React.useState<ClearAfter>('today');
  React.useEffect(() => {
    if (!open) return;
    setEmoji(status.emoji);
    setText(status.text ?? '');
    setAvailability(status.availability);
    setClear(status.expiresAt ? 'today' : status.text ? 'never' : 'today');
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Set a status"
        description="People see it next to your name across SampConnect."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStatus({
              availability,
              emoji: text.trim() || emoji ? (emoji ?? '💬') : null,
              text: text.trim() || null,
              expiresAt: clearAfterToDate(clear),
            });
            onOpenChange(false);
          }}
        >
          <div className="flex items-center gap-2">
            <EmojiPicker value={emoji} onChange={setEmoji} />
            <Input
              aria-label="Status message"
              placeholder="What’s your status?"
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggestions">
            {PRESETS.map((p) => (
              <button
                key={p.text}
                type="button"
                onClick={() => {
                  setEmoji(p.emoji);
                  setText(p.text);
                  setClear(p.clear);
                  if (p.availability) setAvailability(p.availability);
                }}
                className="rounded-full border border-border px-2.5 py-1 text-meta text-text hover:border-accent hover:bg-accent-soft/40"
              >
                <span aria-hidden>{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Availability" htmlFor="status-availability">
              <select
                id="status-availability"
                value={availability}
                onChange={(e) => setAvailability(e.target.value as Availability)}
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-body text-text"
              >
                {AVAILABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {AVAILABILITY_LABEL[a]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Clear after" htmlFor="status-clear">
              <select
                id="status-clear"
                value={clear}
                onChange={(e) => setClear(e.target.value as ClearAfter)}
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-body text-text"
              >
                {CLEAR_AFTER.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save status</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmojiPicker({ value, onChange }: { value: string | null; onChange: (e: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose an emoji"
        aria-expanded={open}
        className="flex size-10 items-center justify-center rounded-md border border-border text-[18px] hover:bg-surface-raised"
      >
        {value ?? '💬'}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Emoji"
          className="absolute left-0 top-full z-50 mt-1 grid w-48 grid-cols-6 gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={e === value}
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
              className={cn(
                'flex size-7 items-center justify-center rounded text-[16px] hover:bg-surface-raised',
                e === value && 'bg-accent-soft',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Settings card: recurring quiet hours in your time zone. */
export function QuietHoursCard() {
  const { schedule, setSchedule, dnd, status } = useMyStatus();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<DndSchedule>(schedule);
  const key = JSON.stringify(schedule);
  React.useEffect(() => setDraft(schedule), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = React.useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
        'timeZone',
      );
    } catch {
      return [schedule.timeZone];
    }
  }, [schedule.timeZone]);
  const changed = JSON.stringify(draft) !== key;
  const quietNow = dnd && status.availability !== 'dnd';

  return (
    <Card className="mt-6 p-5" data-testid="quiet-hours">
      <div className="flex items-start gap-3">
        <Moon className="mt-0.5 size-5 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-label text-text">Quiet hours</h3>
            <FeatureHelp id="presence" size="sm" inDialog />
          </div>
          <p className="mt-0.5 text-meta text-text-subtle">
            Do not disturb on a schedule. No push notifications during these hours; messages,
            mentions and calls still show in the app. Applies on every device.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="Quiet hours"
          onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
            draft.enabled ? 'border-accent bg-accent' : 'border-border-strong bg-surface-raised',
          )}
        >
          <span
            className={cn(
              'inline-block size-4 rounded-full shadow transition-transform motion-reduce:transition-none',
              draft.enabled ? 'translate-x-6 bg-accent-fg' : 'translate-x-1 bg-text',
            )}
          />
        </button>
      </div>
      <fieldset
        disabled={!draft.enabled}
        className={cn('mt-4 grid gap-4', !draft.enabled && 'opacity-60')}
      >
        <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
          {DAY_SHORT.map((d, i) => {
            const on = draft.days.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    ...draft,
                    days: on
                      ? draft.days.filter((x) => x !== i)
                      : [...draft.days, i].sort((a, b) => a - b),
                  })
                }
                className={cn(
                  'h-8 min-w-11 rounded-full border px-3 text-meta font-medium',
                  on
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border text-text hover:bg-surface-raised',
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From" htmlFor="quiet-start">
            <Input
              id="quiet-start"
              type="time"
              value={draft.start}
              onChange={(e) => e.target.value && setDraft({ ...draft, start: e.target.value })}
            />
          </Field>
          <Field label="Until" htmlFor="quiet-end">
            <Input
              id="quiet-end"
              type="time"
              value={draft.end}
              onChange={(e) => e.target.value && setDraft({ ...draft, end: e.target.value })}
            />
          </Field>
          <Field label="Time zone" htmlFor="quiet-zone">
            <select
              id="quiet-zone"
              value={draft.timeZone}
              onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-body text-text"
            >
              {(zones.includes(draft.timeZone) ? zones : [draft.timeZone, ...zones]).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-meta text-text-muted" aria-live="polite">
          {quietNow
            ? 'Quiet hours are on right now.'
            : draft.end < draft.start && draft.enabled
              ? 'Runs past midnight.'
              : ''}
        </p>
        <Button
          size="sm"
          disabled={!changed}
          onClick={() => {
            setSchedule(draft);
            toast({ title: 'Quiet hours saved', tone: 'success' });
          }}
        >
          Save quiet hours
        </Button>
      </div>
    </Card>
  );
}

/** Settings card: your status, for screens without the navigation rail (phones). */
export function StatusCard() {
  const { status, dnd, setStatus } = useMyStatus();
  const [editing, setEditing] = React.useState(false);
  const custom = status.text || status.emoji;
  return (
    <Card className="mt-6 flex items-center gap-3 p-5" data-testid="status-card">
      <span className="text-[20px]" aria-hidden>
        {status.emoji ?? '💬'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-label text-text">Status</h3>
          <FeatureHelp id="presence" size="sm" inDialog />
        </div>
        <p className="truncate text-meta text-text-subtle">
          {custom ? status.text : 'No status message'} ·{' '}
          {dnd ? 'Do not disturb' : AVAILABILITY_LABEL[status.availability]}
          {status.expiresAt ? ` · ${untilLabel(status.expiresAt)}` : ''}
        </p>
      </div>
      {custom || status.availability !== 'auto' ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setStatus({ availability: 'auto', emoji: null, text: null, expiresAt: null })
          }
        >
          Clear
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Set status
      </Button>
      <StatusDialog open={editing} onOpenChange={setEditing} />
    </Card>
  );
}
