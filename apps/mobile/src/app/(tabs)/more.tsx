import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { StatusLine } from '../../components/StatusLine';
import { Text } from '../../components/Text';
import { netErrorText } from '../../components/NetworkBits';
import { devicePlatform, useApp, useWorkspace } from '../../state/AppProvider';
import { useInNetwork } from '../../state/useNetwork';
import { useProfile } from '../../state/hooks';
import { MODULES } from '../../state/modules';
import { usePlatformMe } from '../../components/PlatformBits';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Context drawer for everything that does not fit in the bottom bar. */
export default function More() {
  const { theme } = useTheme();
  const { session, sessionState, engineState, signOut, sessions } = useApp();
  const { selfId } = useWorkspace();
  const me = useProfile(selfId);
  const network = useInNetwork();
  const platform = usePlatformMe();
  const [opening, setOpening] = useState(false);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const work = sessionState !== 'demo' && !sessions.isPersonal ? sessions.primary : null;

  // First opening links this work account to SampConnect Network (needs a connection once).
  const openNetwork = async () => {
    setOpening(true);
    setSpaceError(null);
    try {
      await sessions.openNetwork({
        name: Constants.deviceName ?? `${Platform.OS} device`,
        platform: devicePlatform,
      });
    } catch (e) {
      setSpaceError(netErrorText(e));
    } finally {
      setOpening(false);
    }
  };
  const name =
    sessionState === 'demo'
      ? 'Demo user'
      : (me?.displayName ?? session?.user.displayName ?? 'Signed in');
  const sub =
    sessionState === 'demo'
      ? 'Local demo workspace, no server'
      : network
        ? `SampConnect Network · ${session?.user.email ?? ''}`
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

  const groups: { title: string; keys: string[] }[] = network
    ? [{ title: 'Collaborate', keys: ['saved'] }]
    : [
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
        { title: 'Workspace', keys: ['integrations', 'admin', ...(platform ? ['platform'] : [])] },
      ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120, gap: space.lg }}>
        <Pressable
          onPress={() => router.push(network ? '/network/profile' : '/settings/profile')}
          accessibilityRole="button"
          accessibilityLabel={`${name}. Edit profile${network ? '' : ' and photo'}`}
        >
          <Glass style={styles.profile}>
            <Avatar name={name} size={52} uri={me?.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{name}</Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {me?.title && !network ? `${me.title} · ${session?.tenant.name ?? ''}` : sub}
              </Text>
              <StatusLine status={me?.userStatus} schedule={me?.dndSchedule} />
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
          </Glass>
        </Pressable>

        {work ? (
          <View style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
              Space
            </Text>
            <Glass>
              <Pressable
                onPress={() => (network ? void sessions.openWork() : void openNetwork())}
                disabled={opening}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.colors.surfaceSunken },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  network ? `Switch to Work: ${work.tenant.name}` : 'Open SampConnect Network'
                }
              >
                <Ionicons
                  name={network ? 'business-outline' : 'globe-outline'}
                  size={20}
                  color={theme.colors.accent}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">
                    {network ? `Work: ${work.tenant.name}` : 'SampConnect Network'}
                  </Text>
                  <Text variant="meta" tone="muted">
                    {network
                      ? 'Back to your organization'
                      : 'Connect, chat and call with people in any organization'}
                  </Text>
                </View>
                {opening ? (
                  <ActivityIndicator color={theme.colors.accent} />
                ) : (
                  <Ionicons name="swap-horizontal" size={18} color={theme.colors.textSubtle} />
                )}
              </Pressable>
            </Glass>
            {spaceError ? (
              <Text variant="label" tone="danger" style={{ marginLeft: space.xs }}>
                {spaceError}
              </Text>
            ) : null}
          </View>
        ) : null}

        {network ? (
          <View style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
              SampConnect Network
            </Text>
            <Glass>
              <Row icon="people-outline" title="People" onPress={() => router.push('/people')} />
              <Row
                icon="person-add-outline"
                title="Invite someone"
                onPress={() => router.push('/network/invite')}
                divider
              />
              <Row
                icon="id-card-outline"
                title="Network profile and privacy"
                onPress={() => router.push('/network/profile')}
                divider
              />
              <Row
                icon="ban-outline"
                title="Blocked people"
                onPress={() => router.push('/network/blocked')}
                divider
              />
              <Row
                icon="radio-outline"
                title="Post a status"
                onPress={() => router.push('/network/status/new')}
                divider
              />
              <Row
                icon="people-circle-outline"
                title="Communities"
                onPress={() => router.push('/network/communities')}
                divider
              />
            </Glass>
          </View>
        ) : null}

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
            {network ? null : (
              <>
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
              </>
            )}
            <Row
              icon="color-palette-outline"
              title="Appearance"
              onPress={() => router.push('/settings/appearance')}
              divider={!network}
            />
            <Row
              icon="chatbubbles-outline"
              title="Chat theme"
              onPress={() => router.push('/settings/chat-theme')}
              divider
            />
            {network ? null : (
              <Row
                icon="person-circle-outline"
                title="Call background"
                onPress={() => router.push('/settings/call-background')}
                divider
              />
            )}
            <Row
              icon="notifications-outline"
              title="Notifications"
              onPress={() => router.push('/settings/notifications')}
              divider
            />
            {network ? null : (
              <Row
                icon="time-outline"
                title="Working hours"
                onPress={() => router.push('/settings/working-hours')}
                divider
              />
            )}
            <Row
              icon="phone-portrait-outline"
              title="Devices"
              onPress={() => router.push('/settings/devices')}
              divider
            />
            {work ? (
              <Row
                icon="key-outline"
                title="Password"
                onPress={() => router.push('/settings/password')}
                divider
              />
            ) : null}
            <Row
              icon="help-buoy-outline"
              title="Help center"
              onPress={() => router.push('/help')}
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
