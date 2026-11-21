import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LocalNotification } from '../db/store';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, usePeople } from '../state/hooks';
import { radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';

const SHOW_MS = 5_000;

/**
 * In-app alert for a mention or reply that arrives live while you are elsewhere in the app.
 * It is not shown for the conversation you are already reading.
 */
export function NotificationBanner() {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { engine, store, selfId } = useWorkspace();
  const nameOf = usePeople();
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;
  const [shown, setShown] = useState<{ n: LocalNotification; where: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      engine.events.on('notification', (n) => {
        if (path.current === `/conversation/${n.conversationId}`) return;
        void store.getConversation(n.conversationId).then((conv) => {
          setShown({ n, where: conv ? conversationTitle(conv, nameOf, selfId) : '' });
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setShown(null), SHOW_MS);
        });
      }),
    [engine, store, nameOf, selfId],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Opening the conversation by other means hides the banner for it.
  useEffect(() => {
    if (shown && pathname === `/conversation/${shown.n.conversationId}`) setShown(null);
  }, [pathname, shown]);

  if (!shown) return null;
  const { n, where } = shown;
  const verb = n.kind === 'mention' ? 'mentioned you' : 'replied to you';
  return (
    <Animated.View
      entering={motion.base ? FadeInUp.duration(motion.base) : undefined}
      exiting={motion.base ? FadeOutUp.duration(motion.fast || motion.base) : undefined}
      style={[styles.wrap, { top: insets.top + space.sm }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => {
          setShown(null);
          void engine.markNotificationsRead({ notificationIds: [n.notificationId] });
          router.push({ pathname: '/conversation/[id]', params: { id: n.conversationId } });
        }}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${nameOf(n.actorId)} ${verb}${where ? ` in ${where}` : ''}: ${n.preview}`}
        style={[
          styles.card,
          { backgroundColor: c.surfaceRaised, borderColor: c.border, shadowColor: '#000' },
        ]}
      >
        <Avatar name={nameOf(n.actorId)} size={36} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="label" numberOfLines={1}>
            {nameOf(n.actorId)}
            <Text variant="label" tone="muted">
              {' '}
              {verb}
              {where ? ` in ${where}` : ''}
            </Text>
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={2}>
            {n.preview}
          </Text>
        </View>
        <Pressable
          onPress={() => setShown(null)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color={c.textSubtle} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 50 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
});
