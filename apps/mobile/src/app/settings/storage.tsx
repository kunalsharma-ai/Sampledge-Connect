import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { relativeTime } from '../../components/ConversationRow';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { DEFAULT_QUOTA } from '../../db/store';
import { useApp, useWorkspace } from '../../state/AppProvider';
import type { Connectivity } from '../../state/engine';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const CONNECTION_LABEL: Record<Connectivity, string> = {
  online: 'Live',
  connecting: 'Reconnecting',
  offline: 'Offline',
  sessionExpired: 'Signed out',
  noServer: 'Demo, no server',
};

export default function Storage() {
  const { theme } = useTheme();
  const { store, engine, recovered } = useWorkspace();
  const { engineState, sessionState } = useApp();
  const [stats, setStats] = useState({ cachedMessages: 0, queued: 0, failed: 0, conversations: 0 });

  const load = useCallback(() => void store.stats().then(setStats), [store]);
  useEffect(() => {
    load();
    const offs = [store.events.on('outbox', load), store.events.on('conversations', load)];
    return () => offs.forEach((o) => o());
  }, [store, load]);

  const rows: [string, string][] = [
    ['Connection', CONNECTION_LABEL[engineState?.connectivity ?? 'offline']],
    ['Conversations on device', String(stats.conversations)],
    [
      'Messages cached',
      `${stats.cachedMessages} (keeps newest ${DEFAULT_QUOTA.maxMessagesPerConversation} per conversation)`,
    ],
    ['Queued to send', String(stats.queued)],
    ['Not sent (needs action)', String(stats.failed)],
    [
      'Last successful sync',
      sessionState === 'demo'
        ? 'No server'
        : relativeTime(engineState?.lastSyncAt ?? null) || 'Never',
    ],
    ['Last sync error', engineState?.lastSyncError ?? 'None'],
  ];

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {recovered ? (
          <Glass style={{ padding: space.lg }}>
            <Text variant="label">The local cache was rebuilt</Text>
            <Text variant="meta" tone="muted">
              It could not be upgraded in place. Unsent messages and drafts were kept; everything
              else downloads again.
            </Text>
          </Glass>
        ) : null}
        <Glass>
          {rows.map(([k, v], i) => (
            <View
              key={k}
              style={[
                styles.row,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                },
              ]}
            >
              <Text variant="label" tone="muted" style={{ flex: 1 }}>
                {k}
              </Text>
              <Text variant="label" style={{ flex: 1, textAlign: 'right' }}>
                {v}
              </Text>
            </View>
          ))}
        </Glass>
        <Text variant="meta" tone="subtle">
          Messages are written to an encrypted database on this device before they are sent, so
          nothing you send is lost if the connection drops or the app closes. Queued messages go out
          automatically when the connection returns.
        </Text>
        <Action
          label="Sync now"
          onPress={() => void engine.resume()}
          disabled={sessionState !== 'active'}
        />
        <Action
          label={`Retry ${stats.failed} unsent message${stats.failed === 1 ? '' : 's'}`}
          disabled={stats.failed === 0}
          onPress={() => void store.retryAllFailed().then(() => engine.resume())}
        />
        <Action
          label="Clear downloaded history"
          danger
          onPress={() =>
            Alert.alert(
              'Clear downloaded history?',
              'Messages from the server are removed from this device and download again on the next sync. Queued messages and drafts are kept.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => void store.clearSyncedCache().then(() => engine.resume()),
                },
              ],
            )
          }
        />
      </ScrollView>
    </Screen>
  );

  function Action({
    label,
    onPress,
    disabled,
    danger,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.btn,
          {
            borderColor: danger ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surfaceRaised,
            opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text variant="bodyStrong" tone={danger ? 'danger' : 'accent'}>
          {label}
        </Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: 12, gap: space.md },
  btn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
