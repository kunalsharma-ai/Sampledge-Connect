'use client';
import * as React from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Hash,
  Link2,
  Lock,
  Megaphone,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  Community,
  CommunityInviteLink,
  CommunityMember,
  Connection,
} from '@sampledge/contracts';
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
  useToast,
} from '@sampledge/ui';
import { newActionId, useNet, useNetwork } from '@/lib/network';
import { Switch } from './profile';
import { PersonLine, QueuedBadge, ScreenHeader, Section, Tabs, errorText } from './ui';

const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
} as const;

/** Communities: yours, discover public ones, and a full page for each. */
export function CommunitiesScreen({
  onOpenConversation,
}: {
  onOpenConversation: (id: string) => void;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'mine' | 'discover'>('mine');
  const [creating, setCreating] = React.useState(false);
  if (openId)
    return (
      <CommunityPage
        id={openId}
        onBack={() => setOpenId(null)}
        onOpenConversation={onOpenConversation}
      />
    );
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <ScreenHeader
        title="Communities"
        subtitle="Groups of people across organizations, with announcements and topic groups"
      >
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'mine', label: 'My communities' },
            { id: 'discover', label: 'Discover' },
          ]}
        />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New community
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl">
          {tab === 'mine' ? (
            <Mine onOpen={setOpenId} onCreate={() => setCreating(true)} />
          ) : (
            <Discover onOpen={setOpenId} />
          )}
        </div>
      </div>
      <CreateCommunity open={creating} onOpenChange={setCreating} onCreated={setOpenId} />
    </main>
  );
}

