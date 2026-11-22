import { Ionicons } from '@expo/vector-icons';
import { CONNECTOR_CATALOG, tenantCan } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../../components/Button';
import { MODE_LABEL, MODE_TONE, Notice, when } from '../../../components/ChannelBits';
import { Glass } from '../../../components/Glass';
import { Pill, ProviderMark, TestModeBadge } from '../../../components/InboxBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useApp, useWorkspace } from '../../../state/AppProvider';
import { useTenantRole } from '../../../state/hooks';
import { useInboxChannels, useInboxSettings } from '../../../state/useInbox';
import { space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * External messaging channels for owners and admins. The last copy shows offline; changes
 * need a connection because credentials and tests are checked by the server.
 */
export default function ChannelsScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const role = useTenantRole();
  const manage = tenantCan(role, 'connectors.manage');
  const channels = useInboxChannels(manage);
  const settings = useInboxSettings();
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const offline = engineState?.connectivity === 'offline';
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Channels' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.accent}
            onRefresh={() => {
              setRefreshing(true);
              void engine.refreshInboxAdmin().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {!manage ? (
          <Notice tone="warning" text="Only owners and admins manage channels." />
        ) : (
          <>
            <Text tone="muted">
              Start any channel in test mode: the inbox makes credentials, signs simulated client
              messages and keeps replies, so nothing reaches a real provider.
            </Text>
            {offline ? (
              <Notice
                tone="warning"
                text="You're offline. Channels show as last seen; changes wait for a connection."
              />
            ) : null}
            <Button
              title="Add channel"
              icon="add"
              disabled={offline}
              onPress={() => router.push('/inbox/channels/add')}
            />
            {channels.length === 0 ? <Text tone="muted">No channels yet.</Text> : null}
            {channels.map((ch) => {
              const d = CONNECTOR_CATALOG[ch.provider];
              const team = ch.teamId
                ? settings?.teams.find((t) => t.teamId === ch.teamId)?.name
                : null;
              return (
                <Pressable
                  key={ch.connectorId}
                  onPress={() => router.push(`/inbox/channels/${ch.connectorId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${ch.name}, ${d.name}, ${ch.environment === 'test' ? 'test mode' : 'live'}, ${ch.status}`}
                >
                  <Glass style={styles.card}>
                    <View style={styles.row}>
                      <ProviderMark provider={ch.provider} size={36} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {ch.name}
                        </Text>
                        <Text variant="meta" tone="muted" numberOfLines={1}>
                          {d.name}
                          {team ? ` · ${team}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
                    </View>
                    <View style={[styles.row, { flexWrap: 'wrap' }]}>
                      <Pill text={MODE_LABEL[d.mode]} tone={MODE_TONE[d.mode]} />
                      {ch.environment === 'test' ? (
                        <TestModeBadge />
                      ) : (
                        <Pill text="Live" tone="accent" icon="shield-checkmark-outline" />
                      )}
                      <Pill
                        text={
                          ch.status === 'active'
                            ? 'Active'
                            : ch.status === 'error'
                              ? 'Needs attention'
                              : 'Paused'
                        }
                        tone={
                          ch.status === 'active'
                            ? 'success'
                            : ch.status === 'error'
                              ? 'danger'
                              : 'warning'
                        }
                      />
                    </View>
                    {ch.missingCredentials.length ? (
                      <Text variant="meta" style={{ color: c.warning }}>
                        Missing:{' '}
                        {ch.missingCredentials
                          .map((k) => d.credentialFields.find((f) => f.key === k)?.label ?? k)
                          .join(', ')}
                      </Text>
                    ) : null}
                    {ch.health.lastError && ch.status !== 'active' ? (
                      <Text variant="meta" tone="danger" numberOfLines={2}>
                        Last error {when(ch.health.lastErrorAt)}: {ch.health.lastError}
                      </Text>
                    ) : null}
                    <Text variant="meta" tone="subtle">
                      Last client message {when(ch.health.lastInboundAt)} · {ch.health.queued}{' '}
                      queued
                      {ch.health.circuitOpenUntil ? ' · paused after failures' : ''}
                    </Text>
                  </Glass>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
