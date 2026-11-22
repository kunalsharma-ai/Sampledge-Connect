import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { StatusLine } from '../../components/StatusLine';
import { Text } from '../../components/Text';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useProfile } from '../../state/hooks';
import { MODULES } from '../../state/modules';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Context drawer for everything that does not fit in the bottom bar. */
export default function More() {
  const { theme } = useTheme();
  const { session, sessionState, engineState, signOut } = useApp();
  const { selfId } = useWorkspace();
  const me = useProfile(selfId);
  const name =
    sessionState === 'demo'
      ? 'Demo user'
      : (me?.displayName ?? session?.user.displayName ?? 'Signed in');
  const sub =
    sessionState === 'demo'
      ? 'Local demo workspace, no server'
      : `${session?.tenant.name ?? ''} · ${session?.user.email ?? ''}`;

  const confirmSignOut = () => {
    const pending = engineState?.pending ?? 0;
    Alert.alert(
      'Sign out and remove local data?',
      pending > 0
        ? `${pending} message${pending === 1 ? ' is' : 's are'} still queued on this device and will be deleted. They have not reached the server.`
        : 'Cached conversations are removed from this device. They sync again when you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  const groups: { title: string; keys: string[] }[] = [
    {
      title: 'Collaborate',
      keys: [
        'channels',
        'projects',
        'meetings',
        'saved',
        'scheduled',
        'recordings',
        'files',
        'tasks',
      ],
    },
    { title: 'Discover', keys: ['search', 'ai', 'analytics'] },
    { title: 'Workspace', keys: ['integrations', 'admin'] },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120, gap: space.lg }}>
        <Pressable
          onPress={() => router.push('/settings/profile')}
          accessibilityRole="button"
          accessibilityLabel={`${name}. Edit profile and photo`}
        >
          <Glass style={styles.profile}>
            <Avatar name={name} size={52} uri={me?.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{name}</Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {me?.title ? `${me.title} · ${session?.tenant.name ?? ''}` : sub}
              </Text>
              <StatusLine status={me?.userStatus} schedule={me?.dndSchedule} />
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
          </Glass>
        </Pressable>

        {groups.map((g) => (
          <View key={g.title} style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
              {g.title}
            </Text>
            <Glass>
              {g.keys.map((k, i) => {
                const m = MODULES.find((x) => x.key === k)!;
                const href = (
                  m.status === 'available' && m.href ? m.href : `/planned/${m.key}`
                ) as Href;
                return (
                  <Row
                    key={k}
                    icon={m.icon}
                    title={m.title}
                    planned={m.status === 'planned'}
                    onPress={() => router.push(href)}
                    divider={i > 0}
                  />
                );
              })}
            </Glass>
          </View>
        ))}

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
            Settings
          </Text>
          <Glass>
            <Row
              icon="person-circle-outline"
              title="Profile and photo"
              onPress={() => router.push('/settings/profile')}
            />
            <Row
              icon="happy-outline"
              title="Status and quiet hours"
              onPress={() => router.push('/settings/status')}
              divider
            />
            <Row
              icon="color-palette-outline"
              title="Appearance"
              onPress={() => router.push('/settings/appearance')}
              divider
            />
            <Row
              icon="chatbubbles-outline"
              title="Chat theme"
              onPress={() => router.push('/settings/chat-theme')}
              divider
            />
            <Row
              icon="person-circle-outline"
              title="Call background"
              onPress={() => router.push('/settings/call-background')}
              divider
            />
            <Row
              icon="notifications-outline"
              title="Notifications"
              onPress={() => router.push('/settings/notifications')}
              divider
            />
            <Row
              icon="time-outline"
              title="Working hours"
              onPress={() => router.push('/settings/working-hours')}
              divider
            />
            <Row
              icon="phone-portrait-outline"
              title="Devices"
              onPress={() => router.push('/settings/devices')}
              divider
            />
            <Row
              icon="cloud-offline-outline"
              title="Offline & storage"
              onPress={() => router.push('/settings/storage')}
              divider
            />
            <Row icon="log-out-outline" title="Sign out" danger onPress={confirmSignOut} divider />
          </Glass>
        </View>
        <Text variant="meta" tone="subtle" style={{ textAlign: 'center' }}>
          SampConnect · One Workspace. Every Conversation. Connected.
        </Text>
      </ScrollView>
    </Screen>
  );

  function Row({
    icon,
    title,
    onPress,
    planned,
    danger,
    divider,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    onPress: () => void;
    planned?: boolean;
    danger?: boolean;
    divider?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          divider && {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          },
          pressed && { backgroundColor: theme.colors.surfaceSunken },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${title}${planned ? ', planned' : ''}`}
      >
        <Ionicons
          name={icon}
          size={20}
          color={danger ? theme.colors.danger : theme.colors.accent}
        />
        <Text variant="bodyStrong" tone={danger ? 'danger' : 'default'} style={{ flex: 1 }}>
          {title}
        </Text>
        {planned ? (
          <View
            style={[styles.tag, { backgroundColor: alpha(theme.colors.accentSecondary, 0.14) }]}
          >
            <Text variant="meta" style={{ color: theme.colors.accentSecondary }}>
              Planned
            </Text>
          </View>
        ) : null}
        {!danger ? (
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textSubtle} />
        ) : null}
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
});
