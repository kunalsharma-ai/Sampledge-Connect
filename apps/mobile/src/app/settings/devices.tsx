import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { confirmThen } from '../../lib/confirm';
import { useApp, useWorkspace } from '../../state/AppProvider';
import type { DeviceSession } from '../../sync/transport';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const PLATFORM_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  ios: 'phone-portrait-outline',
  android: 'phone-portrait-outline',
  web: 'globe-outline',
  pwa: 'globe-outline',
  desktop: 'desktop-outline',
};

const PLATFORM_LABEL: Record<string, string> = {
  ios: 'iPhone or iPad',
  android: 'Android',
  web: 'Web browser',
  pwa: 'Installed web app',
  desktop: 'Desktop app',
};

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 2) return 'Active now';
  if (mins < 60) return `Active ${mins} min ago`;
  if (mins < 24 * 60) return `Active ${Math.round(mins / 60)} h ago`;
  return `Last active ${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** Where you are signed in. Signing out a device ends its session and stops its push at once. */
export default function Devices() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(async () => {
    if (engine.serverActionBlocker()) return;
    setLoading(true);
    try {
      setDevices(await engine.listDevices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    void load();
  }, [load, engineState?.networkUp]);

  const revoke = (d: DeviceSession) =>
    confirmThen(
      `Sign out ${d.name}?`,
      'That device is signed out straight away and stops getting notifications. Messages queued on it that have not been sent are lost.',
      'Sign out',
      () =>
        void (async () => {
          setBusy(d.sessionId);
          try {
            await engine.revokeDevice(d.sessionId);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        })(),
    );

  const active = (devices ?? []).filter((d) => !d.revokedAt);
  const current = active.filter((d) => d.current);
  const others = active.filter((d) => !d.current);

  const row = (d: DeviceSession, i: number) => (
    <View
      key={d.sessionId}
      style={[
        styles.row,
        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.12) }]}>
        <Ionicons
          name={PLATFORM_ICON[d.platform] ?? 'hardware-chip-outline'}
          size={20}
          color={c.accent}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {d.name}
        </Text>
        <Text variant="meta" tone="muted" numberOfLines={1}>
          {PLATFORM_LABEL[d.platform] ?? d.platform} ·{' '}
          {d.current ? 'This device' : when(d.lastSeenAt)}
        </Text>
        <Text variant="meta" tone="subtle">
          Signed in{' '}
          {new Date(d.createdAt).toLocaleDateString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </Text>
      </View>
      {!d.current ? (
        <Button
          title="Sign out"
          kind="danger"
          onPress={() => revoke(d)}
          busy={busy === d.sessionId}
          disabled={!!blocked}
          accessibilityLabel={`Sign out ${d.name}`}
          style={{ paddingVertical: 7, paddingHorizontal: space.md }}
        />
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Devices' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.accent} />
        }
      >
        <Text tone="muted">
          Everywhere your account is signed in. If you lose a phone, sign it out here and it is
          locked out at once.
        </Text>
        {blocked || error ? (
          <View
            style={[styles.note, { backgroundColor: alpha(error ? c.danger : c.warning, 0.12) }]}
          >
            <Text variant="meta" style={{ color: error ? c.danger : c.warning }}>
              {error ?? blocked}
            </Text>
          </View>
        ) : null}
        {devices ? (
          <>
            <View style={{ gap: space.sm }}>
              <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
                This device
              </Text>
              <Glass>{current.map(row)}</Glass>
            </View>
            <View style={{ gap: space.sm }}>
              <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
                Other devices · {others.length}
              </Text>
              {others.length ? (
                <Glass>{others.map(row)}</Glass>
              ) : (
                <Text tone="muted" style={{ marginLeft: space.xs }}>
                  You are not signed in anywhere else.
                </Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  note: { padding: space.md, borderRadius: radius.md },
});
