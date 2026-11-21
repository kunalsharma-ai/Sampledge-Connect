import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LocalMessage } from '../db/store';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type MessageAction =
  | 'reply'
  | 'edit'
  | 'delete'
  | 'retry'
  | 'discard'
  | 'pin'
  | 'unpin'
  | 'save'
  | 'unsave'
  | 'closePoll';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

/** Bottom sheet of actions for one message, with quick reactions on top. */
export function MessageActions({
  message,
  own,
  saved = false,
  canPin = false,
  canClosePoll = false,
  onAction,
  onReact,
  onClose,
}: {
  message: LocalMessage | null;
  own: boolean;
  /** You saved this message for later. */
  saved?: boolean;
  /** You can post here, so you can pin. */
  canPin?: boolean;
  /** Author or moderator of an open poll. */
  canClosePoll?: boolean;
  onAction: (action: MessageAction, message: LocalMessage) => void;
  onReact: (message: LocalMessage, emoji: string) => void;
  onClose: () => void;
}) {
  const { theme, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  if (!message) return null;

  const unsent = !message.messageId;
  const deleted = !!message.deletedAt;
  const rows: {
    key: MessageAction;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    danger?: boolean;
  }[] = [];
  if (unsent && own) {
    rows.push({ key: 'retry', label: 'Retry now', icon: 'refresh' });
    rows.push({
      key: 'discard',
      label: 'Delete unsent message',
      icon: 'trash-outline',
      danger: true,
    });
  } else if (!deleted) {
    rows.push({ key: 'reply', label: 'Reply', icon: 'arrow-undo-outline' });
    if (canClosePoll)
      rows.push({ key: 'closePoll', label: 'Close poll', icon: 'lock-closed-outline' });
    if (canPin)
      rows.push(
        message.pinned
          ? { key: 'unpin', label: 'Unpin', icon: 'pin' }
          : { key: 'pin', label: 'Pin to conversation', icon: 'pin-outline' },
      );
    rows.push(
      saved
        ? { key: 'unsave', label: 'Remove from saved', icon: 'bookmark' }
        : { key: 'save', label: 'Save for later', icon: 'bookmark-outline' },
    );
    if (own) {
      rows.push({ key: 'edit', label: 'Edit', icon: 'create-outline' });
      rows.push({
        key: 'delete',
        label: 'Delete for everyone',
        icon: 'trash-outline',
        danger: true,
      });
    }
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={motion.fast ? FadeIn.duration(motion.fast) : undefined}
        style={[styles.backdrop, { backgroundColor: alpha('#000000', theme.dark ? 0.55 : 0.3) }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          entering={motion.base ? SlideInDown.duration(motion.base) : undefined}
          style={{ paddingBottom: insets.bottom + space.sm, paddingHorizontal: space.md }}
        >
          <View style={[styles.sheet, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
            <Text
              variant="meta"
              tone="muted"
              numberOfLines={2}
              style={{ paddingHorizontal: space.xs }}
            >
              {deleted ? 'This message was deleted' : message.text}
            </Text>
            {!unsent && !deleted ? (
              <View>
                <View style={styles.reactions}>
                  {QUICK_REACTIONS.map((e) => {
                    const mine = message.reactions.some((r) => r.emoji === e && r.mine);
                    return (
                      <Pressable
                        key={e}
                        onPress={() => {
                          onClose();
                          onReact(message, e);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${mine ? 'Remove' : 'React with'} ${e}`}
                        accessibilityState={{ selected: mine }}
                        style={({ pressed }) => [
                          styles.reaction,
                          {
                            backgroundColor: mine ? alpha(c.accent, 0.22) : c.surfaceSunken,
                            borderColor: mine ? c.accent : 'transparent',
                            transform: [{ scale: pressed ? 0.9 : 1 }],
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 22 }}>{e}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <View style={[styles.list, { borderColor: c.border }]}>
              {rows.map((r, i) => (
                <Pressable
                  key={r.key}
                  onPress={() => {
                    onClose();
                    onAction(r.key, message);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                    pressed && { backgroundColor: alpha(c.accent, 0.08) },
                  ]}
                >
                  <Ionicons name={r.icon} size={20} color={r.danger ? c.danger : c.accent} />
                  <Text variant="bodyStrong" tone={r.danger ? 'danger' : undefined}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.cancel, { backgroundColor: c.surfaceSunken }]}
            >
              <Text variant="bodyStrong" tone="muted">
                Cancel
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    padding: space.md,
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  reaction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  cancel: { height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
