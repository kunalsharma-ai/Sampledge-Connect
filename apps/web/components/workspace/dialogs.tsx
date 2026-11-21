'use client';
import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Hash, Lock, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import type { Conversation, CreateConversationRequest, UserSummary } from '@sampledge/contracts';
import { createBrandTheme, type BrandThemeInput } from '@sampledge/design-tokens';
import {
  Avatar,
  Badge,
  Button,
  ConnectivityIndicator,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  ThemePicker,
  cn,
  useTheme,
  useToast,
} from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEngine } from '@/lib/engine';
import { BrowserNotificationsCard } from './browser-notifications';
import { relativeShort } from './helpers';

type Kind = 'dm' | 'group' | 'channel_public' | 'channel_private';

const KINDS: { id: Kind; label: string; icon: typeof Hash }[] = [
  { id: 'dm', label: 'Direct', icon: UserPlus },
  { id: 'group', label: 'Group', icon: Users },
  { id: 'channel_public', label: 'Channel', icon: Hash },
  { id: 'channel_private', label: 'Private', icon: Lock },
];

function errorMessage(e: unknown) {
  if (e instanceof ApiFailure)
    return e.status === 0
      ? 'You’re offline. Creating conversations needs a connection.'
      : e.error.message;
  return 'Something went wrong';
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { getAccessToken, session } = useAuth();
  const { directory, db, engine } = useEngine();
  const [kind, setKind] = React.useState<Kind>('dm');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [name, setName] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [q, setQ] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const me = session!.user.userId;
  const people = [...directory.values()].filter(
    (u) =>
      u.userId !== me &&
      u.status === 'active' &&
      (!q || u.displayName.toLowerCase().includes(q.toLowerCase())),
  );

  React.useEffect(() => {
    if (!open) {
      setPicked([]);
      setName('');
      setTopic('');
      setError(null);
      setQ('');
    }
  }, [open]);

  const toggle = (id: string) =>
    setPicked((p) =>
      kind === 'dm' ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  const valid =
    kind === 'dm'
      ? picked.length === 1
      : kind === 'group'
        ? picked.length >= 2
        : name.trim().length > 0;

  async function create() {
    setPending(true);
    setError(null);
    try {
      const body: CreateConversationRequest =
        kind === 'dm'
          ? { kind, memberIds: picked }
          : kind === 'group'
            ? { kind, memberIds: picked, ...(name.trim() ? { name: name.trim() } : {}) }
            : {
                kind,
                name: name.trim(),
                memberIds: picked,
                ...(topic.trim() ? { topic: topic.trim() } : {}),
              };
      const conv = await apiRequest<Conversation>('POST', '/v1/conversations', {
        token: await getAccessToken(),
        body,
      });
      await db.conversations.put(conv);
      void engine.syncNow();
      onCreated(conv.conversationId);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New conversation"
        description="Message a colleague, start a group, or open a channel for a team."
      >
        <div
          role="tablist"
          aria-label="Conversation type"
          className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-surface-sunken p-1"
        >
          {KINDS.map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => {
                setKind(k.id);
                setPicked((p) => (k.id === 'dm' ? p.slice(0, 1) : p));
              }}
              className={cn(
                'flex h-9 items-center justify-center gap-1.5 rounded-md text-label transition-colors',
                kind === k.id
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <k.icon className="size-3.5" /> {k.label}
            </button>
          ))}
        </div>
        {kind !== 'dm' ? (
          <div className="mt-4 grid gap-3">
            <Field
              label={kind === 'group' ? 'Group name (optional)' : 'Channel name'}
              htmlFor="conv-name"
            >
              <Input
                id="conv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === 'group' ? 'Bid review crew' : 'field-operations'}
              />
            </Field>
            {kind.startsWith('channel') ? (
              <Field label="Topic (optional)" htmlFor="conv-topic">
                <Input
                  id="conv-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What this channel is for"
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
          />
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
            {people.length === 0 ? (
              <li className="py-6 text-center text-label font-normal text-text-subtle">
                No one else here yet. Invite people from Administration.
              </li>
            ) : null}
            {people.map((u) => {
              const on = picked.includes(u.userId);
              return (
                <li key={u.userId}>
                  <button
                    onClick={() => toggle(u.userId)}
                    aria-pressed={on}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
                      on ? 'bg-accent-soft' : 'hover:bg-surface-raised',
                    )}
                  >
                    <Avatar name={u.displayName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-text">{u.displayName}</span>
                      <span className="block truncate text-meta text-text-subtle">
                        {u.title ?? u.email}
                      </span>
                    </span>
                    {on ? <Check className="size-4 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-label font-normal text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!valid || pending}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SyncCenterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { db, engine, state } = useEngine();
  const outbox = useLiveQuery(() => db.outbox.orderBy('createdAt').toArray(), [db]);
  const conversations = useLiveQuery(() => db.conversations.toArray(), [db]);
  const names = new Map(
    (conversations ?? []).map((c) => [c.conversationId, c.name ?? 'Direct message']),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Sync Center"
        description="Everything saved on this device that hasn’t reached the server yet."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
          <ConnectivityIndicator state={state.connectivity} queued={state.queued} />
          <span className="text-meta text-text-subtle">
            Last sync{' '}
            {state.lastSyncAt
              ? `${relativeShort(new Date(state.lastSyncAt).toISOString())} ago`.replace(
                  'now ago',
                  'just now',
                )
              : 'not yet'}
          </span>
        </div>
        <div className="mt-4 max-h-72 overflow-y-auto">
          {outbox === undefined ? null : outbox.length === 0 ? (
            <StateView
              state="success"
              title="All caught up"
              description="Every message on this device has reached the server."
            />
          ) : (
            <ul className="space-y-2">
              {outbox.map((o) => (
                <li
                  key={o.clientMessageId}
                  className={cn(
                    'rounded-lg border p-3',
                    o.state === 'failed' ? 'border-danger/50' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-meta text-text-subtle">
                      {names.get(o.conversationId) ?? 'Conversation'}
                    </span>
                    <Badge
                      tone={
                        o.state === 'failed'
                          ? 'danger'
                          : o.state === 'sending'
                            ? 'accent'
                            : 'warning'
                      }
                    >
                      {o.state === 'failed'
                        ? 'Failed'
                        : o.state === 'sending'
                          ? 'Sending'
                          : 'Queued'}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-label font-normal text-text">
                    {o.payload.text}
                  </p>
                  {o.state === 'failed' ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-meta text-danger">
                        {o.lastError?.message ?? 'Not sent'}
                      </span>
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void engine.retry(o.clientMessageId)}
                        >
                          <RotateCcw /> Retry
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Discard"
                          onClick={() => void engine.discard(o.clientMessageId)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </div>
                  ) : o.attempts > 0 ? (
                    <p className="mt-1 text-meta text-text-subtle">
                      Attempt {o.attempts}. Retrying automatically.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void engine.syncNow()}
            disabled={state.connectivity === 'offline'}
          >
            Sync now
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { brand, setBrand, setTheme } = useTheme();
  const [draft, setDraft] = React.useState<BrandThemeInput>(
    brand ?? { primary: '#0F766E', secondary: '#F59E0B', mode: 'dark' },
  );
  const preview = createBrandTheme(draft);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(880px,calc(100vw-2rem))]"
        title="Settings"
        description="Appearance and notifications for this device."
      >
        <ThemePicker />
        <BrowserNotificationsCard />
        <div className="mt-6 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-label text-text">Organization brand theme</p>
            <Badge tone="planned">Per-tenant sync planned</Badge>
          </div>
          <p className="mt-1 text-meta text-text-subtle">
            Pick brand colors. Text and accent contrast are corrected automatically to meet WCAG AA.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <Field label="Primary" htmlFor="brand-primary">
              <input
                id="brand-primary"
                type="color"
                value={draft.primary}
                onChange={(e) => setDraft({ ...draft, primary: e.target.value })}
                className="h-10 w-16 cursor-pointer rounded-md border border-border bg-transparent"
              />
            </Field>
            <Field label="Secondary" htmlFor="brand-secondary">
              <input
                id="brand-secondary"
                type="color"
                value={draft.secondary}
                onChange={(e) => setDraft({ ...draft, secondary: e.target.value })}
                className="h-10 w-16 cursor-pointer rounded-md border border-border bg-transparent"
              />
            </Field>
            <div className="flex gap-1 rounded-md border border-border p-1">
              {(['dark', 'light'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDraft({ ...draft, mode: m })}
                  className={cn(
                    'h-8 rounded-sm px-3 text-label capitalize',
                    draft.mode === m ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <div
              className="flex h-10 items-center gap-2 rounded-md px-3"
              style={{ background: preview.colors.bg }}
            >
              <span
                className="rounded-md px-3 py-1 text-label"
                style={{ background: preview.colors.accent, color: preview.colors.accentFg }}
              >
                Send
              </span>
              <span className="text-label" style={{ color: preview.colors.text }}>
                Preview
              </span>
            </div>
            <Button
              onClick={() => {
                setBrand(draft);
                setTheme('custom-brand');
              }}
            >
              Apply brand theme
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface Device {
  sessionId: string;
  userId: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
}

export function AdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { getAccessToken } = useAuth();
  const { directory, refreshDirectory } = useEngine();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<'members' | 'devices'>('members');
  const [devices, setDevices] = React.useState<Device[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const loadDevices = React.useCallback(async () => {
    try {
      setDevices(
        await apiRequest<Device[]>('GET', '/v1/devices?all=true', {
          token: await getAccessToken(),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [getAccessToken]);

  React.useEffect(() => {
    if (open && tab === 'devices') void loadDevices();
    if (open && tab === 'members') void refreshDirectory();
  }, [open, tab, loadDevices, refreshDirectory]);

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiRequest<UserSummary>('POST', '/v1/users', {
        token: await getAccessToken(),
        body: {
          email: f.get('email'),
          displayName: f.get('displayName'),
          role: f.get('role'),
          temporaryPassword: f.get('password'),
        },
      });
      formRef.current?.reset();
      await refreshDirectory();
      toast({
        title: 'Member added',
        description: 'Share the temporary password with them securely.',
        tone: 'success',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const users = [...directory.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(760px,calc(100vw-2rem))]"
        title="Administration"
        description="Members, roles and signed-in devices for this organization."
      >
        <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface-sunken p-1">
          {(['members', 'devices'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-8 flex-1 rounded-md text-label capitalize',
                tab === t ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'members' ? (
          <div className="grid gap-5 md:grid-cols-[1fr_260px]">
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {users.map((u) => (
                <li key={u.userId} className="flex items-center gap-3 rounded-md px-2 py-2">
                  <Avatar name={u.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-text">{u.displayName}</span>
                    <span className="block truncate text-meta text-text-subtle">{u.email}</span>
                  </span>
                  <Badge
                    tone={u.role === 'owner' || u.role === 'admin' ? 'accent' : 'neutral'}
                    className="capitalize"
                  >
                    {u.role.replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
            <form
              ref={formRef}
              onSubmit={(e) => void invite(e)}
              className="grid content-start gap-3 rounded-lg border border-border p-4"
            >
              <p className="text-label text-text">Add a member</p>
              <Input name="displayName" placeholder="Full name" required aria-label="Full name" />
              <Input
                name="email"
                type="email"
                placeholder="Work email"
                required
                aria-label="Work email"
              />
              <select
                name="role"
                defaultValue="member"
                aria-label="Role"
                className="h-10 rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="guest">Guest</option>
              </select>
              <Input
                name="password"
                type="password"
                minLength={12}
                placeholder="Temporary password (12+)"
                required
                aria-label="Temporary password"
              />
              <Button type="submit" disabled={pending}>
                {pending ? 'Adding…' : 'Add member'}
              </Button>
              <p className="text-meta text-text-subtle">Email invitations are planned.</p>
            </form>
          </div>
        ) : devices === null ? (
          <StateView state="loading" title="Loading devices" />
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {devices.map((d) => (
              <li
                key={d.sessionId}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-text">
                    {d.name}{' '}
                    {d.current ? (
                      <Badge tone="success" className="ml-1">
                        This device
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block truncate text-meta text-text-subtle">
                    {directory.get(d.userId)?.displayName ?? 'Member'} · {d.platform} · seen{' '}
                    {relativeShort(d.lastSeenAt)}
                  </span>
                </span>
                {d.revokedAt ? (
                  <Badge>Revoked</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={d.current}
                    onClick={async () => {
                      try {
                        await apiRequest('DELETE', `/v1/devices/${d.sessionId}`, {
                          token: await getAccessToken(),
                        });
                        await loadDevices();
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-label font-normal text-danger">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
