import {
  PLATFORM_ROLE_INFO,
  formatMoney,
  platformCan,
  type PlatformOverview,
} from '@sampledge/contracts';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { netErrorText } from '../../components/NetworkBits';
import {
  LinkRow,
  Pill,
  Stat,
  usePlatformApi,
  usePlatformLive,
  usePlatformMe,
} from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { formatBytesShort } from '../../lib/platform';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Super admin console home: the whole platform at a glance, and its health. */
export default function PlatformHome() {
  const { theme } = useTheme();
  const api = usePlatformApi();
  const me = usePlatformMe();
  const [o, setO] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api
      .overview()
      .then((x) => {
        setO(x);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)))
      .finally(() => setLoading(false));
  }, [api]);
  useFocusEffect(load);
  usePlatformLive(['orgs', 'billing', 'admins'], load);

  const h = o?.health;
  const healthy = !!h && h.mongo.ok && h.redis.ok && h.migrations.pending.length === 0;
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Super admin' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading && !!o} onRefresh={load} />}
      >
        {me ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="title" style={{ flex: 1 }}>
              SampConnect
            </Text>
            <Pill text={PLATFORM_ROLE_INFO[me.role].label} tone="accent" />
          </View>
        ) : null}
        {!o ? (
          <View style={styles.center}>
            {error ? (
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {error}
              </Text>
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              <Stat
                icon="business-outline"
                value={`${o.organizations.total}`}
                label={`organizations · ${o.organizations.newLast30Days} new in 30 days`}
              />
              <Stat icon="people-outline" value={`${o.people.active}`} label="active people" />
              <Stat
                icon="card-outline"
                value={
                  o.monthlyRevenue.map((r) => formatMoney(r.amount, r.currency)).join(' · ') || '—'
                }
                label={
                  o.subscriptions.pastDue
                    ? `a month · ${o.subscriptions.pastDue} payment due`
                    : `a month · ${o.subscriptions.active} paying`
                }
                warn={o.subscriptions.pastDue > 0}
              />
              <Stat
                icon="phone-portrait-outline"
                value={`${o.devices.seenLast7Days}`}
                label="devices this week"
              />
              <Stat
                icon="chatbubbles-outline"
                value={`${o.messagesLast7Days}`}
                label="messages this week"
              />
              <Stat
                icon="cloud-outline"
                value={formatBytesShort(o.storageBytes)}
                label="files stored"
              />
              <Stat
                icon="pause-circle-outline"
                value={`${o.organizations.suspended}`}
                label={`suspended · ${o.organizations.pendingDeletion} being deleted`}
                warn={o.organizations.suspended > 0}
              />
              <Stat
                icon="flag-outline"
                value={`${o.moderation.openReports}`}
                label="open Network reports"
                warn={o.moderation.openReports > 0}
              />
            </View>
            <Glass style={{ padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  Health
                </Text>
                <Pill
                  text={healthy ? 'All systems normal' : 'Attention needed'}
                  tone={healthy ? 'ok' : 'danger'}
                />
              </View>
              <Text variant="meta" tone="muted">
                Database {h!.mongo.ok ? `${h!.mongo.latencyMs} ms` : 'unreachable'} · cache{' '}
                {h!.redis.ok ? `${h!.redis.latencyMs} ms` : 'unreachable'} · {h!.realtime.sockets}{' '}
                live connection{h!.realtime.sockets === 1 ? '' : 's'}
              </Text>
              <Text variant="meta" tone="muted">
                {h!.migrations.pending.length
                  ? `${h!.migrations.pending.length} migrations waiting`
                  : `${h!.migrations.applied} migrations applied`}{' '}
                · {h!.http.serverErrors} server errors in {h!.http.requests} requests · API{' '}
                {h!.api.version}
              </Text>
            </Glass>
          </>
        )}
        {me ? (
          <Glass>
            {platformCan(me.role, 'orgs.view') ? (
              <LinkRow
                icon="business-outline"
                label="Organizations"
                hint="Plans, suspensions, support view"
                href="/platform/orgs"
              />
            ) : null}
            {platformCan(me.role, 'moderation') ? (
              <LinkRow
                icon="flag-outline"
                label="Reported content"
                hint="SampConnect Network"
                href="/admin/moderation"
                divider
              />
            ) : null}
            <LinkRow icon="key-outline" label="Platform admins" href="/platform/admins" divider />
            {platformCan(me.role, 'audit.view') ? (
              <LinkRow
                icon="list-outline"
                label="Audit log"
                hint="What super admins did"
                href="/platform/audit"
                divider
              />
            ) : null}
          </Glass>
        ) : null}
        <Text variant="meta" tone="subtle">
          The plan catalog, online payments and platform integrations are on the web console.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
