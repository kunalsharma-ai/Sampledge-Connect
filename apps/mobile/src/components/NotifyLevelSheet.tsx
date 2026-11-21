import { Ionicons } from '@expo/vector-icons';
import type { NotifyLevel } from '@sampledge/contracts';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export const NOTIFY_ICON: Record<NotifyLevel, keyof typeof Ionicons.glyphMap> = {
  all: 'notifications-outline',
  mentions: 'at',
  none: 'notifications-off-outline',
};

const OPTIONS: { level: NotifyLevel; label: string; detail: string }[] = [
  { level: 'all', label: 'All activity', detail: 'Replies, @mentions and, in DMs, every message.' },
  { level: 'mentions', label: '@Mentions only', detail: 'Only when someone @mentions you.' },
  {
    level: 'none',
    label: 'Nothing',
    detail: 'No notifications or push. Unread counts still update.',
  },
];

/** Picks what notifies you in one conversation (in-app and push follow the same rule). */
export function NotifyLevelSheet({
  visible,
  level,
  pending,
  onPick,
  onClose,
}: {
  visible: boolean;
  level: NotifyLevel;
  pending: boolean;
  onPick: (level: NotifyLevel) => void;
  onClose: () => void;
}) {
  const { theme, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  if (!visible) return null;
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
            <View style={{ paddingHorizontal: space.xs, gap: 2 }}>
              <Text variant="heading">Notify me about</Text>
              <Text variant="meta" tone="muted">
                {pending
                  ? 'Saved on this phone. Syncs to your other devices when you are online.'
                  : 'Applies on all your devices.'}
              </Text>
            </View>
            <View style={[styles.list, { borderColor: c.border }]} accessibilityRole="radiogroup">
              {OPTIONS.map((o, i) => {
                const selected = o.level === level;
                return (
                  <Pressable
                    key={o.level}
                    onPress={() => {
                      onClose();
                      if (!selected) onPick(o.level);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={o.label}
                    style={({ pressed }) => [
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                      (pressed || selected) && { backgroundColor: alpha(c.accent, 0.08) },
                    ]}
                  >
                    <Ionicons name={NOTIFY_ICON[o.level]} size={20} color={c.accent} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{o.label}</Text>
                      <Text variant="meta" tone="muted">
                        {o.detail}
                      </Text>
                    </View>
                    {selected ? <Ionicons name="checkmark" size={20} color={c.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.cancel, { backgroundColor: c.surfaceSunken }]}
            >
              <Text variant="bodyStrong" tone="muted">
                Done
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
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  cancel: { height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
