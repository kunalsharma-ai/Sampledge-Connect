import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ActionKind } from '../db/work';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const SHOW_MS = 8_000;

const WHAT: Record<ActionKind, string> = {
  pin: 'Pin change',
  bookmark: 'Saved messages change',
  'poll.create': 'Poll',
  'poll.vote': 'Vote',
  'poll.close': 'Closing the poll',
  'poll.edit': 'Poll change',
  'conversation.update': 'Name or description change',
  'approval.update': 'Approval request change',
  'task.create': 'New task',
  'task.update': 'Task change',
  'approval.create': 'Approval request',
  'approval.decide': 'Decision',
  'approval.cancel': 'Cancelling the approval',
  'scheduled.create': 'Scheduled message',
  'scheduled.update': 'New send time',
  'scheduled.cancel': 'Deleting the scheduled message',
  'scheduled.sendNow': 'Send now',
  'booking.create': 'New booking page',
  'booking.update': 'Booking page change',
  'booking.delete': 'Deleting the booking page',
  'profile.update': 'Profile change',
  'avatar.set': 'New profile photo',
  'avatar.remove': 'Removing your photo',
  'search.recent': 'Saving your recent searches',
  'status.set': 'Changing your status',
  'dnd.set': 'Changing your quiet hours',
  'hours.set': 'Saving your working hours',
  'theme.set': 'Changing your chat theme',
  'callbg.set': 'Changing your call background',
  'callbg.image': 'Uploading your call background',
  'callbg.imageRemove': 'Removing your call background',
  'callbg.appearance': 'Saving how you look on camera',
  'minutes.update': 'Saving the minutes',
  'transcript.update': 'Correcting the transcript',
  'net.act': 'SampConnect Network change',
  'support.act': 'Help question',
  'inbox.reply': 'Reply to client',
  'inbox.note': 'Internal note',
  'inbox.update': 'Inbox conversation change',
  'inbox.read': 'Marking the conversation read',
  'inbox.settings': 'Saving inbox settings',
};

/**
 * A change made offline that the server refused once it reached it (for example the poll was
 * already closed, or someone else decided first). The server's state is shown again.
 */
export function ActionRefusedBanner() {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { engine } = useWorkspace();
  const [shown, setShown] = useState<{ kind: ActionKind; reason: string; label?: string } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      engine.events.on('actionRefused', (e) => {
        setShown(e);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setShown(null), SHOW_MS);
      }),
    [engine],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!shown) return null;
  const create = shown.kind.endsWith('.create');
  const text = `${shown.label ?? WHAT[shown.kind]} not ${create || shown.label ? 'sent' : 'applied'}: ${shown.reason}`;
  return (
    <Animated.View
      entering={motion.base ? FadeInUp.duration(motion.base) : undefined}
      exiting={motion.base ? FadeOutUp.duration(motion.fast || motion.base) : undefined}
      style={[styles.wrap, { top: insets.top + space.sm }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => setShown(null)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={text}
        style={[
          styles.card,
          { backgroundColor: c.surfaceRaised, borderColor: alpha(c.danger, 0.5) },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: alpha(c.danger, 0.14) }]}>
          <Ionicons name="alert-circle" size={20} color={c.danger} />
        </View>
        <Text variant="label" style={{ flex: 1 }}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 52 },
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
});
