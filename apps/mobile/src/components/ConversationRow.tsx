import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LocalConversation } from '../db/store';
import { conversationTitle } from '../state/hooks';
import { space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';
import { UnreadBadge } from './UnreadBadge';

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function ConversationRow({
  c,
  nameOf,
  selfId,
}: {
  c: LocalConversation;
  nameOf: (id: string) => string;
  selfId: string;
}) {
  const { theme } = useTheme();
  const title = conversationTitle(c, nameOf, selfId);
  const isChannel = c.kind.startsWith('channel');
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/conversation/[id]', params: { id: c.conversationId } })
      }
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceSunken },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${c.unread ? `, ${c.unread} unread` : ''}${c.pending ? `, ${c.pending} queued` : ''}`}
    >
      <Avatar name={title} channel={isChannel} />
      <View style={styles.body}>
        <View style={styles.line}>
          <View style={styles.titleWrap}>
            <Text
              variant={c.unread ? 'heading' : 'bodyStrong'}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {title}
            </Text>
            {c.kind === 'channel_private' ? (
              <Ionicons name="lock-closed" size={12} color={theme.colors.textSubtle} />
            ) : null}
            {c.notifyLevel !== 'all' ? (
              <Ionicons
                name={c.notifyLevel === 'none' ? 'notifications-off' : 'at'}
                size={13}
                color={theme.colors.textSubtle}
                accessibilityLabel={c.notifyLevel === 'none' ? 'Muted' : 'Mentions only'}
              />
            ) : null}
          </View>
          <Text variant="meta" tone={c.unread ? 'accent' : 'subtle'}>
            {relativeTime(c.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.line}>
          <Text variant="label" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {c.pending ? `${c.pending} queued · ` : ''}
            {c.lastPreview ?? c.topic ?? 'No messages yet'}
          </Text>
          <UnreadBadge count={c.unread} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  body: { flex: 1, gap: 3 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
});
