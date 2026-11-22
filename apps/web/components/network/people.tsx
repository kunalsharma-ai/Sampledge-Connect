'use client';
import * as React from 'react';
import {
  Ban,
  Check,
  Copy,
  Flag,
  Link2,
  Mail,
  MessageSquare,
  MessageSquareText,
  Search,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  Circle,
  Connection,
  ConnectionRequest,
  NetworkInvite,
  NetworkPerson,
  PersonWithRelationship,
  Relationship,
} from '@sampledge/contracts';
import {
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
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { newActionId, useNet, useNetwork } from '@/lib/network';
import {
  CIRCLE_LABEL,
  PersonLine,
  QueuedBadge,
  ScreenHeader,
  Section,
  Tabs,
  errorText,
} from './ui';
import { ProfileCard } from './profile';

type Tab = 'find' | 'requests' | 'connections' | 'follows' | 'invite' | 'profile' | 'blocked';

/** People: find by Connect ID, requests, connections (Business / Friends), follows, invites, blocks. */
export function PeopleScreen({
  onMessage,
  initialTab = 'find',
}: {
  onMessage: (userId: string) => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const requests = useNet<{ incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] }>(
    '/v1/network/requests',
    ['requests'],
  );
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <ScreenHeader
        title="People"
        subtitle="Connect with anyone on SampConnect, in any organization"
      >
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'find', label: 'Find people' },
            { id: 'requests', label: 'Requests', count: requests.data?.incoming.length },
            { id: 'connections', label: 'Connections' },
            { id: 'follows', label: 'Followers' },
            { id: 'invite', label: 'Invite' },
            { id: 'profile', label: 'My profile' },
            { id: 'blocked', label: 'Blocked' },
          ]}
        />
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {tab === 'find' ? <FindPeople onMessage={onMessage} /> : null}
          {tab === 'requests' ? <Requests data={requests.data} /> : null}
          {tab === 'connections' ? <Connections onMessage={onMessage} /> : null}
          {tab === 'follows' ? <Follows onMessage={onMessage} /> : null}
          {tab === 'invite' ? <Invite /> : null}
          {tab === 'profile' ? <ProfileCard /> : null}
          {tab === 'blocked' ? <Blocked /> : null}
        </div>
      </div>
    </main>
  );
}

