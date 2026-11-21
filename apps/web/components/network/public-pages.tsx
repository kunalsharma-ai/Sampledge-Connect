'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Globe, Lock, Megaphone, User, UserPlus, Users } from 'lucide-react';
import type {
  Community,
  NetworkInvitePreview,
  PublicCommunity,
  PublicProfile,
} from '@sampledge/contracts';
import { Avatar, Badge, Button, Field, Input, StateView } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LogoMark, Wordmark } from '../brand';
import { BACKGROUNDS } from './status';
import { errorText } from './ui';

function usePublic<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    apiRequest<T>('GET', path)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiFailure && e.status === 404 ? 'not-found' : errorText(e)),
      );
  }, [path]);
  return { data, error };
}

/** Signed in already? Get a network token (linking a work account on first use). */
function useNetworkAction() {
  const auth = useAuth();
  return async (): Promise<string | null> => {
    if (auth.status !== 'signed-in') return null;
    await auth.enterNetwork();
    return auth.tokenFor(auth.personal ? 'current' : 'network');
  };
}

function PublicShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return (
    <div className="min-h-dvh bg-bg">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(90%_60%_at_10%_0%,color-mix(in_srgb,var(--sc-color-accent)_18%,transparent),transparent_60%),radial-gradient(70%_50%_at_100%_10%,color-mix(in_srgb,var(--sc-color-accent2)_14%,transparent),transparent_60%)]" />
      <header className="relative mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="size-8" />
          <Wordmark />
        </Link>
        <div className="ml-auto flex gap-2">
          {auth.status === 'signed-in' ? (
            <Button asChild size="sm">
              <Link href="/app">Open the app</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Create free account</Link>
              </Button>
            </>
          )}
        </div>
      </header>
      <main className="relative mx-auto max-w-5xl px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}

/** Free personal account, optionally finishing an invite or a follow. */
export function PersonalSignupForm({
  inviteToken,
  follow,
  cta = 'Create free account',
  onDone,
}: {
  inviteToken?: string;
  follow?: { type: 'user' | 'community'; id: string };
  cta?: string;
  onDone?: () => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await auth.signupPersonal({
        displayName: String(f.get('name') ?? ''),
        email: String(f.get('email') ?? ''),
        password: String(f.get('password') ?? ''),
        ...(inviteToken ? { inviteToken } : {}),
        ...(follow ? { follow } : {}),
      });
      if (onDone) onDone();
      else router.push('/app');
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      <Field label="Your name" htmlFor="su-name">
        <Input id="su-name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="su-email">
        <Input id="su-email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="su-password" hint="At least 12 characters">
        <Input
          id="su-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-label font-normal text-danger"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {cta}
      </Button>
      <p className="text-center text-meta text-text-subtle">
        Free forever for personal use. Your company uses Sampledge Connect?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in with your work account
        </Link>
      </p>
    </form>
  );
}

function SignupCard({
  title,
  body,
  inviteToken,
  follow,
}: {
  title: string;
  body: string;
  inviteToken?: string;
  follow?: { type: 'user' | 'community'; id: string };
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-glass p-5 shadow-lg backdrop-blur-xl">
      <h2 className="text-h3 text-text">{title}</h2>
      <p className="mb-4 mt-1 text-label font-normal text-text-muted">{body}</p>
      <PersonalSignupForm inviteToken={inviteToken} follow={follow} />
    </div>
  );
}

