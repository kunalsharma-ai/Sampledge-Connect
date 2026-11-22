'use client';
import * as React from 'react';
import { CloudOff, Copy, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import type {
  Community,
  ConnectionRequest,
  MyNetworkProfile,
  StatusFeed,
} from '@sampledge/contracts';
import { Badge, Button, useToast } from '@sampledge/ui';
import { useNet, useNetwork, useNetworkOutbox } from '@/lib/network';
import { StatusComposer, StatusRail, StatusViewer } from './status';
import { PersonLine, ScreenHeader, Section } from './ui';
import { FeatureHelp } from '../feature-help';

/** Network home: status updates, requests waiting for you, your Connect ID, communities. */
export function NetworkHome({
  onGo,
  onMessage,
}: {
  onGo: (m: 'people' | 'communities') => void;
  onMessage: (userId: string) => void;
}) {
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);
  const { data: me } = useNet<MyNetworkProfile>('/v1/network/me', ['profile']);
  const { data: req } = useNet<{ incoming: ConnectionRequest[] }>('/v1/network/requests', [
    'requests',
  ]);
  const { data: communities } = useNet<Community[]>('/v1/network/communities', ['communities']);
  const { data: feed } = useNet<StatusFeed>('/v1/network/statuses', ['statuses']);
  const { toast } = useToast();
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      <ScreenHeader
        title="SampConnect Network"
        help="network"
        subtitle="Your connections across every organization"
      >
        <Button size="sm" variant="secondary" onClick={() => onGo('people')}>
          <UserPlus /> Find people
        </Button>
        <Button size="sm" onClick={() => setComposing(true)}>
          New status
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="rounded-xl border border-border bg-surface-glass p-4 shadow-md backdrop-blur-xl">
              <div className="mb-3 flex items-center">
                <h2 className="text-label text-text">Status updates</h2>
                <FeatureHelp id="status-updates" size="sm" className="ml-2" />
                <span className="ml-auto text-meta text-text-subtle">
                  {feed ? `${feed.people.reduce((n, p) => n + p.unseen, 0)} new` : ''}
                </span>
              </div>
              <StatusRail onOpen={setViewing} onCompose={() => setComposing(true)} />
            </section>
            <Section
              title="Requests waiting for you"
              action={
                <Button size="sm" variant="ghost" onClick={() => onGo('people')}>
                  See all
                </Button>
              }
            >
              {req?.incoming.length ? (
                req.incoming.slice(0, 4).map((r) => (
                  <div key={r.requestId} className="flex items-center gap-3 rounded-md px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <PersonLine person={r.person} />
                    </div>
                    <Button size="sm" onClick={() => onGo('people')}>
                      Review
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-5 text-center text-label font-normal text-text-subtle">
                  No requests right now.
                </p>
              )}
            </Section>
            <Section
              title="Your communities"
              action={
                <Button size="sm" variant="ghost" onClick={() => onGo('communities')}>
                  Open
                </Button>
              }
            >
              {communities?.length ? (
                communities.slice(0, 5).map((c) => (
                  <button
                    key={c.communityId}
                    onClick={() => onGo('communities')}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-raised"
                  >
                    <span
                      className="grid size-9 place-items-center rounded-md text-label text-white"
                      style={{ background: c.avatarColor }}
                    >
                      {c.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label text-text">{c.name}</span>
                    <Badge>
                      <Users className="size-3" /> {c.memberCount}
                    </Badge>
                  </button>
                ))
              ) : (
                <p className="px-2 py-5 text-center text-label font-normal text-text-subtle">
                  Join or create a community for your industry, clients or friends.
                </p>
              )}
            </Section>
          </div>
          <div className="flex flex-col gap-4">
            {me ? (
              <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-md">
                <div className="h-14 bg-[linear-gradient(120deg,var(--sc-color-accent),var(--sc-color-accent2))]" />
                <div className="p-4">
                  <PersonLine person={me} size="lg" />
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2">
                    <span className="text-meta text-text-subtle">Connect ID</span>
                    <span className="min-w-0 flex-1 truncate text-label text-text">
                      @{me.handle}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Copy Connect ID"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(`@${me.handle}`)
                          .then(() => toast({ title: 'Connect ID copied', tone: 'success' }))
                      }
                    >
                      <Copy />
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 text-center">
                    {(['connections', 'followers', 'following'] as const).map((k) => (
                      <div key={k}>
                        <p className="text-h3 text-text">{me.counts[k]}</p>
                        <p className="text-meta capitalize text-text-subtle">{k}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
            <PendingActions />
          </div>
        </div>
      </div>
      <StatusComposer open={composing} onOpenChange={setComposing} />
      <StatusViewer authorId={viewing} onClose={() => setViewing(null)} onReplied={onMessage} />
    </main>
  );
}

/** What's waiting to be sent from this device (offline queue), with retry and discard. */
function PendingActions() {
  const outbox = useNetworkOutbox();
  const net = useNetwork();
  if (!outbox.length) return null;
  return (
    <Section title={`Waiting to sync · ${outbox.length}`}>
      {outbox.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-md px-2 py-2">
          <CloudOff className="size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label text-text">{a.label}</p>
            <p className="truncate text-meta text-text-subtle">
              {a.state === 'failed'
                ? `Not sent: ${a.lastError}`
                : net.online
                  ? 'Sending…'
                  : 'Sends when you’re back online'}
            </p>
          </div>
          {a.state === 'failed' ? (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Retry"
                onClick={() => void net.retry(a.id)}
              >
                <RotateCcw />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Discard"
                onClick={() => void net.discard(a.id)}
              >
                <Trash2 />
              </Button>
            </>
          ) : null}
        </div>
      ))}
    </Section>
  );
}
