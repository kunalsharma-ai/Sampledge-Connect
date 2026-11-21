'use client';
import * as React from 'react';
import { Globe } from 'lucide-react';
import {
  NetworkPolicySchema,
  type NetworkAdminView,
  type NetworkPolicy,
} from '@sampledge/contracts';
import { Badge, Button, Input, StateView, useToast } from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Switch } from './profile';
import { errorText } from './ui';

/**
 * Administration → Sampledge Network. The organization decides whether its members may connect
 * with people outside it, and with whom. Changes apply on every member's next request (cached 15s).
 */
export function NetworkPolicyTab() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [view, setView] = React.useState<NetworkAdminView | null>(null);
  const [draft, setDraft] = React.useState<NetworkPolicy | null>(null);
  const [domains, setDomains] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const v = await apiRequest<NetworkAdminView>('GET', '/v1/admin/network', {
        token: await getAccessToken(),
      });
      setView(v);
      setDraft(v.policy);
      setDomains(v.policy.allowedDomains.join(', '));
    } catch (e) {
      setError(errorText(e));
    }
  }, [getAccessToken]);
  React.useEffect(() => void load(), [load]);

  if (!view || !draft)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading network policy" />
    );

  const set = <K extends keyof NetworkPolicy>(k: K, v: NetworkPolicy[K]) =>
    setDraft({ ...draft, [k]: v });
  const save = async () => {
    const parsed = NetworkPolicySchema.safeParse({
      ...draft,
      allowedDomains: domains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      toast({
        title: 'Check the domains',
        description: parsed.error.issues[0]?.message,
        tone: 'danger',
      });
      return;
    }
    setSaving(true);
    try {
      const v = await apiRequest<NetworkAdminView>('PUT', '/v1/admin/network', {
        token: await getAccessToken(),
        body: parsed.data,
      });
      setView(v);
      setDraft(v.policy);
      setDomains(v.policy.allowedDomains.join(', '));
      toast({ title: 'Network policy saved', tone: 'success' });
    } catch (e) {
      toast({ title: 'Couldn’t save', description: errorText(e), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(view.policy) ||
    domains !== view.policy.allowedDomains.join(', ');

  const Row = ({
    title,
    detail,
    children,
  }: {
    title: string;
    detail: string;
    children: React.ReactNode;
  }) => (
    <div className="flex items-start justify-between gap-4 border-t border-border px-5 py-4 first:border-t-0">
      <div className="min-w-0">
        <p className="text-label text-text">{title}</p>
        <p className="mt-0.5 text-meta text-text-muted">{detail}</p>
      </div>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="admin-network">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-meta text-text-subtle">Members using Sampledge Network</p>
          <p className="mt-2 font-display text-h2 tabular-nums text-text">{view.linkedMembers}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-meta text-text-subtle">Connections outside your organization</p>
          <p className="mt-2 font-display text-h2 tabular-nums text-text">
            {view.externalConnections}
          </p>
        </div>
      </div>
      <section className="rounded-xl border border-border bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Globe className="size-4 text-accent" aria-hidden />
          <h2 className="text-label text-text">External connections</h2>
          <Badge tone={draft.enabled ? 'success' : 'neutral'} className="ml-auto">
            {draft.enabled ? 'On' : 'Off'}
          </Badge>
        </header>
        <Row
          title="Allow Sampledge Network"
          detail="Members can find, connect and chat with people in other organizations and with personal accounts. Turning this off signs members out of the network on their next request; their organization workspace is not affected."
        >
          <Switch
            label="Allow Sampledge Network"
            checked={draft.enabled}
            onChange={(v) => set('enabled', v)}
          />
        </Row>
        {draft.enabled ? (
          <>
            <Row
              title="Only connect with these domains"
              detail="When on, members can only connect with people whose email domain is listed below."
            >
              <Switch
                label="Only connect with listed domains"
                checked={draft.connectWith === 'allowlist'}
                onChange={(v) => set('connectWith', v ? 'allowlist' : 'anyone')}
              />
            </Row>
            {draft.connectWith === 'allowlist' ? (
              <div className="border-t border-border px-5 py-4">
                <Input
                  aria-label="Allowed domains"
                  placeholder="partner.com, client.co.uk"
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                />
              </div>
            ) : null}
            <Row
              title="Personal accounts"
              detail="Members can connect with free personal accounts that belong to no organization."
            >
              <Switch
                label="Allow personal accounts"
                checked={draft.allowPersonalAccounts}
                onChange={(v) => set('allowPersonalAccounts', v)}
              />
            </Row>
            <Row title="Communities" detail="Members can create and join communities.">
              <Switch
                label="Allow communities"
                checked={draft.allowCommunities}
                onChange={(v) => set('allowCommunities', v)}
              />
            </Row>
            <Row
              title="Status updates"
              detail="Members can post status updates to their connections and followers."
            >
              <Switch
                label="Allow status updates"
                checked={draft.allowStatus}
                onChange={(v) => set('allowStatus', v)}
              />
            </Row>
          </>
        ) : null}
      </section>
      <p className="text-meta text-text-subtle">
        Every network action by your members is written to your audit log (who, what and when, never
        message content).
      </p>
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save policy
        </Button>
      </div>
    </div>
  );
}