function CommunityCard({ c, onOpen }: { c: Community; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-11 place-items-center rounded-lg font-display text-h3 text-white"
          style={{
            background: `linear-gradient(135deg, ${c.avatarColor}, color-mix(in srgb, ${c.avatarColor} 50%, #000))`,
          }}
        >
          {c.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label text-text">{c.name}</p>
          <p className="flex items-center gap-1 text-meta text-text-subtle">
            {c.visibility === 'public' ? <Globe className="size-3" /> : <Lock className="size-3" />}
            {c.visibility === 'public' ? 'Public' : 'Private'} · {c.memberCount} member
            {c.memberCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {c.description ? (
        <p className="line-clamp-2 text-meta text-text-muted">{c.description}</p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {c.myRole ? <Badge tone="accent">{ROLE_LABEL[c.myRole]}</Badge> : null}
        {c.myStatus === 'pending' ? <Badge tone="warning">Waiting for approval</Badge> : null}
        {c.myStatus === 'invited' ? <Badge tone="accent2">Invited</Badge> : null}
        {c.following ? <Badge>Following</Badge> : null}
        {c.joinPolicy === 'approval' ? <Badge>Approval to join</Badge> : null}
      </div>
    </button>
  );
}

function Mine({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const { data } = useNet<Community[]>('/v1/network/communities', ['communities']);
  if (!data) return <StateView state="loading" title="Loading communities" />;
  if (!data.length)
    return (
      <StateView
        state="empty"
        title="No communities yet"
        description="Create one for your clients, panel partners or industry peers, or discover public ones."
        action={
          <Button onClick={onCreate}>
            <Plus /> New community
          </Button>
        }
      />
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((c) => (
        <CommunityCard key={c.communityId} c={c} onOpen={() => onOpen(c.communityId)} />
      ))}
    </div>
  );
}

function Discover({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useNet<Community[]>(
    `/v1/network/communities/discover${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
    ['communities'],
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search public communities"
          className="pl-9"
        />
      </div>
      {data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <CommunityCard key={c.communityId} c={c} onOpen={() => onOpen(c.communityId)} />
          ))}
        </div>
      ) : data ? (
        <StateView state="empty" title="Nothing found" />
      ) : (
        <StateView state="loading" title="Loading" />
      )}
    </div>
  );
}

function CreateCommunity({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [visibility, setVisibility] = React.useState<'public' | 'private'>('public');
  const [approval, setApproval] = React.useState(false);
  const create = async () => {
    try {
      const c = await net.act<Community>({
        method: 'POST',
        path: '/v1/network/communities',
        body: {
          clientActionId: newActionId(),
          name,
          description,
          visibility,
          joinPolicy: approval ? 'approval' : 'open',
        },
        label: `Create ${name}`,
        scopes: ['communities'],
      });
      onOpenChange(false);
      setName('');
      setDescription('');
      if (c) onCreated(c.communityId);
      else
        toast({
          title: 'Community queued',
          description: 'It will be created when you’re back online.',
        });
    } catch (e) {
      toast({ title: 'Couldn’t create the community', description: errorText(e), tone: 'danger' });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New community"
        description="Comes with an Announcements channel and a General group. Add more groups any time."
      >
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="cm-name">
            <Input
              id="cm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Market Research Leaders"
            />
          </Field>
          <Field label="What it’s about" htmlFor="cm-desc">
            <Textarea
              id="cm-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(['public', 'private'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={cn(
                  'rounded-md border p-3 text-left',
                  visibility === v ? 'border-accent bg-accent-soft' : 'border-border',
                )}
              >
                <p className="flex items-center gap-1.5 text-label text-text">
                  {v === 'public' ? <Globe className="size-4" /> : <Lock className="size-4" />}
                  {v === 'public' ? 'Public' : 'Private'}
                </p>
                <p className="text-meta text-text-subtle">
                  {v === 'public'
                    ? 'Anyone can find it; it has a shareable page'
                    : 'Hidden; join by invite link or invitation'}
                </p>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label text-text">Admins approve new members</span>
            <Switch checked={approval} onChange={setApproval} label="Approval to join" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={name.trim().length < 2} onClick={() => void create()}>
              Create community
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommunityPage({
  id,
  onBack,
  onOpenConversation,
}: {
  id: string;
  onBack: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const { data: c, loading } = useNet<Community>(`/v1/network/communities/${id}`, ['communities']);
  const net = useNetwork();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<'groups' | 'members' | 'invite' | 'settings'>('groups');
  const [newGroup, setNewGroup] = React.useState(false);
  if (!c)
    return (
      <main className="flex flex-1 items-center justify-center">
        <StateView
          state={loading ? 'loading' : 'error'}
          title={loading ? 'Loading' : 'Community not found'}
        />
      </main>
    );
  const isMod = c.myRole === 'owner' || c.myRole === 'admin' || c.myRole === 'moderator';
  const isAdmin = c.myRole === 'owner' || c.myRole === 'admin';
  const run = async (
    label: string,
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
  ) => {
    try {
      const r = await net.act({ method, path, body, label, scopes: ['communities'] });
      if (r === null)
        toast({ title: `${label} queued`, description: 'It will happen when you’re back online.' });
    } catch (e) {
      toast({
        title: `Couldn’t ${label.toLowerCase()}`,
        description: errorText(e),
        tone: 'danger',
      });
    }
  };
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <div className="relative shrink-0 overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(120% 140% at 0% 0%, ${c.avatarColor}, transparent 60%)`,
          }}
        />
        <div className="relative flex flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={onBack}>
            <ArrowLeft />
          </Button>
          <span
            className="grid size-14 place-items-center rounded-xl font-display text-h2 text-white shadow-md"
            style={{
              background: `linear-gradient(135deg, ${c.avatarColor}, color-mix(in srgb, ${c.avatarColor} 45%, #000))`,
            }}
          >
            {c.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-h2 text-text">{c.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-meta text-text-subtle">
              {c.visibility === 'public' ? (
                <Globe className="size-3" />
              ) : (
                <Lock className="size-3" />
              )}
              {c.visibility === 'public' ? 'Public' : 'Private'} · {c.memberCount} members ·{' '}
              {c.followerCount} followers
              <QueuedBadge match={(p) => p.includes(c.communityId)} />
            </p>
            {c.description ? (
              <p className="mt-1 max-w-2xl text-label font-normal text-text-muted">
                {c.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.myStatus === 'member' ? (
              c.myRole !== 'owner' ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void run('Leave', 'POST', `/v1/network/communities/${c.communityId}/leave`)
                  }
                >
                  Leave
                </Button>
              ) : null
            ) : c.myStatus === 'pending' ? (
              <Badge tone="warning">Waiting for approval</Badge>
            ) : (
              <Button
                onClick={() =>
                  void run('Join', 'POST', `/v1/network/communities/${c.communityId}/join`)
                }
              >
                <UserPlus />{' '}
                {c.myStatus === 'invited'
                  ? 'Accept invitation'
                  : c.joinPolicy === 'approval'
                    ? 'Ask to join'
                    : 'Join'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                void run(
                  c.following ? 'Unfollow' : 'Follow',
                  c.following ? 'DELETE' : 'PUT',
                  `/v1/network/follows/community/${c.communityId}`,
                )
              }
            >
              {c.following ? 'Following' : 'Follow'}
            </Button>
            {c.publicUrl ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy public link"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(c.publicUrl!)
                    .then(() => toast({ title: 'Public link copied', tone: 'success' }))
                }
              >
                <Link2 />
              </Button>
            ) : null}
          </div>
        </div>
        {c.myStatus === 'member' ? (
          <div className="relative px-4 pb-3 sm:px-6">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'groups', label: 'Groups' },
                { id: 'members', label: 'Members' },
                ...(isMod || c.joinPolicy === 'open'
                  ? [{ id: 'invite' as const, label: 'Invite' }]
                  : []),
                ...(isAdmin ? [{ id: 'settings' as const, label: 'Settings' }] : []),
              ]}
            />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {c.myStatus !== 'member' ? (
            <StateView
              state="permission-denied"
              title={
                c.myStatus === 'pending'
                  ? 'Your request is with the admins'
                  : 'Join to see the groups'
              }
              description={c.rules || 'Members see the announcements channel and every open group.'}
            />
          ) : tab === 'groups' ? (
            <Section
              title="Groups"
              action={
                isMod ? (
                  <Button size="sm" variant="secondary" onClick={() => setNewGroup(true)}>
                    <Plus /> New group
                  </Button>
                ) : null
              }
            >
              {c.groups.map((g) => (
                <div
                  key={g.conversationId}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
                >
                  <span
                    className={cn(
                      'grid size-9 place-items-center rounded-md',
                      g.kind === 'announcements'
                        ? 'bg-accent2-soft text-accent2'
                        : 'bg-accent-soft text-accent',
                    )}
                  >
                    {g.kind === 'announcements' ? (
                      <Megaphone className="size-4" />
                    ) : g.access === 'private' ? (
                      <Lock className="size-4" />
                    ) : (
                      <Hash className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-text">{g.name}</p>
                    <p className="truncate text-meta text-text-subtle">
                      {g.kind === 'announcements'
                        ? 'Only admins and moderators post'
                        : g.topic ||
                          (g.access === 'private' ? 'Private group' : 'Open to all members')}{' '}
                      · {g.memberCount} members
                    </p>
                  </div>
                  {g.joined ? (
                    <Button size="sm" onClick={() => onOpenConversation(g.conversationId)}>
                      Open
                    </Button>
                  ) : g.access === 'open' || isAdmin ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void run(
                          'Join group',
                          'POST',
                          `/v1/network/communities/${c.communityId}/groups/${g.conversationId}/join`,
                        )
                      }
                    >
                      Join
                    </Button>
                  ) : (
                    <Badge>Private</Badge>
                  )}
                </div>
              ))}
            </Section>
          ) : tab === 'members' ? (
            <Members c={c} run={run} />
          ) : tab === 'invite' ? (
            <InviteToCommunity c={c} isMod={isMod} />
          ) : (
            <CommunitySettings c={c} run={run} />
          )}
        </div>
      </div>
      <NewGroup c={c} open={newGroup} onOpenChange={setNewGroup} />
    </main>
  );
}

type Run = (
  label: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
) => Promise<void>;

function Members({ c, run }: { c: Community; run: Run }) {
  const { data } = useNet<CommunityMember[]>(`/v1/network/communities/${c.communityId}/members`, [
    'communities',
  ]);
  const isMod = c.myRole === 'owner' || c.myRole === 'admin' || c.myRole === 'moderator';
  const isAdmin = c.myRole === 'owner' || c.myRole === 'admin';
  if (!data) return <StateView state="loading" title="Loading members" />;
  const pending = data.filter((m) => m.status === 'pending');
  const active = data.filter((m) => m.status === 'active');
  const banned = data.filter((m) => m.status === 'banned');
  const base = `/v1/network/communities/${c.communityId}`;
  return (
    <>
      {isMod && pending.length ? (
        <Section title={`Asking to join · ${pending.length}`}>
          {pending.map((m) => (
            <div key={m.person.userId} className="flex items-center gap-3 rounded-md px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <PersonLine person={m.person} />
              </div>
              <Button
                size="sm"
                onClick={() =>
                  void run('Approve', 'POST', `${base}/members/${m.person.userId}/approve`)
                }
              >
                <Check /> Approve
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Deny"
                onClick={() => void run('Deny', 'POST', `${base}/members/${m.person.userId}/deny`)}
              >
                <X />
              </Button>
            </div>
          ))}
        </Section>
      ) : null}
      <Section title={`Members · ${active.length}`}>
        {active.map((m) => (
          <div
            key={m.person.userId}
            className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
          >
            <div className="min-w-0 flex-1">
              <PersonLine person={m.person} />
            </div>
            <Badge tone={m.role === 'member' ? 'neutral' : 'accent'} className="gap-1">
              {m.role !== 'member' ? <ShieldCheck className="size-3" /> : null}
              {ROLE_LABEL[m.role]}
            </Badge>
            {isAdmin && m.role !== 'owner' ? (
              <select
                aria-label={`Role for ${m.person.displayName}`}
                value={m.role}
                onChange={(e) =>
                  void run('Change role', 'PUT', `${base}/members/${m.person.userId}/role`, {
                    clientActionId: newActionId(),
                    role: e.target.value,
                  })
                }
                className="h-8 rounded-sm border border-border bg-surface px-2 text-meta text-text"
              >
                {c.myRole === 'owner' ? <option value="admin">Admin</option> : null}
                <option value="moderator">Moderator</option>
                <option value="member">Member</option>
              </select>
            ) : null}
            {isMod && m.role !== 'owner' && (m.role === 'member' || c.myRole === 'owner') ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void run('Remove', 'DELETE', `${base}/members/${m.person.userId}`)}
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() =>
                    void run('Ban', 'DELETE', `${base}/members/${m.person.userId}?ban=true`)
                  }
                >
                  Ban
                </Button>
              </>
            ) : null}
          </div>
        ))}
      </Section>
      {isMod && banned.length ? (
        <Section title={`Banned · ${banned.length}`}>
          {banned.map((m) => (
            <div key={m.person.userId} className="flex items-center gap-3 rounded-md px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <PersonLine person={m.person} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void run('Unban', 'DELETE', `${base}/bans/${m.person.userId}`)}
              >
                Unban
              </Button>
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function InviteToCommunity({ c, isMod }: { c: Community; isMod: boolean }) {
  const net = useNetwork();
  const { toast } = useToast();
  const { data: conns } = useNet<Connection[]>('/v1/network/connections', ['connections']);
  const { data: members } = useNet<CommunityMember[]>(
    `/v1/network/communities/${c.communityId}/members`,
    ['communities'],
  );
  const { data: links } = useNet<CommunityInviteLink[]>(
    isMod ? `/v1/network/communities/${c.communityId}/links` : null,
    ['communities'],
  );
  const inside = new Set((members ?? []).map((m) => m.person.userId));
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const invite = async () => {
    try {
      const r = await net.act({
        method: 'POST',
        path: `/v1/network/communities/${c.communityId}/invite`,
        body: { clientActionId: newActionId(), userIds: [...picked] },
        label: `Invite to ${c.name}`,
        scopes: ['communities'],
      });
      toast({
        title:
          r === null
            ? 'Invites queued'
            : `Invited ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`,
        tone: 'success',
      });
      setPicked(new Set());
    } catch (e) {
      toast({ title: 'Couldn’t invite', description: errorText(e), tone: 'danger' });
    }
  };
  const makeLink = async () => {
    try {
      const l = await net.act<CommunityInviteLink>({
        method: 'POST',
        path: `/v1/network/communities/${c.communityId}/links`,
        body: { clientActionId: newActionId(), expiresInDays: 7 },
        label: 'Create invite link',
        scopes: ['communities'],
      });
      if (l) {
        await navigator.clipboard?.writeText(l.url).catch(() => undefined);
        toast({
          title: 'Invite link created and copied',
          description: 'It works for 7 days.',
          tone: 'success',
        });
      }
    } catch (e) {
      toast({ title: 'Couldn’t create the link', description: errorText(e), tone: 'danger' });
    }
  };
  const candidates = (conns ?? []).filter((x) => !inside.has(x.person.userId));
  return (
    <>
      <Section
        title="Invite your connections"
        action={
          <Button size="sm" disabled={!picked.size} onClick={() => void invite()}>
            <UserPlus /> Invite {picked.size || ''}
          </Button>
        }
      >
        {candidates.length ? (
          candidates.map((x) => (
            <label
              key={x.person.userId}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-raised"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--sc-color-accent)]"
                checked={picked.has(x.person.userId)}
                onChange={(e) => {
                  const n = new Set(picked);
                  if (e.target.checked) n.add(x.person.userId);
                  else n.delete(x.person.userId);
                  setPicked(n);
                }}
              />
              <PersonLine person={x.person} size="sm" />
            </label>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            All your connections are already here.
          </p>
        )}
      </Section>
      {isMod ? (
        <Section
          title="Invite links"
          action={
            <Button size="sm" variant="secondary" onClick={() => void makeLink()}>
              <Link2 /> New link
            </Button>
          }
        >
          {links?.length ? (
            links.map((l) => (
              <div key={l.linkId} className="flex items-center gap-3 rounded-md px-2 py-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-meta',
                    l.revoked ? 'text-text-subtle line-through' : 'text-text',
                  )}
                >
                  {l.url}
                </span>
                <Badge>
                  {l.uses}
                  {l.maxUses ? `/${l.maxUses}` : ''} used
                </Badge>
                {!l.revoked ? (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Copy"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(l.url)
                          .then(() => toast({ title: 'Copied', tone: 'success' }))
                      }
                    >
                      <Copy />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void net.act({
                          method: 'DELETE',
                          path: `/v1/network/communities/${c.communityId}/links/${l.linkId}`,
                          label: 'Revoke link',
                          scopes: ['communities'],
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </>
                ) : null}
              </div>
            ))
          ) : (
            <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
              Share a link anyone can use to join, even without an account.
            </p>
          )}
        </Section>
      ) : null}
    </>
  );
}

function CommunitySettings({ c, run }: { c: Community; run: Run }) {
  const [name, setName] = React.useState(c.name);
  const [description, setDescription] = React.useState(c.description);
  const [rules, setRules] = React.useState(c.rules);
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="cs-name">
          <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="cs-desc">
          <Textarea
            id="cs-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Rules" htmlFor="cs-rules" hint="Shown to people before they join.">
          <Textarea
            id="cs-rules"
            rows={3}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-label text-text">Public (listed, shareable page)</span>
          <Switch
            checked={c.visibility === 'public'}
            onChange={(v) =>
              void run('Change visibility', 'PATCH', `/v1/network/communities/${c.communityId}`, {
                clientActionId: newActionId(),
                visibility: v ? 'public' : 'private',
              })
            }
            label="Public"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-label text-text">Admins approve new members</span>
          <Switch
            checked={c.joinPolicy === 'approval'}
            onChange={(v) =>
              void run('Change join policy', 'PATCH', `/v1/network/communities/${c.communityId}`, {
                clientActionId: newActionId(),
                joinPolicy: v ? 'approval' : 'open',
              })
            }
            label="Approval"
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() =>
              void run('Save', 'PATCH', `/v1/network/communities/${c.communityId}`, {
                clientActionId: newActionId(),
                name,
                description,
                rules,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}

function NewGroup({
  c,
  open,
  onOpenChange,
}: {
  c: Community;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [priv, setPriv] = React.useState(false);
  const [ann, setAnn] = React.useState(false);
  const create = async () => {
    try {
      await net.act({
        method: 'POST',
        path: `/v1/network/communities/${c.communityId}/groups`,
        body: {
          clientActionId: newActionId(),
          name,
          topic,
          access: priv ? 'private' : 'open',
          announcementsOnly: ann,
        },
        label: `New group ${name}`,
        scopes: ['communities'],
      });
      onOpenChange(false);
      setName('');
      setTopic('');
    } catch (e) {
      toast({ title: 'Couldn’t create the group', description: errorText(e), tone: 'danger' });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New group"
        description={`A chat inside ${c.name}. Messages, files and calls all work here.`}
      >
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="g-name">
            <Input
              id="g-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Panel quality"
            />
          </Field>
          <Field label="Topic" htmlFor="g-topic">
            <Input id="g-topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-label text-text">Private (admins add people)</span>
            <Switch checked={priv} onChange={setPriv} label="Private" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label text-text">Only moderators post</span>
            <Switch checked={ann} onChange={setAnn} label="Only moderators post" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} onClick={() => void create()}>
              <Users /> Create group
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommunityAvatar({ c }: { c: Pick<Community, 'name' | 'avatarColor'> }) {
  return <Avatar name={c.name} size="md" />;
}
