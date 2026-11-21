import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import type { LocalNotification } from '../../db/store';
import { useApp, useWorkspace } from '../../state/AppProvider';
import {
  conversationTitle,
  useConversations,
  useNotifications,
  usePeople,
} from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const VERB: Record<LocalNotification['kind'], string> = {
  mention: 'mentioned you',
  reply: 'replied to you',
};

/** Activity: mentions of you and replies to your messages, from the server feed cached on this device. */
export default function Activity() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState, sessionState } = useApp();
  const nameOf = usePeople();
  const { items, unread, loading } = useNotifications();
  const { conversations } = useConversations();
  const titles = useMemo(
    () =>
      new Map(conversations.map((x) => [x.conversationId, conversationTitle(x, nameOf, selfId)])),
    [conversations, nameOf, selfId],
  );
  const offline = engineState?.connectivity === 'offline';
  const feedError = sessionState === 'active' && !offline ? engineState?.notificationsError : null;

  const open = (n: LocalNotification) => {
    if (!n.readAt) void engine.markNotificationsRead({ notificationIds: [n.notificationId] });
    router.push({ pathname: '/conversation/[id]', params: { id: n.conversationId } });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">Activity</Text>
          <Text tone="muted">
            {unread > 0 ? `${unread} unread` : 'Mentions and replies, newest first.'}
          </Text>
        </View>
        {unread > 0 ? (
          <Pressable
            onPress={() => void engine.markNotificationsRead({ all: true })}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.markAll,
              { backgroundColor: alpha(c.accent, pressed ? 0.2 : 0.12) },
            ]}
          >
            <Ionicons name="checkmark-done" size={16} color={c.accent} />
            <Text variant="label" tone="accent">
              Mark all read
            </Text>
          </Pressable>
        ) : null}
      </View>
      {offline || feedError ? (
        <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
          <Ionicons
            name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
            size={16}
            color={c.warning}
          />
          <Text variant="meta" style={{ flex: 1 }}>
            {offline
              ? 'Offline. Showing what was saved on this device; read marks sync when you reconnect.'
              : `Could not refresh: ${feedError}`}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(n) => n.notificationId}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, flexGrow: 1, paddingBottom: 96 }}
        renderItem={({ item }) => {
          const isUnread = !item.readAt;
          return (
            <Pressable
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${nameOf(item.actorId)} ${VERB[item.kind]}${isUnread ? ', unread' : ''}`}
            >
              <Glass
                style={[
                  styles.card,
                  isUnread && { borderColor: alpha(c.accent, 0.45), borderWidth: 1 },
                ]}
              >
                <View>
                  <Avatar name={nameOf(item.actorId)} size={38} />
                  <View
                    style={[
                      styles.kindBadge,
                      { backgroundColor: c.accent, borderColor: c.background },
                    ]}
                  >
                    <Ionicons
                      name={item.kind === 'mention' ? 'at' : 'arrow-undo'}
                      size={10}
                      color={c.onAccent}
                    />
                  </View>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.titleRow}>
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {nameOf(item.actorId)}
                      <Text tone="muted"> {VERB[item.kind]}</Text>
                    </Text>
                    <Text variant="meta" tone="subtle">
                      {when(item.createdAt)}
                    </Text>
                    {isUnread ? <View style={[styles.dot, { backgroundColor: c.accent }]} /> : null}
                  </View>
                  <Text variant="meta" tone="subtle" numberOfLines={1}>
                    in {titles.get(item.conversationId) ?? 'a conversation'}
                  </Text>
                  <Text tone={isUnread ? 'default' : 'muted'} numberOfLines={2}>
                    {item.preview}
                  </Text>
                </View>
              </Glass>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.empty}>
              <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.14) }]}>
                <Ionicons name="notifications-outline" size={26} color={c.accent} />
              </View>
              <Text variant="heading">You're all caught up</Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                When someone @mentions you or replies to your message, it shows up here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          items.length > 0 ? (
            <Pressable
              onPress={() => router.push('/settings/notifications')}
              accessibilityRole="button"
            >
              <Text
                variant="meta"
                tone="subtle"
                style={{ textAlign: 'center', marginTop: space.lg }}
              >
                Push notifications need setup. See Settings, Notifications.
              </Text>
            </Pressable>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  markAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  card: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg },
  kindBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
