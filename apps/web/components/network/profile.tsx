'use client';
import * as React from 'react';
import { Copy, Globe, Lock } from 'lucide-react';
import type { MyNetworkProfile, NetworkPrivacy } from '@sampledge/contracts';
import { Badge, Button, Field, Input, StateView, Textarea, cn, useToast } from '@sampledge/ui';
import { useNet, useNetwork } from '@/lib/network';
import { PersonLine, errorText } from './ui';

const TOGGLES: { key: keyof NetworkPrivacy; label: string; hint: string }[] = [
  {
    key: 'discoverableByName',
    label: 'Find me by name',
    hint: 'People can find you by typing your name. Your exact Connect ID always works.',
  },
  {
    key: 'findableByEmail',
    label: 'Find me by email',
    hint: 'Someone who types your exact email address can find you.',
  },
  {
    key: 'findableByPhone',
    label: 'Find me by phone',
    hint: 'Someone who types your exact phone number can find you.',
  },
  {
    key: 'allowFollowers',
    label: 'Allow followers',
    hint: 'Followers see statuses you share with followers or the public.',
  },
  {
    key: 'showOrganization',
    label: 'Show my organization',
    hint: 'Shows your company name next to your name.',
  },
];

/** Your Connect ID, profile and privacy. Saved for every device. */
export function ProfileCard() {
  const { data: me } = useNet<MyNetworkProfile>('/v1/network/me', ['profile']);
  const net = useNetwork();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<{
    handle: string;
    displayName: string;
    headline: string;
    bio: string;
    phone: string;
  } | null>(null);
  React.useEffect(() => {
    if (me && !draft)
      setDraft({
        handle: me.handle,
        displayName: me.displayName,
        headline: me.headline,
        bio: me.bio,
        phone: me.phone ?? '',
      });
  }, [me, draft]);
  if (!me || !draft) return <StateView state="loading" title="Loading your profile" />;

  const save = async (body: Record<string, unknown>, label = 'Profile saved') => {
    try {
      const r = await net.act({
        method: 'PATCH',
        path: '/v1/network/me',
        body,
        label: 'Update profile',
        scopes: ['profile'],
      });
      toast({
        title: r === null ? 'Saved on this device' : label,
        description: r === null ? 'It syncs when you’re back online.' : undefined,
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Couldn’t save', description: errorText(e), tone: 'danger' });
    }
  };
  const setPrivacy = (p: Partial<NetworkPrivacy>) => void save({ privacy: p }, 'Privacy updated');

  return (
    <>
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-md">
        <div className="h-20 bg-[linear-gradient(120deg,var(--sc-color-accent),var(--sc-color-accent2))] opacity-80" />
        <div className="-mt-8 flex flex-wrap items-end gap-4 px-5 pb-5">
          <div className="rounded-full border-4 border-surface">
            <PersonLine person={me} size="lg" />
          </div>
          <div className="ml-auto flex gap-4 text-center">
            {(['connections', 'followers', 'following'] as const).map((k) => (
              <div key={k}>
                <p className="text-h3 text-text">{me.counts[k]}</p>
                <p className="text-meta capitalize text-text-subtle">{k}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {me.home ? (
            <Badge tone="accent">Work account · {me.home.tenantName}</Badge>
          ) : (
            <Badge>Personal account</Badge>
          )}
          {me.publicUrl ? (
            <>
              <Badge tone="success" className="gap-1">
                <Globe className="size-3" /> Public profile
              </Badge>
              <span className="min-w-0 flex-1 truncate text-meta text-text-subtle">
                {me.publicUrl}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(me.publicUrl!)
                    .then(() => toast({ title: 'Link copied', tone: 'success' }))
                }
              >
                <Copy /> Copy link
              </Button>
            </>
          ) : (
            <Badge className="gap-1">
              <Lock className="size-3" /> Visible to signed-in people only
            </Badge>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-label text-text">Profile</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Connect ID"
            htmlFor="p-handle"
            hint="Share it so people can find you. Letters, numbers, dots and underscores."
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle">
                @
              </span>
              <Input
                id="p-handle"
                className="pl-7"
                value={draft.handle}
                onChange={(e) => setDraft({ ...draft, handle: e.target.value.toLowerCase() })}
              />
            </div>
          </Field>
          <Field label="Name" htmlFor="p-name">
            <Input
              id="p-name"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            />
          </Field>
          <Field label="Headline" htmlFor="p-headline">
            <Input
              id="p-headline"
              value={draft.headline}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
              placeholder="Research Director, panels and fieldwork"
            />
          </Field>
          <Field
            label="Phone (private)"
            htmlFor="p-phone"
            hint="Only used for exact-match search, if you allow it."
          >
            <Input
              id="p-phone"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+44 7700 900123"
            />
          </Field>
        </div>
        <Field label="About" htmlFor="p-bio">
          <Textarea
            id="p-bio"
            rows={3}
            maxLength={600}
            value={draft.bio}
            onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() =>
              void save({
                ...(draft.handle !== me.handle ? { handle: draft.handle } : {}),
                displayName: draft.displayName,
                headline: draft.headline,
                bio: draft.bio,
                phone: draft.phone.trim() ? draft.phone : null,
              })
            }
          >
            Save profile
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-label text-text">Privacy</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            active={me.privacy.profileVisibility === 'public'}
            title="Public profile"
            body="Anyone with the link can see your profile and public statuses, and follow you."
            onClick={() => setPrivacy({ profileVisibility: 'public' })}
          />
          <ChoiceCard
            active={me.privacy.profileVisibility === 'network'}
            title="Signed-in people only"
            body="Only people on Sampledge Connect can see your profile."
            onClick={() => setPrivacy({ profileVisibility: 'network' })}
          />
        </div>
        <ul className="mt-4 divide-y divide-border">
          {TOGGLES.map((t) => (
            <li key={t.key} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-label text-text">{t.label}</p>
                <p className="text-meta text-text-subtle">{t.hint}</p>
              </div>
              <Switch
                checked={!!me.privacy[t.key]}
                onChange={(v) => setPrivacy({ [t.key]: v })}
                label={t.label}
              />
            </li>
          ))}
          <li className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-label text-text">Accept connection requests</p>
              <p className="text-meta text-text-subtle">
                Turn off to stop new requests. Your connections stay.
              </p>
            </div>
            <Switch
              checked={me.privacy.allowRequestsFrom === 'everyone'}
              onChange={(v) => setPrivacy({ allowRequestsFrom: v ? 'everyone' : 'nobody' })}
              label="Accept connection requests"
            />
          </li>
        </ul>
      </section>
    </>
  );
}

function ChoiceCard({
  active,
  title,
  body,
  onClick,
}: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border p-3 text-left transition-colors',
        active ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong',
      )}
    >
      <p className="text-label text-text">{title}</p>
      <p className="text-meta text-text-subtle">{body}</p>
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
