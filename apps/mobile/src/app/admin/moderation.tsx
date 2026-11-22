import type {
  ModerationActionKind,
  ModerationQueue,
  NetworkSuspensions,
  ReportStatus,
} from '@sampledge/contracts';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Empty, PersonRow, Section, SmallButton, netErrorText } from '../../components/NetworkBits';
import { ReportCard } from '../../components/ReportCard';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ACTION_TEXT } from '../../lib/moderation';
import { useWorkspace } from '../../state/AppProvider';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Platform operators: reported content across SampConnect Network, and who is suspended.
 * Updates live when another operator acts (on any device), and after a reconnect.
 */
export default function Moderation() {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const [status, setStatus] = useState<ReportStatus>('open');
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [susp, setSusp] = useState<NetworkSuspensions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const blocked = engine.serverActionBlocker();

  const loadQueue = useCallback(() => {
    if (engine.serverActionBlocker()) return;
    setLoading(true);
    engine
      .moderationQueue(status)
      .then((q) => {
        setQueue(q);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)))
      .finally(() => setLoading(false));
  }, [engine, status]);
  const loadSusp = useCallback(() => {
    if (engine.serverActionBlocker()) return;
    engine
      .networkSuspensions()
      .then(setSusp)
      .catch(() => undefined);
  }, [engine]);
  useFocusEffect(loadQueue);
  useEffect(() => {
    setQueue(null);
    loadQueue();
  }, [loadQueue]);
  useEffect(loadSusp, [loadSusp]);
  useEffect(
    () =>
      engine.events.on('moderation', (e) => {
        if (e.scope !== 'suspensions') loadQueue();
        if (e.scope !== 'reports') loadSusp();
      }),
    [engine, loadQueue, loadSusp],
  );

  const act = (reportId: string, action: ModerationActionKind, note: string) => {
    engine
      .moderationAct(reportId, action, note)
      .then(() => {
        setNotice(ACTION_TEXT[action].done);
        loadQueue();
        loadSusp();
      })
      .catch((e: unknown) => setNotice(netErrorText(e)));
  };
  const restore = (kind: 'users' | 'communities', id: string, name: string) => {
    engine
      .restoreSuspension(kind, id)
      .then(() => {
        setNotice(`${name} restored`);
        loadQueue();
        loadSusp();
      })
      .catch((e: unknown) => setNotice(netErrorText(e)));
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Reported content' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading && !!queue} onRefresh={loadQueue} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="meta" tone="muted">
          Reports from everyone on SampConnect Network. Removing content or suspending someone
          applies on every device at once.
        </Text>
        <Chips
          label="Reports"
          options={[
            { key: 'open', label: queue?.counts.open ? `Open (${queue.counts.open})` : 'Open' },
            { key: 'actioned', label: 'Actioned' },
            { key: 'dismissed', label: 'Dismissed' },
          ]}
          selected={[status]}
          onToggle={setStatus}
        />
        {notice ? (
          <Text variant="label" style={{ color: theme.colors.accent }}>
            {notice}
          </Text>
        ) : null}
        {!queue ? (
          <View style={styles.center}>
            {error || blocked ? (
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {error ?? `${blocked} Reviewing reports needs the server.`}
              </Text>
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}
          </View>
        ) : queue.reports.length === 0 ? (
          <Empty
            icon="shield-checkmark-outline"
            title={status === 'open' ? 'Nothing to review' : `No ${status} reports`}
          />
        ) : (
          queue.reports.map((r) => (
            <ReportCard
              key={r.reportId}
              report={r}
              kind="platform"
              onAct={(a, note) => act(r.reportId, a, note)}
            />
          ))
        )}
        {susp && susp.users.length + susp.communities.length > 0 ? (
          <Section title="Suspended">
            {susp.users.map((u, i) => (
              <PersonRow
                key={u.person.userId}
                person={u.person}
                divider={i > 0}
                onPress={() => undefined}
                tags={
                  u.reason ? (
                    <Text variant="meta" tone="subtle">
                      {u.reason}
                    </Text>
                  ) : undefined
                }
                actions={
                  <SmallButton
                    title="Restore"
                    onPress={() => restore('users', u.person.userId, u.person.displayName)}
                  />
                }
              />
            ))}
            {susp.communities.map((c, i) => (
              <View
                key={c.communityId}
                style={[styles.row, (i > 0 || susp.users.length > 0) && styles.divider]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{c.name}</Text>
                  <Text variant="meta" tone="subtle">
                    Community{c.reason ? ` · ${c.reason}` : ''}
                  </Text>
                </View>
                <SmallButton
                  title="Restore"
                  onPress={() => restore('communities', c.communityId, c.name)}
                />
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: space.xl, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.25)' },
});
