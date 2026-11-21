import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { canInWorkspace } from '../lib/access';
import { useApp, useWorkspace } from '../state/AppProvider';
import { useConversations, useTenantRole } from '../state/hooks';
import { alpha, radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Every public channel in the workspace: open one to read it, or join to post and get notified. */
export default function BrowseChannels() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  useApp();
  const role = useTenantRole();
  const { conversations } = useConversations();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();
  const canJoin = canInWorkspace(role, 'channel.public.join');

  const channels = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations
      .filter((x) => x.kind === 'channel_public' && !x.archivedAt)
      .filter(
        (x) =>
          !needle ||
          (x.name ?? '').toLowerCase().includes(needle) ||
          (x.topic ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [conversations, q]);

  const join = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await engine.joinChannel(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Browse channels',
          headerRight: canInWorkspace(role, 'channel.public.create')
            ? () => (
                <Pressable
                  onPress={() => router.push('/new-conversation')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="New channel"
                  style={{ paddingHorizontal: space.sm }}
                >
                  <Ionicons name="add-circle-outline" size={24} color={c.accent} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <FlatList
        data={channels}
        keyExtractor={(x) => x.conversationId}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 120, gap: space.sm }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingBottom: space.sm }}>
            <View
              style={[styles.search, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
            >
              <Ionicons name="search" size={16} color={c.textSubtle} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search channels"
                placeholderTextColor={c.textSubtle}
                autoCapitalize="none"
                accessibilityLabel="Search channels"
                style={[typeScale.body, { flex: 1, color: c.text, paddingVertical: 10 }]}
              />
            </View>
            {blocked ? (
              <Text variant="meta" style={{ color: c.warning }}>
                {blocked} Channels shown are the ones saved on this phone.
              </Text>
            ) : null}
            {error ? (
              <Text variant="meta" tone="danger">
                {error}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const joined = item.myRole !== null;
          return (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/conversation/[id]', params: { id: item.conversationId } })
              }
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${joined ? ', joined' : ''}`}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: c.surfaceRaised, borderColor: c.border },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Avatar name={item.name ?? '#'} size={40} channel />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  # {item.name}
                </Text>
                <Text variant="meta" tone="muted" numberOfLines={2}>
                  {[
                    item.topic,
                    `${item.memberIds.length} member${item.memberIds.length === 1 ? '' : 's'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {joined ? (
                <View style={[styles.tag, { backgroundColor: alpha(c.success, 0.14) }]}>
                  <Text variant="meta" style={{ color: c.success }}>
                    Joined
                  </Text>
                </View>
              ) : canJoin ? (
                <Button
                  title="Join"
                  kind="quiet"
                  onPress={() => void join(item.conversationId)}
                  busy={busy === item.conversationId}
                  disabled={!!blocked}
                  accessibilityLabel={`Join ${item.name}`}
                  style={{ paddingVertical: 7, paddingHorizontal: space.md }}
                />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
            {q ? 'No channel matches that search.' : 'No public channels yet.'}
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
