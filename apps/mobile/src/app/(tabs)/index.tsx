import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectivityBanner, ConnectivityDot } from '../../components/Connectivity';
import { ConversationRow, relativeTime } from '../../components/ConversationRow';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { ConversationSkeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { MeetingRow } from '../../components/MeetingBits';
import { isUnjoinedChannel } from '../../lib/access';
import { ConnectEngine } from '../../state/engine';
import { useCalls, useConversations, useMeetings, useNow, usePeople } from '../../state/hooks';
import { useMemo } from 'react';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { theme, org } = useTheme();
  const { session, sessionState, engineState } = useApp();
  const { selfId } = useWorkspace();
  const { conversations, loading } = useConversations();
  const nameOf = usePeople();
  const unread = conversations.reduce((n, c) => n + c.unread, 0);
  const firstName = session?.user.displayName.split(' ')[0];
  const workspaceName =
    sessionState === 'demo'
      ? 'Demo workspace'
      : (org?.organizationName ?? session?.tenant.name ?? 'Workspace');
  const recent = conversations.filter((c) => !isUnjoinedChannel(c)).slice(0, 4);
  const now = useNow();
  const calls = useCalls();
  const win = useMemo(() => ConnectEngine.meetingWindow(), []);
  const { meetings } = useMeetings(win.from, win.to);
  const next = meetings.find((m) => m.status === 'scheduled' && Date.parse(m.endsAt) > now);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.workspace}>
              {org?.logo && sessionState !== 'demo' ? (
                <Image
                  source={{ uri: org.logo }}
                  style={styles.orgLogo}
                  resizeMode="contain"
                  accessibilityLabel={`${org.displayName} logo`}
                />
              ) : null}
              <ConnectivityDot />
              <Text variant="overline" tone="muted">
                {workspaceName}
              </Text>
            </View>
            <Text variant="display" style={{ marginTop: space.xs }}>
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/search')}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border },
            ]}
            accessibilityLabel="Search"
          >
            <Ionicons name="search" size={20} color={theme.colors.text} />
          </Pressable>
        </View>
        <ConnectivityBanner />

        <View style={styles.stats}>
          <Stat label="Unread" value={String(unread)} icon="chatbubble-ellipses-outline" />
          <Stat label="Queued" value={String(engineState?.pending ?? 0)} icon="time-outline" />
          <Stat
            label="Last sync"
            value={
              sessionState === 'demo'
                ? 'Never'
                : relativeTime(engineState?.lastSyncAt ?? null) || 'Never'
            }
            icon="sync-outline"
          />
        </View>

        {next ? (
          <>
            <View style={styles.sectionHead}>
              <Text variant="heading">Next meeting</Text>
              <Pressable onPress={() => router.push('/meetings')} hitSlop={8}>
                <Text variant="label" tone="accent">
                  All meetings
                </Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: space.lg }}>
              <MeetingRow m={next} now={now} nameOf={nameOf} canJoin={!!calls.config?.enabled} />
            </View>
          </>
        ) : null}

        <View style={styles.sectionHead}>
          <Text variant="heading">Recent conversations</Text>
          <Pressable onPress={() => router.push('/messages')} hitSlop={8}>
            <Text variant="label" tone="accent">
              See all
            </Text>
          </Pressable>
        </View>
        <Glass style={styles.card}>
          {loading ? (
            <ConversationSkeleton />
          ) : recent.length === 0 ? (
            <Text tone="muted" style={{ padding: space.lg }}>
              No conversations yet. They appear here after the first sync.
            </Text>
          ) : (
            recent.map((c) => (
              <ConversationRow key={c.conversationId} c={c} nameOf={nameOf} selfId={selfId} />
            ))
          )}
        </Glass>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { theme } = useTheme();
  return (
    <Glass style={styles.stat}>
      <Ionicons name={icon} size={18} color={theme.colors.accent} />
      <Text variant="title" style={{ marginTop: space.sm }}>
        {value}
      </Text>
      <Text variant="meta" tone="muted">
        {label}
      </Text>
    </Glass>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
  },
  workspace: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  orgLogo: { width: 22, height: 22, borderRadius: 5 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  stats: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, marginTop: space.sm },
  stat: { flex: 1, padding: space.md, borderRadius: radius.lg },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  card: { marginHorizontal: space.lg, paddingVertical: space.xs },
});
