import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { PersonAvatar } from './Avatar';
import { Glass } from './Glass';
import { Text } from './Text';

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * A message shown outside its conversation (pinned list, Saved): who, when, the text, and
 * one action on the right. Tapping it opens the message in its conversation.
 */
export function SavedMessageCard({
  senderName,
  senderId,
  context,
  text,
  createdAt,
  deleted,
  onOpen,
  action,
}: {
  senderName: string;
  /** For the sender's profile photo. */
  senderId?: string | null;
  /** A second line, such as the conversation or who pinned it. */
  context: string;
  text: string;
  createdAt: string;
  deleted?: boolean;
  onOpen: () => void;
  action?: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    busy?: boolean;
    disabled?: boolean;
  };
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Glass>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${senderName}, ${shortDate(createdAt)}: ${deleted ? 'deleted message' : text}. ${context}. Open in conversation`}
        style={({ pressed }) => [
          styles.card,
          pressed && { backgroundColor: alpha(c.accent, 0.06) },
        ]}
      >
        <PersonAvatar userId={senderId} name={senderName} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.head}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {senderName}
            </Text>
            <Text variant="meta" tone="subtle">
              {shortDate(createdAt)}
            </Text>
          </View>
          <Text
            tone={deleted ? 'muted' : undefined}
            numberOfLines={4}
            style={deleted ? { fontStyle: 'italic' } : undefined}
          >
            {deleted ? 'This message was deleted' : text || 'Attachment'}
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {context}
          </Text>
        </View>
        {action ? (
          <Pressable
            onPress={action.onPress}
            disabled={action.disabled || action.busy}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={10}
            style={[styles.action, { opacity: action.disabled ? 0.4 : 1 }]}
          >
            {action.busy ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <Ionicons name={action.icon} size={20} color={c.accent} />
            )}
          </Pressable>
        ) : null}
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  action: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