function FindPeople({ onMessage }: { onMessage: (userId: string) => void }) {
  const { getAccessToken } = useAuth();
  const net = useNetwork();
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<PersonWithRelationship[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(
    async (query: string) => {
      if (query.trim().length < 2) return setResults(null);
      setBusy(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const r = await apiRequest<PersonWithRelationship[]>(
          'GET',
          `/v1/network/search?q=${encodeURIComponent(query.trim())}`,
          { token },
        );
        setResults(r);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [getAccessToken],
  );
  React.useEffect(() => {
    const t = setTimeout(() => void run(q), 300);
    return () => clearTimeout(t);
  }, [q, run]);
  // Results change when a request is accepted elsewhere.
  React.useEffect(
    () => net.subscribe(['requests', 'connections', 'follows', 'blocks'], () => void run(q)),
    [net, q, run],
  );

  return (
    <>
      <div className="rounded-xl border border-border bg-surface-glass p-5 shadow-md backdrop-blur-xl">
        <label htmlFor="people-q" className="text-label text-text">
          Search by Connect ID, name, email or phone
        </label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            id="people-q"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="@maria.lopez, Maria Lopez, maria@globex.com or +44…"
            className="pl-9"
          />
        </div>
        <p className="mt-2 text-meta text-text-subtle">
          People choose whether they can be found by name, email or phone. An exact Connect ID
          always works.
          {net.online ? '' : ' You’re offline: search needs a connection.'}
        </p>
      </div>
      {error ? <StateView state="error" title="Search failed" description={error} /> : null}
      {results && !results.length && !busy ? (
        <StateView
          state="empty"
          title="No one found"
          description="Check the Connect ID, or invite them to SampConnect from the Invite tab."
        />
      ) : null}
      {results?.length ? (
        <Section title={`${results.length} ${results.length === 1 ? 'person' : 'people'}`}>
          {results.map((r) => (
            <PersonRow
              key={r.person.userId}
              person={r.person}
              relationship={r.relationship}
              onMessage={onMessage}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

/** One person with the actions that fit your relationship. */
export function PersonRow({
  person,
  relationship,
  onMessage,
}: {
  person: NetworkPerson;
  relationship: Relationship;
  onMessage: (userId: string) => void;
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const r = relationship;
  const act = async (label: string, run: () => Promise<unknown>) => {
    try {
      const res = await run();
      if (res === null)
        toast({
          title: `${label} queued`,
          description: 'It will be sent when you’re back online.',
        });
    } catch (e) {
      toast({
        title: `Couldn’t ${label.toLowerCase()}`,
        description: errorText(e),
        tone: 'danger',
      });
    }
  };
  const follow = (on: boolean) =>
    act(on ? 'Follow' : 'Unfollow', () =>
      net.act({
        method: on ? 'PUT' : 'DELETE',
        path: `/v1/network/follows/user/${person.userId}`,
        label: `${on ? 'Follow' : 'Unfollow'} ${person.displayName}`,
        scopes: ['follows'],
      }),
    );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised">
      <div className="min-w-0 flex-1">
        <PersonLine
          person={person}
          extra={
            <div className="mt-1 flex flex-wrap gap-1">
              {r.connection === 'connected' && r.circle ? (
                <Badge tone="accent">{CIRCLE_LABEL[r.circle]}</Badge>
              ) : null}
              {r.followsYou ? <Badge>Follows you</Badge> : null}
              <QueuedBadge match={(p) => p.includes(person.userId)} />
            </div>
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {r.connection === 'connected' ? (
          <Button size="sm" onClick={() => onMessage(person.userId)}>
            <MessageSquare /> Message
          </Button>
        ) : r.connection === 'outgoing' ? (
          <Badge tone="neutral">Request sent</Badge>
        ) : r.connection === 'incoming' && r.requestId ? (
          <>
            <Button
              size="sm"
              onClick={() =>
                act('Accept', () =>
                  net.act({
                    method: 'POST',
                    path: `/v1/network/requests/${r.requestId}/respond`,
                    body: { clientActionId: newActionId(), accept: true, circle: 'business' },
                    label: `Accept ${person.displayName}`,
                    scopes: ['requests', 'connections'],
                  }),
                )
              }
            >
              <Check /> Accept
            </Button>
          </>
        ) : r.canRequest ? (
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <UserPlus /> Connect
          </Button>
        ) : null}
        {r.canFollow || r.following ? (
          <Button size="sm" variant="secondary" onClick={() => void follow(!r.following)}>
            {r.following ? 'Following' : 'Follow'}
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Report"
          onClick={() => setReportOpen(true)}
        >
          <Flag />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={r.blocked ? 'Unblock' : 'Block'}
          onClick={() =>
            void act(r.blocked ? 'Unblock' : 'Block', () =>
              net.act({
                method: r.blocked ? 'DELETE' : 'PUT',
                path: `/v1/network/blocks/${person.userId}`,
                label: `${r.blocked ? 'Unblock' : 'Block'} ${person.displayName}`,
                scopes: ['blocks', 'connections'],
              }),
            )
          }
        >
          <Ban />
        </Button>
      </div>
      <ConnectDialog person={person} open={connectOpen} onOpenChange={setConnectOpen} />
      <ReportDialog
        targetType="user"
        targetId={person.userId}
        name={person.displayName}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
    </div>
  );
}

export function CirclePicker({
  value,
  onChange,
}: {
  value: Circle;
  onChange: (c: Circle) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['business', 'friends'] as const).map((c) => (
        <button
          key={c}
          id={`circle-${c}`}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            'rounded-md border px-3 py-2.5 text-left transition-colors',
            value === c
              ? 'border-accent bg-accent-soft'
              : 'border-border hover:border-border-strong',
          )}
        >
          <p className="text-label text-text">{CIRCLE_LABEL[c]}</p>
          <p className="text-meta text-text-subtle">
            {c === 'business' ? 'Clients, partners, suppliers' : 'Friends and personal circle'}
          </p>
        </button>
      ))}
    </div>
  );
}

function ConnectDialog({
  person,
  open,
  onOpenChange,
}: {
  person: NetworkPerson;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const [circle, setCircle] = React.useState<Circle>('business');
  const [message, setMessage] = React.useState('');
  const send = async () => {
    try {
      const r = await net.act({
        method: 'POST',
        path: '/v1/network/requests',
        body: { clientActionId: newActionId(), toUserId: person.userId, circle, message },
        label: `Connection request to ${person.displayName}`,
        scopes: ['requests', 'connections'],
      });
      toast({
        title: r ? 'Request sent' : 'Request queued',
        description: r
          ? `${person.displayName} will see it on every device.`
          : 'It will be sent when you’re back online.',
        tone: 'success',
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Couldn’t send the request', description: errorText(e), tone: 'danger' });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Connect with ${person.displayName}`}
        description="Free to send. Once they accept, you can message and call each other."
      >
        <div className="flex flex-col gap-4">
          <PersonLine person={person} />
          <Field label="Add to" htmlFor="circle-business">
            <CirclePicker value={circle} onChange={setCircle} />
          </Field>
          <Field label="Note (optional)" htmlFor="connect-note">
            <Textarea
              id="connect-note"
              rows={3}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi Maria, we met at Quirk’s London…"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()}>
              <UserPlus /> Send request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReportDialog({
  targetType,
  targetId,
  name,
  open,
  onOpenChange,
}: {
  targetType: 'user' | 'status' | 'community' | 'message';
  targetId: string;
  name: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const [reason, setReason] = React.useState<
    'spam' | 'harassment' | 'impersonation' | 'inappropriate' | 'other'
  >('spam');
  const [details, setDetails] = React.useState('');
  const send = async () => {
    try {
      await net.act({
        method: 'POST',
        path: '/v1/network/reports',
        body: { clientActionId: newActionId(), targetType, targetId, reason, details },
        label: `Report ${name}`,
        scopes: [],
      });
      toast({ title: 'Thanks, we’ve got your report', tone: 'success' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Couldn’t send the report', description: errorText(e), tone: 'danger' });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Report ${name}`}
        description="Reports go to the SampConnect team, and to the community’s moderators for messages in a community. No one is told who reported."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(['spam', 'harassment', 'impersonation', 'inappropriate', 'other'] as const).map(
              (r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-meta capitalize',
                    reason === r
                      ? 'border-accent bg-accent-soft text-text'
                      : 'border-border text-text-muted',
                  )}
                >
                  {r}
                </button>
              ),
            )}
          </div>
          <Textarea
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything else we should know (optional)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void send()}>
              Send report
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Requests({
  data,
}: {
  data?: { incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] };
}) {
  const net = useNetwork();
  const { toast } = useToast();
  const respond = async (r: ConnectionRequest, accept: boolean, circle: Circle = 'business') => {
    try {
      const res = await net.act({
        method: 'POST',
        path: `/v1/network/requests/${r.requestId}/respond`,
        body: { clientActionId: newActionId(), accept, circle },
        label: `${accept ? 'Accept' : 'Decline'} ${r.person.displayName}`,
        scopes: ['requests', 'connections'],
      });
      toast({
        title:
          res === null
            ? 'Queued'
            : accept
              ? `You’re connected with ${r.person.displayName}`
              : 'Request declined',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Couldn’t respond', description: errorText(e), tone: 'danger' });
    }
  };
  if (!data) return <StateView state="loading" title="Loading requests" />;
  return (
    <>
      <Section title={`Received · ${data.incoming.length}`}>
        {data.incoming.length ? (
          data.incoming.map((r) => (
            <div
              key={r.requestId}
              className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
            >
              <div className="min-w-0 flex-1">
                <PersonLine
                  person={r.person}
                  extra={
                    <>
                      {r.message ? (
                        <p className="mt-1 flex gap-1.5 text-meta text-text-muted">
                          <MessageSquareText className="mt-0.5 size-3.5 shrink-0" />“{r.message}”
                        </p>
                      ) : null}
                      <div className="mt-1 flex gap-1">
                        <Badge>{CIRCLE_LABEL[r.circle]}</Badge>
                        <QueuedBadge match={(p) => p.includes(r.requestId)} />
                      </div>
                    </>
                  }
                />
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => void respond(r, true, 'business')}>
                  <Check /> Accept as Business
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void respond(r, true, 'friends')}
                >
                  Friends
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Decline"
                  onClick={() => void respond(r, false)}
                >
                  <X />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            No new requests.
          </p>
        )}
      </Section>
      <Section title={`Sent · ${data.outgoing.length}`}>
        {data.outgoing.length ? (
          data.outgoing.map((r) => (
            <div key={r.requestId} className="flex items-center gap-3 rounded-md px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <PersonLine person={r.person} />
              </div>
              <Badge>Waiting</Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void net.act({
                    method: 'DELETE',
                    path: `/v1/network/requests/${r.requestId}`,
                    label: `Cancel request to ${r.person.displayName}`,
                    scopes: ['requests'],
                  })
                }
              >
                Cancel
              </Button>
            </div>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            Nothing waiting.
          </p>
        )}
      </Section>
    </>
  );
}

function Connections({ onMessage }: { onMessage: (id: string) => void }) {
  const { data } = useNet<Connection[]>('/v1/network/connections', ['connections']);
  const net = useNetwork();
  const [circle, setCircle] = React.useState<'all' | Circle>('all');
  if (!data) return <StateView state="loading" title="Loading connections" />;
  const list = data.filter((c) => circle === 'all' || c.circle === circle);
  return (
    <Section
      title={`${data.length} connection${data.length === 1 ? '' : 's'}`}
      action={
        <Tabs
          value={circle}
          onChange={setCircle}
          items={[
            { id: 'all', label: 'All' },
            { id: 'business', label: 'Business' },
            { id: 'friends', label: 'Friends' },
          ]}
        />
      }
    >
      {list.length ? (
        list.map((c) => (
          <div
            key={c.person.userId}
            className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
          >
            <div className="min-w-0 flex-1">
              <PersonLine
                person={c.person}
                extra={
                  <div className="mt-1 flex gap-1">
                    <Badge tone="accent">{CIRCLE_LABEL[c.circle]}</Badge>
                    <QueuedBadge match={(p) => p.includes(c.person.userId)} />
                  </div>
                }
              />
            </div>
            <Button size="sm" onClick={() => onMessage(c.person.userId)}>
              <MessageSquare /> Message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void net.act({
                  method: 'PUT',
                  path: `/v1/network/connections/${c.person.userId}/circle`,
                  body: {
                    clientActionId: newActionId(),
                    circle: c.circle === 'business' ? 'friends' : 'business',
                  },
                  label: `Move ${c.person.displayName}`,
                  scopes: ['connections'],
                })
              }
            >
              Move to {c.circle === 'business' ? 'Friends' : 'Business'}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove connection"
              onClick={() =>
                void net.act({
                  method: 'DELETE',
                  path: `/v1/network/connections/${c.person.userId}`,
                  label: `Remove ${c.person.displayName}`,
                  scopes: ['connections'],
                })
              }
            >
              <UserMinus />
            </Button>
          </div>
        ))
      ) : (
        <StateView
          state="empty"
          title="No connections yet"
          description="Find people by their Connect ID, or invite them."
        />
      )}
    </Section>
  );
}

function Follows({ onMessage }: { onMessage: (id: string) => void }) {
  const { data } = useNet<{
    followers: PersonWithRelationship[];
    following: PersonWithRelationship[];
  }>('/v1/network/follows', ['follows', 'connections']);
  if (!data) return <StateView state="loading" title="Loading" />;
  return (
    <>
      <Section title={`Followers · ${data.followers.length}`}>
        {data.followers.length ? (
          data.followers.map((r) => (
            <PersonRow key={r.person.userId} {...r} onMessage={onMessage} />
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            No followers yet. Make your profile public to share it.
          </p>
        )}
      </Section>
      <Section title={`Following · ${data.following.length}`}>
        {data.following.length ? (
          data.following.map((r) => (
            <PersonRow key={r.person.userId} {...r} onMessage={onMessage} />
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            You’re not following anyone.
          </p>
        )}
      </Section>
    </>
  );
}

function Invite() {
  const net = useNetwork();
  const { toast } = useToast();
  const { data } = useNet<NetworkInvite[]>('/v1/network/invites', ['invites']);
  const [channel, setChannel] = React.useState<'email' | 'link' | 'sms'>('email');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [circle, setCircle] = React.useState<Circle>('business');
  const [made, setMade] = React.useState<NetworkInvite | null>(null);
  const create = async () => {
    try {
      const r = await net.act<NetworkInvite>({
        method: 'POST',
        path: '/v1/network/invites',
        body: {
          clientActionId: newActionId(),
          channel,
          circle,
          ...(name ? { name } : {}),
          ...(channel === 'email' ? { email } : {}),
          ...(channel === 'sms' ? { phone } : {}),
        },
        label: `Invite ${name || email || phone || 'by link'}`,
        scopes: ['invites'],
      });
      if (!r)
        return toast({
          title: 'Invite queued',
          description: 'It will be created when you’re back online.',
        });
      setMade(r);
      const texted = r.channel === 'sms';
      // Not sent by the server: open the phone's messages app with the text filled in.
      if (r.smsUrl && r.delivery !== 'sent') window.open(r.smsUrl, '_self');
      toast({
        title:
          r.delivery === 'sent'
            ? texted
              ? `Invite texted to ${r.phone}`
              : `Invite emailed to ${r.email}`
            : r.delivery === 'failed'
              ? texted
                ? 'Text didn’t send: share the link instead'
                : 'Email failed: copy the link instead'
              : 'Invite link ready',
        description:
          r.delivery === 'not_configured'
            ? texted
              ? 'Text messages aren’t set up yet (Administration → Integrations → Text messages), so it opens your messages app instead.'
              : 'Email isn’t set up on this server yet (Integrations → SMTP). Copy the link and share it.'
            : undefined,
        tone: r.delivery === 'failed' ? 'danger' : 'success',
      });
    } catch (e) {
      toast({ title: 'Couldn’t create the invite', description: errorText(e), tone: 'danger' });
    }
  };
  const copy = async (url: string) => {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast({ title: 'Link copied', tone: 'success' });
  };
  return (
    <>
      <div className="rounded-xl border border-border bg-surface-glass p-5 shadow-md backdrop-blur-xl">
        <h2 className="text-h3 text-text">Invite someone who isn’t here yet</h2>
        <p className="mt-1 text-label font-normal text-text-muted">
          They create a free personal account in a minute, and you’re connected automatically.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Tabs
            value={channel}
            onChange={setChannel}
            items={[
              { id: 'email', label: 'Email' },
              { id: 'sms', label: 'Text message' },
              { id: 'link', label: 'Link' },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their name (optional)" htmlFor="inv-name">
              <Input
                id="inv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meera Shah"
              />
            </Field>
            {channel === 'email' ? (
              <Field label="Email" htmlFor="inv-email">
                <Input
                  id="inv-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="meera@example.com"
                />
              </Field>
            ) : channel === 'sms' ? (
              <Field
                label="Mobile number"
                htmlFor="inv-phone"
                hint="Sent by text when your organization has set up text messages, otherwise from your own phone."
              >
                <Input
                  id="inv-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+44 7700 900123"
                />
              </Field>
            ) : null}
          </div>
          <Field label="Add them to" htmlFor="circle-business">
            <CirclePicker value={circle} onChange={setCircle} />
          </Field>
          <div className="flex justify-end">
            <Button
              onClick={() => void create()}
              disabled={(channel === 'email' && !email) || (channel === 'sms' && !phone)}
            >
              {channel === 'email' ? <Mail /> : <Link2 />}{' '}
              {channel === 'email'
                ? 'Send invite'
                : channel === 'sms'
                  ? 'Create and text'
                  : 'Create link'}
            </Button>
          </div>
          {made ? (
            <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-2">
              <Link2 className="size-4 text-accent" />
              <span className="min-w-0 flex-1 truncate text-meta text-text">{made.url}</span>
              <Button size="sm" variant="secondary" onClick={() => void copy(made.url)}>
                <Copy /> Copy
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <Section title="Your invites">
        {data?.length ? (
          data.map((i) => (
            <div key={i.inviteId} className="flex items-center gap-3 rounded-md px-2 py-2">
              <span className="min-w-0 flex-1 truncate text-label text-text">
                {i.name || i.email || i.phone || 'Invite link'}
              </span>
              <Badge>
                {i.channel === 'sms' ? 'Text' : i.channel === 'email' ? 'Email' : 'Link'}
                {i.delivery === 'sent'
                  ? ' · sent'
                  : i.delivery === 'failed'
                    ? ' · not delivered'
                    : i.delivery === 'not_configured' && i.channel === 'sms'
                      ? ' · from your phone'
                      : ''}
              </Badge>
              <Badge
                tone={
                  i.status === 'accepted'
                    ? 'success'
                    : i.status === 'expired'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {i.status === 'accepted'
                  ? 'Joined'
                  : i.status === 'expired'
                    ? 'Expired'
                    : 'Waiting'}
              </Badge>
            </div>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
            No invites yet.
          </p>
        )}
      </Section>
    </>
  );
}

function Blocked() {
  const { data } = useNet<NetworkPerson[]>('/v1/network/blocks', ['blocks']);
  const net = useNetwork();
  return (
    <Section title="Blocked people">
      {data?.length ? (
        data.map((p) => (
          <div key={p.userId} className="flex items-center gap-3 rounded-md px-2 py-2.5">
            <div className="min-w-0 flex-1">
              <PersonLine person={p} />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void net.act({
                  method: 'DELETE',
                  path: `/v1/network/blocks/${p.userId}`,
                  label: `Unblock ${p.displayName}`,
                  scopes: ['blocks'],
                })
              }
            >
              Unblock
            </Button>
          </div>
        ))
      ) : (
        <p className="px-2 py-6 text-center text-label font-normal text-text-subtle">
          You haven’t blocked anyone. Blocked people can’t find you, message you, follow you or see
          your statuses.
        </p>
      )}
    </Section>
  );
}
