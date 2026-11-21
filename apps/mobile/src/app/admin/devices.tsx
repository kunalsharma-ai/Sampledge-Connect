import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { usePeople } from '../../state/hooks';
import type { DeviceSession } from '../../sync/transport';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  ios: 'phone-portrait-outline',
  android: 'phone-portrait-outline',
  web: 'globe-outline',
  desktop: 'desktop-outline',
};

/** Every signed-in device in the organization; admins can sign any of them out. */
export default function OrgDevices() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const [rows, setRows] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(() => {
    if (engine.serverActionBlocker()) return;
    engine
      .listAllDevices()
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [engine]);
  // Fresh numbers each time you open it, and after each sync (changes made on other devices).
  useFocusEffect(load);
  const lastSyncAt = useApp().engineState?.lastSyncAt;
  useEffect(load, [load, lastSyncAt]);
  const active = useMemo(() => (rows ?? []).filter((d) => !d.revokedAt), [rows]);

  const signOut = (d: DeviceSession) => {
    const go = () => {
      setBusy(d.sessionId);
      engine
        .revokeAnyDevice(d.sessionId)
        .then(load)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null));
    };
    if (Platform.OS === 'web') return go();
    Alert.alert('Sign this device out?', `${nameOf(d.userId)} · ${d.name}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: go },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Devices' }} />
      <FlatList
        data={active}
        keyExtractor={(d) => d.sessionId}
        onRefresh={load}
        refreshing={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 80, gap: space.sm }}
        ListHeaderComponent={
          error || blocked ? (
            <Text variant="meta" tone="danger" style={{ marginBottom: space.sm }}>
              {error ?? `${blocked}`}
            </Text>
          ) : rows ? (
            <Text variant="meta" tone="muted" style={{ marginBottom: space.sm }}>
              {active.length} signed-in device{active.length === 1 ? '' : 's'}. Signing one out ends
              its session at once.
            </Text>
          ) : undefined
        }
        renderItem={({ item: d }) => (
          <Glass style={styles.row}>
            <Ionicons
              name={ICON[d.platform] ?? 'hardware-chip-outline'}
              size={22}
              color={c.accent}
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {d.userId === selfId ? 'You' : nameOf(d.userId)}
                {d.current ? ' · this device' : ''}
              </Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {d.name} · last seen{' '}
                {new Date(d.lastSeenAt).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            {d.current ? null : busy === d.sessionId ? (
              <ActivityIndicator color={c.accent} />
            ) : (
              <Pressable
                onPress={() => signOut(d)}
                accessibilityRole="button"
                accessibilityLabel={`Sign out ${nameOf(d.userId)} on ${d.name}`}
                hitSlop={8}
              >
                <Text variant="label" tone="danger">
                  Sign out
                </Text>
              </Pressable>
            )}
          </Glass>
        )}
        ListEmptyComponent={
          rows ? undefined : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
});
