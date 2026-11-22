import type { InboxAnalytics } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { ProviderMark } from '../../components/InboxBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { minutesLabel, PROVIDER_META, STATUS_LABEL } from '../../lib/inbox';
import { useWorkspace } from '../../state/AppProvider';
import { usePeople } from '../../state/hooks';
import { useInboxPath } from '../../state/useInbox';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const RANGES = [
  { key: '1', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
] as const;

/** Owners and admins: how the inbox is doing. The last copy shows offline. */
export default function InboxDashboard() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { selfId } = useWorkspace();
  const nameOf = usePeople();
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const {
    data: a,
    error,
    reload,
  } = useInboxPath<InboxAnalytics>(`/v1/inbox/analytics?days=${days}`);
  const [refreshing, setRefreshing] = useState(false);
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const mins = (x: number | null) => (x === null ? '—' : minutesLabel(x * 60_000));
  const maxDay = Math.max(1, ...(a?.daily ?? []).map((d) => d.inbound + d.outbound));

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Inbox dashboard' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.accent}
            onRefresh={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <Chips label="Period" options={[...RANGES]} selected={[days]} onToggle={setDays} />
        {error ? (
          <Text tone="danger">
            {error.code === 'FORBIDDEN'
              ? 'Only owners and admins see the dashboard.'
              : error.message}
          </Text>
        ) : null}
        {!a ? (
          <Text tone="muted">{error ? '' : 'Loading…'}</Text>
        ) : (
          <>
            <View style={styles.grid}>
              <Kpi label="Open" value={String(a.totals.open)} />
              <Kpi label="Unassigned" value={String(a.totals.unassigned)} />
              <Kpi
                label="Overdue now"
                value={String(a.totals.breachedNow)}
                danger={a.totals.breachedNow > 0}
              />
              <Kpi label="Median first reply" value={mins(a.medianFirstResponseMinutes)} />
              <Kpi label="SLA met" value={pct(a.slaMetRate)} />
              <Kpi label="Resolved" value={String(a.totals.resolved)} />
            </View>

            <Glass style={styles.card}>
              <Text variant="heading">Messages by day</Text>
              <View style={styles.bars} accessibilityLabel="Inbound and outbound messages by day">
                {a.daily.map((d) => (
                  <View key={d.day} style={styles.barCol}>
                    <View style={{ flex: 1, justifyContent: 'flex-end', width: '100%', gap: 2 }}>
                      <View
                        style={{
                          height: `${(d.outbound / maxDay) * 100}%`,
                          backgroundColor: alpha(c.accent, 0.45),
                          borderRadius: 3,
                        }}
                      />
                      <View
                        style={{
                          height: `${(d.inbound / maxDay) * 100}%`,
                          backgroundColor: c.accent,
                          borderRadius: 3,
                        }}
                      />
                    </View>
                    <Text variant="meta" tone="subtle" style={{ fontSize: 10 }}>
                      {d.day.slice(8)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.legend}>
                <Legend color={c.accent} label={`Client messages ${a.totals.inbound}`} />
                <Legend color={alpha(c.accent, 0.45)} label={`Replies ${a.totals.outbound}`} />
              </View>
            </Glass>

            <Glass style={styles.card}>
              <Text variant="heading">By channel</Text>
              {a.byProvider.length === 0 ? <Text tone="muted">No conversations yet.</Text> : null}
              {a.byProvider.map((p) => (
                <View key={p.provider} style={styles.line}>
                  <ProviderMark provider={p.provider} size={22} />
                  <Text style={{ flex: 1 }}>{PROVIDER_META[p.provider].name}</Text>
                  <Text variant="label" tone="muted">
                    {p.conversations} conv · {p.inbound} in
                  </Text>
                </View>
              ))}
              <View style={[styles.line, { flexWrap: 'wrap', marginTop: space.xs }]}>
                {a.byStatus.map((s) => (
                  <Text key={s.status} variant="meta" tone="subtle">
                    {STATUS_LABEL[s.status]} {s.count}
                  </Text>
                ))}
              </View>
            </Glass>

            <Glass style={styles.card}>
              <Text variant="heading">Agents</Text>
              {a.agents.length === 0 ? <Text tone="muted">Nobody has replied yet.</Text> : null}
              {a.agents.map((g) => (
                <View key={g.userId} style={styles.line}>
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {g.userId === selfId ? 'You' : nameOf(g.userId)}
                  </Text>
                  <Text variant="meta" tone="muted">
                    {g.open} open · {g.replies} replies · {mins(g.medianFirstResponseMinutes)}
                  </Text>
                  {g.breached ? (
                    <Text variant="meta" tone="danger">
                      {' '}
                      · {g.breached} overdue
                    </Text>
                  ) : null}
                </View>
              ))}
            </Glass>

            {a.breaches.length ? (
              <Glass style={styles.card}>
                <Text variant="heading">Waiting past their reply time</Text>
                {a.breaches.map((b) => (
                  <Pressable
                    key={b.conversationId}
                    onPress={() => router.push(`/inbox/${b.conversationId}`)}
                    accessibilityRole="button"
                    style={styles.line}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="label">{b.clientName}</Text>
                      <Text variant="meta" tone="subtle" numberOfLines={1}>
                        {b.subject}
                      </Text>
                    </View>
                    <Text variant="meta" tone="danger">
                      {minutesLabel(Date.now() - Date.parse(b.dueAt))} over
                    </Text>
                  </Pressable>
                ))}
              </Glass>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Kpi({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const { theme } = useTheme();
  return (
    <Glass style={styles.kpi}>
      <Text variant="meta" tone="subtle">
        {label}
      </Text>
      <Text variant="title" style={danger ? { color: theme.colors.danger } : null}>
        {value}
      </Text>
    </Glass>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.line}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Text variant="meta" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kpi: { width: '48%', flexGrow: 1, padding: space.md, gap: 2, borderRadius: radius.md },
  card: { padding: space.lg, gap: space.sm },
  bars: { flexDirection: 'row', height: 120, gap: 4, alignItems: 'flex-end' },
  barCol: { flex: 1, height: '100%', alignItems: 'center', gap: 2 },
  legend: { flexDirection: 'row', gap: space.lg },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
