import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  easProjectId,
  pushPermission,
  requestPushPermission,
  type PushPermission,
} from '../../lib/push';
import { useApp } from '../../state/AppProvider';
import { useNotifications } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
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
  const { unread } = useNotifications();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const projectId = easProjectId();
  const demo = sessionState === 'demo';

  useEffect(() => {
    void pushPermission().then(setPermission);
  }, []);

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
      title: 'Push token',
      detail: projectId
        ? 'Ready to register once the server accepts tokens.'
        : 'Needs setup: this build has no EAS project ID, so the device cannot get a push token.',
      status: 'setup',
    },
    {
      title: 'Push delivery from the server',
      detail:
        'Needs setup: the server cannot register devices or send push yet. Until then, nothing is sent to this phone while the app is closed.',
      status: 'setup',
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
            onPress={() => void requestPushPermission().then(setPermission)}
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
              'Server: the push-token endpoint and an Expo access token on the server.',
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

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
            Per-conversation mute
          </Text>
          <Glass style={[styles.row, { alignItems: 'center' }]}>
            <Ionicons name="volume-mute-outline" size={20} color={c.accent} />
            <Text variant="meta" tone="muted" style={{ flex: 1 }}>
              Choose all messages, mentions only, or nothing for each conversation.
            </Text>
            <View style={[styles.tag, { backgroundColor: alpha(c.accentSecondary, 0.14) }]}>
              <Text variant="meta" style={{ color: c.accentSecondary }}>
                Planned
              </Text>
            </View>
          </Glass>
        </View>
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
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
});
