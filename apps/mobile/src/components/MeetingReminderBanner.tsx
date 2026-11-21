import { Ionicons } from '@expo/vector-icons';
import type { MeetingReminderEvent } from '@sampledge/contracts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clock } from '../lib/time';
import { useWorkspace } from '../state/AppProvider';
import { useCalls } from '../state/hooks';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { useJoinMeeting } from './MeetingBits';
import { Text } from './Text';

const SHOW_MS = 30_000;

/** "Starts in 10 min" alert from the server's reminder, with Join. Stays up for 30 seconds. */
export function MeetingReminderBanner() {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { engine, store } = useWorkspace();
  const calls = useCalls();
  const join = useJoinMeeting();
  const [shown, setShown] = useState<MeetingReminderEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      engine.events.on('meetingReminder', (e) => {
        setShown(e);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setShown(null), SHOW_MS);
      }),
    [engine],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!shown) return null;
  const { meeting: m, minutesBefore } = shown;
  const when = minutesBefore <= 0 ? 'Starting now' : `Starts in ${minutesBefore} min`;
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
          router.push({ pathname: '/meeting/[id]', params: { id: m.meetingId } });
        }}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${m.title}. ${when}, at ${clock(m.startsAt)}`}
        style={[
          styles.card,
          { backgroundColor: c.surfaceRaised, borderColor: alpha(c.accent, 0.5) },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.16) }]}>
          <Ionicons name="calendar" size={18} color={c.accent} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="label" numberOfLines={1}>
            {m.title}
          </Text>
          <Text variant="meta" tone="muted">
            {when} · {clock(m.startsAt)}
          </Text>
        </View>
        {calls.config?.enabled ? (
          <Pressable
            onPress={() => {
              setShown(null);
              void store.getMeeting(m.meetingId).then((lm) => lm && join(lm));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Join ${m.title}`}
            style={[styles.join, { backgroundColor: c.accent }]}
          >
            <Text variant="label" tone="onAccent">
              Join
            </Text>
          </Pressable>
        ) : null}
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
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 51 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  join: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
});
