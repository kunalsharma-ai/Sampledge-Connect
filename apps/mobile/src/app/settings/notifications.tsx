import { Ionicons } from '@expo/vector-icons';
import type { PushStatus } from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  easProjectId,
  expoPushToken,
  pushPermission,
  requestPushPermission,
  type PushPermission,
} from '../../lib/push';
import { devicePlatform, useApp, useWorkspace } from '../../state/AppProvider';
import { useNotifications } from '../../state/hooks';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Status = 'ok' | 'setup' | 'off';

const PERMISSION_LABEL: Record<PushPermission, string> = {
  granted: 'Allowed',
  denied: 'Blocked in system settings',
  undetermined: 'Not asked yet',
  unsupported: 'Not available in the web preview',
};

/** What works today (in-app), and what push delivery still needs before it can be turned on. */
export default function NotificationSettings() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { sessionState, engineState } = useApp();
  const { engine } = useWorkspace();
  const [server, setServer] = useState<PushStatus | null | 'error'>(null);
  const { unread } = useNotifications();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const projectId = easProjectId();
  const demo = sessionState === 'demo';

  useEffect(() => {
    void pushPermission().then(setPermission);
    if (!demo)
      void engine
        .pushStatus()
        .then(setServer)
        .catch(() => setServer('error'));
  }, [engine, demo]);

  const allow = async () => {
    const p = await requestPushPermission();
    setPermission(p);
    const token = p === 'granted' ? await expoPushToken().catch(() => null) : null;
    const s = token ? await engine.registerPush(token, devicePlatform) : null;
    if (s) setServer(s);
  };

  const live = server && server !== 'error' ? server : null;

  const feedOk = !demo && !engineState?.notificationsError;
  const rows: { title: string; detail: string; status: Status }[] = [
    {
      title: 'In-app notifications',
      detail: demo
        ? 'Sample mentions and replies stored on this phone.'
        : feedOk
          ? `On. Mentions and replies appear in Activity and as a banner. ${unread} unread.`
          : (engineState?.notificationsError ?? 'Waiting for the server.'),
      status: demo || feedOk ? 'ok' : 'off',
    },
    {
      title: 'Permission on this device',
      detail: PERMISSION_LABEL[permission],
      status: permission === 'granted' ? 'ok' : permission === 'unsupported' ? 'off' : 'setup',
    },
    {
      title: 'This phone registered for push',
      detail: live?.tokenRegistered
        ? 'Yes. The server has this phone’s push token.'
        : !projectId
          ? 'Needs setup: this build has no EAS project ID, so the phone cannot get a push token.'
          : permission !== 'granted'
            ? 'Waiting for permission on this device.'
            : 'Not yet. It registers the next time the app opens online.',
      status: live?.tokenRegistered ? 'ok' : 'setup',
    },
    {
      title: 'Push delivery from the server',
      detail: demo
        ? 'No server in the demo workspace.'
        : live
          ? live.enabled
            ? `On, through ${live.provider === 'expo' ? 'Expo Push' : live.provider}.`
            : 'Needs setup: the server has no push provider configured. Tokens are stored meanwhile.'
          : server === 'error'
            ? 'Could not check the server.'
            : engineState?.connectivity === 'offline'
              ? 'Offline. Checked when you reconnect.'
              : 'Checking…',
      status: live?.enabled ? 'ok' : demo || !live ? 'off' : 'setup',
    },
  ];

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Glass>
          {rows.map((r, i) => (
            <View
              key={r.title}
              style={[
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <StatusIcon status={r.status} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{r.title}</Text>
                <Text variant="meta" tone="muted">
                  {r.detail}
                </Text>
              </View>
            </View>
          ))}
        </Glass>

        {permission === 'undetermined' ? (
          <Pressable
            onPress={() => void allow()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text variant="bodyStrong" tone="onAccent">
              Allow notifications on this device
            </Text>
          </Pressable>
        ) : permission === 'denied' && Platform.OS !== 'web' ? (
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={[styles.btn, { borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}
          >
            <Text variant="bodyStrong" tone="accent">
              Open system settings
            </Text>
          </Pressable>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
            What push needs
          </Text>
          <Glass style={{ padding: space.lg, gap: space.sm }}>
            {[
              'An Expo (EAS) project ID in the app config, and a device build made with EAS.',
              'iOS: an Apple Developer account and an APNs key uploaded to EAS.',
              'Android: a Firebase project, its google-services.json, and FCM credentials uploaded to EAS.',
              'Server: PUSH_PROVIDER=expo, plus EXPO_ACCESS_TOKEN if your Expo account requires one.',
            ].map((t) => (
              <View key={t} style={{ flexDirection: 'row', gap: space.sm }}>
                <Text tone="subtle">•</Text>
                <Text variant="meta" tone="muted" style={{ flex: 1 }}>
                  {t}
                </Text>
              </View>
            ))}
          </Glass>
        </View>

        <Text variant="meta" tone="subtle">
          To mute a conversation or limit it to @mentions, open it and tap the bell at the top.
        </Text>
      </ScrollView>
    </Screen>
  );

  function StatusIcon({ status }: { status: Status }) {
    const [name, color] =
      status === 'ok'
        ? (['checkmark-circle', c.success] as const)
        : status === 'setup'
          ? (['construct-outline', c.warning] as const)
          : (['remove-circle-outline', c.textSubtle] as const);
    return <Ionicons name={name} size={20} color={color} style={{ marginTop: 1 }} />;
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, padding: space.lg },
  btn: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
