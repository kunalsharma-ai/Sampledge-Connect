import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ConnectivityBanner } from '../../components/Connectivity';
import { ConversationRow } from '../../components/ConversationRow';
import { Screen } from '../../components/Screen';
import { ConversationSkeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { isUnjoinedChannel } from '../../lib/access';
import { useConversations, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'direct', label: 'Direct' },
  { key: 'channels', label: 'Channels' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

export default function Messages() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ filter?: FilterKey }>();
  const [filter, setFilter] = useState<FilterKey>(params.filter ?? 'all');
  const { conversations, loading } = useConversations();
  const { workspace, engineState } = useApp();
  const { selfId } = useWorkspace();
  const nameOf = usePeople();

  const browsable = conversations.filter(isUnjoinedChannel).length;
  const shown = useMemo(
    () =>
      conversations.filter((c) =>
        // Public channels you have not joined live in Browse channels, not your list.
        isUnjoinedChannel(c)
          ? false
          : filter === 'unread'
            ? c.unread > 0
            : filter === 'direct'
              ? c.kind === 'dm' || c.kind === 'group'
              : filter === 'channels'
                ? c.kind.startsWith('channel')
                : true,
      ),
    [conversations, filter],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Messages</Text>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Pressable
            onPress={() => router.push('/channels')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Browse channels"
            style={[styles.iconBtn, { backgroundColor: theme.colors.surfaceRaised }]}
          >
            <Ionicons name="compass-outline" size={20} color={theme.colors.accent} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/new-conversation')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="New conversation"
            style={[styles.iconBtn, { backgroundColor: theme.colors.accent }]}
          >
            <Ionicons name="create-outline" size={20} color={theme.colors.onAccent} />
          </Pressable>
        </View>
      </View>
      <ConnectivityBanner />
      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  backgroundColor: active
                    ? alpha(theme.colors.accent, 0.16)
                    : theme.colors.surfaceRaised,
                  borderColor: active ? alpha(theme.colors.accent, 0.5) : theme.colors.border,
                },
              ]}
            >
              <Text variant="label" tone={active ? 'accent' : 'muted'}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {loading ? (
        <ConversationSkeleton />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => c.conversationId}
          renderItem={({ item }) => <ConversationRow c={item} nameOf={nameOf} selfId={selfId} />}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListHeaderComponent={
            filter === 'channels' && browsable > 0 ? (
              <Pressable
                onPress={() => router.push('/channels')}
                accessibilityRole="button"
                style={[
                  styles.browse,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceRaised },
                ]}
              >
                <Ionicons name="compass-outline" size={18} color={theme.colors.accent} />
                <Text variant="label" tone="accent" style={{ flex: 1 }}>
                  {browsable} more public channel{browsable === 1 ? '' : 's'} to browse
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSubtle} />
              </Pressable>
            ) : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={!!engineState?.syncing}
              onRefresh={() => void workspace?.engine.resume()}
              tintColor={theme.colors.accent}
            />
          }
          ListEmptyComponent={
            <Text tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
              {filter === 'all'
                ? 'No conversations on this device yet. Tap the pencil to start one.'
                : 'Nothing here.'}
            </Text>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  browse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filters: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
