import {
  PLATFORM_ROLE_INFO,
  platformCan,
  type BillingPlan,
  type PlatformOrgDetail,
  type PlatformSupportView,
  type SubscriptionStatus,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Field, Section, netErrorText } from '../../../components/NetworkBits';
import {
  Pill,
  Stat,
  shortDate,
  shortTime,
  usePlatformApi,
  usePlatformLive,
  usePlatformMe,
} from '../../../components/PlatformBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { formatBytesShort, orgStateText } from '../../../lib/platform';
import { space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

const STATUS_TEXT: Record<SubscriptionStatus, string> = {
  none: 'No subscription',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment due',
  canceled: 'Cancelled',
};

type Panel = null | 'suspend' | 'delete';

/**
 * One organization: usage, who to contact, plan, suspension and deletion, and a support view
 * that never signs in as anyone. Every action needs a connection and shows live on other devices.
 */
export default function PlatformOrgScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const api = usePlatformApi();
  const me = usePlatformMe();
  const [d, setD] = useState<PlatformOrgDetail | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [support, setSupport] = useState<PlatformSupportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [planId, setPlanId] = useState<string>('none');
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>('active');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .org(id)
      .then((x) => {
        setD(x);
        setPlanId(x.org.plan?.planId ?? 'none');
        setSubStatus(x.org.subscription.status === 'none' ? 'active' : x.org.subscription.status);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)))
      .finally(() => setLoading(false));
  }, [api, id]);
  useEffect(load, [load]);
  usePlatformLive(
    ['orgs', 'billing'],
    useCallback((t?: string) => (!t || t === id ? load() : undefined), [id, load]),
  );
  useEffect(() => {
    if (me && platformCan(me.role, 'billing.manage'))
      api
        .plans()
        .then(setPlans)
        .catch(() => undefined);
  }, [api, me]);

  const run = async (key: string, step: () => Promise<string>) => {
    setBusy(key);
    setNote(null);
    try {
      setNote({ text: await step(), ok: true });
      setPanel(null);
      load();
    } catch (e) {
      setNote({ text: netErrorText(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  if (!d)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Organization' }} />
        <View style={styles.center}>
          {error ? <Text tone="muted">{error}</Text> : <ActivityIndicator color={c.accent} />}
        </View>
      </Screen>
    );

  const { org, overview: ov } = d;
  const st = orgStateText(org);
  const can = (p: Parameters<typeof platformCan>[1]) => !!me && platformCan(me.role, p);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: org.name }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="title" style={{ flex: 1 }} numberOfLines={2}>
              {org.name}
            </Text>
            <Pill text={st.text} tone={st.tone} />
          </View>
          <Text variant="meta" tone="muted">
            {org.slug} · created {shortDate(org.createdAt)} · last active{' '}
            {shortDate(org.lastActiveAt)}
          </Text>
          {org.suspension ? (
            <Text variant="meta" style={{ color: c.warning }}>
              Suspended {shortDate(org.suspension.at)} by {org.suspension.byName}:{' '}
              {org.suspension.reason}
            </Text>
          ) : null}
          {org.deletionScheduledFor ? (
            <Text variant="meta" style={{ color: c.danger }}>
              Everything in this organization is erased on {shortTime(org.deletionScheduledFor)}{' '}
              unless you cancel.
            </Text>
          ) : null}
        </View>

        {note ? (
          <Text
            variant="meta"
            style={{ color: note.ok ? c.success : c.danger }}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        ) : null}

        <View style={styles.grid}>
          <Stat
            icon="people-outline"
            value={`${ov.members.active}`}
            label={`active of ${ov.members.total} people`}
          />
          <Stat
            icon="shield-checkmark-outline"
            value={`${ov.members.twoStepOn}`}
            label="with two-step on"
          />
          <Stat
            icon="phone-portrait-outline"
            value={`${ov.devices.seenLast7Days}`}
            label="devices this week"
          />
          <Stat
            icon="chatbubbles-outline"
            value={`${ov.activity.messagesLast7Days}`}
            label="messages this week"
          />
          <Stat
            icon="cloud-outline"
            value={formatBytesShort(ov.storageBytes)}
            label="files stored"
          />
          <Stat
            icon="extension-puzzle-outline"
            value={`${ov.integrations.connected}`}
            label={
              ov.integrations.failing
                ? `integrations · ${ov.integrations.failing} failing`
                : 'integrations'
            }
            warn={ov.integrations.failing > 0}
          />
        </View>

        <Section title="Plan">
          <View style={styles.pad}>
            <Text variant="bodyStrong">
              {org.plan?.name ?? 'No plan'} · {STATUS_TEXT[org.subscription.status]}
            </Text>
            <Text variant="meta" tone="muted">
              {org.subscription.seats} seat{org.subscription.seats === 1 ? '' : 's'} · billed{' '}
              {org.subscription.interval === 'year' ? 'yearly' : 'monthly'}
              {org.subscription.provider === 'stripe'
                ? ' online'
                : org.subscription.provider === 'manual'
                  ? ' by invoice'
                  : ''}
              {org.subscription.currentPeriodEnd
                ? ` · renews ${shortDate(org.subscription.currentPeriodEnd)}`
                : ''}
            </Text>
            {can('billing.manage') && org.subscription.provider !== 'stripe' ? (
              <View style={{ gap: space.sm, marginTop: space.sm }}>
                <Chips
                  label="Plan"
                  options={[
                    { key: 'none', label: 'No plan' },
                    ...plans.map((p) => ({ key: p.planId, label: p.name })),
                  ]}
                  selected={[planId]}
                  onToggle={setPlanId}
                />
                {planId !== 'none' ? (
                  <Chips
                    label="Subscription"
                    options={(['trialing', 'active', 'past_due', 'canceled'] as const).map((s) => ({
                      key: s,
                      label: STATUS_TEXT[s],
                    }))}
                    selected={[subStatus]}
                    onToggle={setSubStatus}
                  />
                ) : null}
                <Button
                  title="Save plan"
                  kind="quiet"
                  busy={busy === 'plan'}
                  onPress={() =>
                    run('plan', async () => {
                      await api.assignPlan(org.tenantId, {
                        planId: planId === 'none' ? null : planId,
                        status: planId === 'none' ? 'none' : subStatus,
                        interval: org.subscription.interval,
                        seats: Math.max(1, org.subscription.seats || ov.members.active || 1),
                        currentPeriodEnd: org.subscription.currentPeriodEnd,
                      });
                      return 'Plan saved.';
                    })
                  }
                />
              </View>
            ) : org.subscription.provider === 'stripe' ? (
              <Text variant="meta" tone="subtle" style={{ marginTop: 4 }}>
                Paid online, so the organization changes it from their own billing page.
              </Text>
            ) : null}
          </View>
        </Section>

        <Section title="Who to contact">
          {d.admins.map((p, i) => (
            <View
              key={p.userId}
              style={[styles.pad, i > 0 && styles.divider, i > 0 && { borderTopColor: c.border }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {p.name}
                </Text>
                <Pill text={p.role === 'owner' ? 'Owner' : 'Admin'} />
              </View>
              <Text variant="meta" tone="muted" selectable>
                {p.email}
                {p.twoStep ? ' · two-step on' : ''}
              </Text>
            </View>
          ))}
        </Section>

        {can('support.view') ? (
          <Section title="Support view">
            {!support ? (
              <View style={styles.pad}>
                <Text variant="meta" tone="muted">
                  People, devices, integrations and sign-in problems, without messages, files or
                  passwords, and without signing in as anyone. Opening it is written to the
                  organization’s audit log.
                </Text>
                <Button
                  title="Open support view"
                  kind="quiet"
                  icon="medkit-outline"
                  busy={busy === 'support'}
                  style={{ marginTop: space.sm }}
                  onPress={() =>
                    run('support', async () => {
                      setSupport(await api.support(org.tenantId));
                      return 'Support view opened. The organization can see this in their audit log.';
                    })
                  }
                />
              </View>
            ) : (
              <SupportPanel s={support} />
            )}
          </Section>
        ) : null}

        {d.history.length ? (
          <Section title="Super admin history">
            {d.history.slice(0, 8).map((h, i) => (
              <View
                key={h.id}
                style={[styles.pad, i > 0 && styles.divider, i > 0 && { borderTopColor: c.border }]}
              >
                <Text variant="body">{h.label}</Text>
                <Text variant="meta" tone="muted">
                  {h.actor?.name ?? 'SampConnect'} · {shortTime(h.at)}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}

        {can('orgs.manage') ? (
          <Section title="Actions">
            <View style={[styles.pad, { gap: space.sm }]}>
              {org.deletionScheduledFor ? (
                can('orgs.delete') ? (
                  <Button
                    title="Cancel deletion"
                    kind="quiet"
                    icon="arrow-undo-outline"
                    busy={busy === 'undelete'}
                    onPress={() =>
                      run('undelete', async () => {
                        await api.cancelDeletion(org.tenantId);
                        return 'Deletion cancelled. Nothing was erased.';
                      })
                    }
                  />
                ) : null
              ) : org.status === 'suspended' ? (
                <Button
                  title="Reactivate"
                  kind="quiet"
                  icon="play-circle-outline"
                  busy={busy === 'reactivate'}
                  onPress={() =>
                    run('reactivate', async () => {
                      await api.reactivate(org.tenantId);
                      return 'Reactivated. People can sign in again.';
                    })
                  }
                />
              ) : panel === 'suspend' ? (
                <View style={{ gap: space.sm }}>
                  <Field
                    label="Reason"
                    hint="Shown in the audit log. Everyone is signed out straight away."
                    value={reason}
                    onChangeText={setReason}
                    placeholder="For example: unpaid invoices"
                  />
                  <View style={styles.row}>
                    <Button
                      title="Back"
                      kind="quiet"
                      onPress={() => setPanel(null)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Suspend"
                      kind="danger"
                      disabled={!reason.trim()}
                      busy={busy === 'suspend'}
                      style={{ flex: 1 }}
                      onPress={() =>
                        run('suspend', async () => {
                          await api.suspend(org.tenantId, reason.trim());
                          setReason('');
                          return 'Suspended. Everyone in it was signed out.';
                        })
                      }
                    />
                  </View>
                </View>
              ) : (
                <Button
                  title="Suspend…"
                  kind="quiet"
                  icon="pause-circle-outline"
                  onPress={() => setPanel('suspend')}
                />
              )}
              {can('orgs.delete') && !org.deletionScheduledFor ? (
                panel === 'delete' ? (
                  <View style={{ gap: space.sm }}>
                    <Field
                      label={`Type ${org.slug} to confirm`}
                      hint="People are signed out now. Everything is erased in 30 days unless you cancel."
                      value={typed}
                      onChangeText={setTyped}
                      autoCapitalize="none"
                    />
                    <View style={styles.row}>
                      <Button
                        title="Back"
                        kind="quiet"
                        onPress={() => setPanel(null)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        title="Delete"
                        kind="danger"
                        disabled={typed.trim() !== org.slug}
                        busy={busy === 'delete'}
                        style={{ flex: 1 }}
                        onPress={() =>
                          run('delete', async () => {
                            await api.scheduleDeletion(org.tenantId, typed.trim());
                            setTyped('');
                            return 'Scheduled for deletion in 30 days.';
                          })
                        }
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    title="Delete organization…"
                    kind="danger"
                    icon="trash-outline"
                    onPress={() => setPanel('delete')}
                  />
                )
              ) : null}
            </View>
          </Section>
        ) : null}
        {me ? (
          <Text variant="meta" tone="subtle">
            Signed in as {PLATFORM_ROLE_INFO[me.role].label.toLowerCase()}.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SupportPanel({ s }: { s: PlatformSupportView }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const line = (i: number) => [
    styles.pad,
    i > 0 && styles.divider,
    i > 0 && { borderTopColor: c.border },
  ];
  return (
    <View>
      <View style={styles.pad}>
        <Text variant="label" tone="muted">
          Sign-in
        </Text>
        <Text variant="meta">
          {s.signIn.ssoEnabled ? 'Single sign-on on' : 'No single sign-on'} ·{' '}
          {s.signIn.passwordLogin ? 'passwords allowed' : 'passwords off'}
        </Text>
      </View>
      <Text
        variant="overline"
        tone="subtle"
        style={[styles.pad, styles.divider, { borderTopColor: c.border }]}
      >
        People ({s.members.length})
      </Text>
      {s.members.slice(0, 12).map((m) => (
        <View key={m.userId} style={[styles.pad, { paddingTop: 0 }]}>
          <Text variant="body" numberOfLines={1}>
            {m.name}{' '}
            <Text variant="meta" tone="muted">
              · {m.role}
            </Text>
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {m.status === 'deactivated' ? 'Deactivated · ' : ''}
            {m.devices} device{m.devices === 1 ? '' : 's'} ·{' '}
            {m.twoStep ? 'two-step on' : 'no two-step'} · seen {shortDate(m.lastSeenAt)}
          </Text>
        </View>
      ))}
      <Text
        variant="overline"
        tone="subtle"
        style={[styles.pad, styles.divider, { borderTopColor: c.border }]}
      >
        Integrations
      </Text>
      {s.integrations.length ? (
        s.integrations.map((x) => (
          <View
            key={x.providerId}
            style={[styles.pad, { paddingTop: 0, flexDirection: 'row', gap: space.sm }]}
          >
            <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
              {x.name}
            </Text>
            <Pill
              text={
                !x.enabled
                  ? 'Off'
                  : x.lastTest
                    ? x.lastTest.ok
                      ? 'Working'
                      : 'Failing'
                    : 'Not tested'
              }
              tone={!x.enabled ? 'neutral' : x.lastTest?.ok ? 'ok' : x.lastTest ? 'danger' : 'warn'}
            />
          </View>
        ))
      ) : (
        <Text variant="meta" tone="muted" style={[styles.pad, { paddingTop: 0 }]}>
          None set up.
        </Text>
      )}
      <Text
        variant="overline"
        tone="subtle"
        style={[styles.pad, styles.divider, { borderTopColor: c.border }]}
      >
        Sign-in problems and security events
      </Text>
      {s.events.length ? (
        s.events.slice(0, 10).map((e, i) => (
          <View key={e.id} style={line(i)}>
            <Text variant="body">{e.label}</Text>
            <Text variant="meta" tone="muted">
              {shortTime(e.at)}
            </Text>
          </View>
        ))
      ) : (
        <Text variant="meta" tone="muted" style={[styles.pad, { paddingTop: 0 }]}>
          Nothing recent.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pad: { padding: space.md, gap: 2 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: space.sm },
});