export function PublicProfilePage({ handle }: { handle: string }) {
  const { data, error } = usePublic<PublicProfile>(
    `/v1/network/public/profiles/${encodeURIComponent(handle)}`,
  );
  const auth = useAuth();
  const router = useRouter();
  const networkToken = useNetworkAction();
  const [done, setDone] = React.useState<string | null>(null);
  if (error)
    return (
      <PublicShell>
        <StateView
          state="empty"
          title="This profile isn’t public"
          description="The person may have made it private, or the link is wrong."
        />
      </PublicShell>
    );
  if (!data)
    return (
      <PublicShell>
        <StateView state="loading" title="Loading profile" />
      </PublicShell>
    );
  const p = data.profile;
  const act = async (kind: 'follow' | 'connect') => {
    try {
      const token = await networkToken();
      if (!token) return;
      if (kind === 'follow')
        await apiRequest('PUT', `/v1/network/follows/user/${p.userId}`, { token });
      else
        await apiRequest('POST', '/v1/network/requests', {
          token,
          body: { clientActionId: crypto.randomUUID(), toUserId: p.userId },
        });
      setDone(
        kind === 'follow'
          ? `You’re following ${p.displayName}`
          : `Request sent to ${p.displayName}`,
      );
    } catch (e) {
      setDone(errorText(e));
    }
  };
  return (
    <PublicShell>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
            <div className="h-28 bg-[linear-gradient(120deg,var(--sc-color-accent),var(--sc-color-accent2))]" />
            <div className="-mt-10 px-6 pb-6">
              <div className="inline-block rounded-full border-4 border-surface">
                <Avatar name={p.displayName} size="lg" />
              </div>
              <h1 className="mt-2 flex items-center gap-2 font-display text-h1 text-text">
                {p.displayName}
                {p.kind === 'work' ? (
                  <Building2 className="size-5 text-accent" />
                ) : (
                  <User className="size-5 text-text-subtle" />
                )}
              </h1>
              <p className="text-label font-normal text-text-muted">
                @{p.handle}
                {p.organizationName ? ` · ${p.organizationName}` : ''}
              </p>
              {p.headline ? <p className="mt-2 text-body text-text">{p.headline}</p> : null}
              {p.bio ? (
                <p className="mt-2 max-w-2xl whitespace-pre-line text-label font-normal text-text-muted">
                  {p.bio}
                </p>
              ) : null}
              <div className="mt-4 flex gap-6">
                {(['connections', 'followers', 'following'] as const).map((k) => (
                  <div key={k}>
                    <span className="text-h3 text-text">{p.counts[k]}</span>{' '}
                    <span className="text-meta capitalize text-text-subtle">{k}</span>
                  </div>
                ))}
              </div>
              {auth.status === 'signed-in' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => void act('connect')}>
                    <UserPlus /> Connect
                  </Button>
                  <Button variant="secondary" onClick={() => void act('follow')}>
                    Follow
                  </Button>
                  <Button variant="ghost" onClick={() => router.push('/app')}>
                    Open the app
                  </Button>
                  {done ? (
                    <Badge tone="success" className="self-center">
                      {done}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-label text-text">Public status updates</h2>
            {data.statuses.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.statuses.map((s) => (
                  <div
                    key={s.statusId}
                    className="flex aspect-[4/5] items-center justify-center rounded-xl p-6 text-center font-display text-[20px] text-white shadow-md"
                    style={{ background: BACKGROUNDS[s.background] }}
                  >
                    {s.kind === 'text' ? (
                      s.text
                    ) : s.media ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.media.url}
                        alt={s.text}
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-label font-normal text-text-subtle">
                No public updates right now.
              </p>
            )}
          </section>
        </div>
        {auth.status !== 'signed-in' ? (
          <SignupCard
            title={`Follow ${p.displayName.split(' ')[0]}`}
            body="Create a free account to follow, connect and message. It takes a minute."
            follow={{ type: 'user', id: p.userId }}
          />
        ) : null}
      </div>
    </PublicShell>
  );
}

export function PublicCommunityPage({ slug }: { slug: string }) {
  const { data, error } = usePublic<PublicCommunity>(
    `/v1/network/public/communities/${encodeURIComponent(slug)}`,
  );
  const auth = useAuth();
  const router = useRouter();
  const networkToken = useNetworkAction();
  const [done, setDone] = React.useState<string | null>(null);
  if (error)
    return (
      <PublicShell>
        <StateView
          state="empty"
          title="Community not found"
          description="It may be private. Ask a member for an invite link."
        />
      </PublicShell>
    );
  if (!data)
    return (
      <PublicShell>
        <StateView state="loading" title="Loading community" />
      </PublicShell>
    );
  const c = data.community;
  const act = async (kind: 'join' | 'follow') => {
    try {
      const token = await networkToken();
      if (!token) return;
      if (kind === 'join') {
        const r = await apiRequest<Community>(
          'POST',
          `/v1/network/communities/${c.communityId}/join`,
          { token },
        );
        setDone(
          r.myStatus === 'member'
            ? 'You joined. Open the app to chat.'
            : 'Request sent to the admins',
        );
      } else {
        await apiRequest('PUT', `/v1/network/follows/community/${c.communityId}`, { token });
        setDone('You’re following this community');
      }
    } catch (e) {
      setDone(errorText(e));
    }
  };
  return (
    <PublicShell>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-lg">
            <div
              className="absolute inset-0 opacity-25"
              style={{
                background: `radial-gradient(120% 120% at 0% 0%, ${c.avatarColor}, transparent 60%)`,
              }}
            />
            <div className="relative flex items-center gap-4">
              <span
                className="grid size-16 place-items-center rounded-2xl font-display text-h1 text-white shadow-md"
                style={{
                  background: `linear-gradient(135deg, ${c.avatarColor}, color-mix(in srgb, ${c.avatarColor} 45%, #000))`,
                }}
              >
                {c.name.slice(0, 1)}
              </span>
              <div>
                <h1 className="font-display text-h1 text-text">{c.name}</h1>
                <p className="flex items-center gap-1.5 text-label font-normal text-text-muted">
                  <Globe className="size-4" /> Public community · <Users className="size-4" />{' '}
                  {c.memberCount} members · {c.followerCount} followers
                </p>
              </div>
            </div>
            {c.description ? (
              <p className="relative mt-4 max-w-2xl text-body text-text">{c.description}</p>
            ) : null}
            {c.rules ? (
              <p className="relative mt-2 text-meta text-text-subtle">Rules: {c.rules}</p>
            ) : null}
            {auth.status === 'signed-in' ? (
              <div className="relative mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void act('join')}>
                  <UserPlus /> {c.joinPolicy === 'approval' ? 'Ask to join' : 'Join'}
                </Button>
                <Button variant="secondary" onClick={() => void act('follow')}>
                  Follow
                </Button>
                <Button variant="ghost" onClick={() => router.push('/app')}>
                  Open the app
                </Button>
                {done ? (
                  <Badge tone="success" className="self-center">
                    {done}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-md">
            <h2 className="mb-3 flex items-center gap-2 text-label text-text">
              <Megaphone className="size-4 text-accent2" /> Announcements
            </h2>
            {data.announcements.length ? (
              <ul className="flex flex-col gap-3">
                {data.announcements.map((a, i) => (
                  <li key={i} className="rounded-lg border border-border bg-surface-raised p-3">
                    <p className="whitespace-pre-line text-body text-text">{a.text}</p>
                    <p className="mt-1 text-meta text-text-subtle">
                      {a.author} · {new Date(a.at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-label font-normal text-text-subtle">No announcements yet.</p>
            )}
          </section>
        </div>
        {auth.status !== 'signed-in' ? (
          <SignupCard
            title="Follow this community"
            body="Create a free account to follow announcements, join the groups and meet members."
            follow={{ type: 'community', id: c.communityId }}
          />
        ) : null}
      </div>
    </PublicShell>
  );
}

export function NetworkInviteJoin({ token }: { token: string }) {
  const { data, error } = usePublic<NetworkInvitePreview>(
    `/v1/network/public/invites/${encodeURIComponent(token)}`,
  );
  const auth = useAuth();
  const router = useRouter();
  const networkToken = useNetworkAction();
  const [msg, setMsg] = React.useState<string | null>(null);
  if (error || (data && !data.valid))
    return (
      <PublicShell>
        <StateView
          state="empty"
          title="This invite has expired"
          description="Ask for a new one, or create a free account and search for them by Connect ID."
        />
      </PublicShell>
    );
  if (!data)
    return (
      <PublicShell>
        <StateView state="loading" title="Opening your invite" />
      </PublicShell>
    );
  const accept = async () => {
    try {
      const t = await networkToken();
      if (!t) return;
      await apiRequest('POST', `/v1/network/invites/${encodeURIComponent(token)}/accept`, {
        token: t,
      });
      setMsg(`You’re connected with ${data.inviter.displayName}`);
      setTimeout(() => router.push('/app'), 900);
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <PublicShell>
      <div className="mx-auto mt-6 max-w-md">
        <div className="mb-4 flex flex-col items-center text-center">
          <Avatar name={data.inviter.displayName} size="lg" />
          <h1 className="mt-3 font-display text-h2 text-text">
            {data.inviter.displayName} invited you to connect
          </h1>
          <p className="text-label font-normal text-text-muted">
            @{data.inviter.handle}
            {data.inviter.organizationName ? ` · ${data.inviter.organizationName}` : ''}
          </p>
        </div>
        {auth.status === 'signed-in' ? (
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" onClick={() => void accept()}>
              <UserPlus /> Accept and connect
            </Button>
            {msg ? <Badge tone="success">{msg}</Badge> : null}
          </div>
        ) : (
          <SignupCard
            title="Create your free account"
            body="You’ll be connected automatically, then you can message and call each other."
            inviteToken={token}
          />
        )}
      </div>
    </PublicShell>
  );
}

export function CommunityLinkJoin({ token }: { token: string }) {
  const { data, error } = usePublic<PublicCommunity['community'] & { valid: boolean }>(
    `/v1/network/public/community-links/${encodeURIComponent(token)}`,
  );
  const auth = useAuth();
  const router = useRouter();
  const networkToken = useNetworkAction();
  const [msg, setMsg] = React.useState<string | null>(null);
  if (error || (data && !data.valid))
    return (
      <PublicShell>
        <StateView state="empty" title="This invite link has expired" />
      </PublicShell>
    );
  if (!data)
    return (
      <PublicShell>
        <StateView state="loading" title="Opening invite" />
      </PublicShell>
    );
  const join = async () => {
    try {
      const t = await networkToken();
      if (!t) return;
      await apiRequest('POST', `/v1/network/community-links/${encodeURIComponent(token)}/join`, {
        token: t,
      });
      setMsg('You joined');
      setTimeout(() => router.push('/app'), 900);
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <PublicShell>
      <div className="mx-auto mt-6 max-w-md text-center">
        <span
          className="mx-auto grid size-16 place-items-center rounded-2xl font-display text-h1 text-white"
          style={{ background: data.avatarColor }}
        >
          {data.name.slice(0, 1)}
        </span>
        <h1 className="mt-3 font-display text-h2 text-text">Join {data.name}</h1>
        <p className="flex items-center justify-center gap-1.5 text-label font-normal text-text-muted">
          {data.visibility === 'public' ? (
            <Globe className="size-4" />
          ) : (
            <Lock className="size-4" />
          )}{' '}
          {data.memberCount} members
        </p>
        <div className="mt-4 text-left">
          {auth.status === 'signed-in' ? (
            <div className="flex flex-col items-center gap-3">
              <Button size="lg" onClick={() => void join()}>
                <UserPlus /> Join community
              </Button>
              {msg ? <Badge tone="success">{msg}</Badge> : null}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface-glass p-5 shadow-lg backdrop-blur-xl">
              <p className="mb-3 text-label font-normal text-text-muted">
                Create a free account first. Then open this link again to join.
              </p>
              <PersonalSignupForm
                cta="Create account and join"
                onDone={() => window.location.reload()}
              />
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
