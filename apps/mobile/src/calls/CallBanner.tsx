import { Ionicons } from '@expo/vector-icons';
import type { Call, CallMedia } from '@sampledge/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Text } from '../components/Text';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Above the messages: a live call you can join (or return to), or why a call did not start. */
export function CallBanner({
  call,
  inCall,
  error,
  nameOf,
  onJoin,
  onReturn,
  onDismissError,
}: {
  call: Call | null;
  inCall: boolean;
  error: string | null;
  nameOf: (id: string) => string;
  onJoin: (media: CallMedia) => void;
  onReturn: () => void;
  onDismissError: () => void;
}) {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  if (error)
    return (
      <View
        style={[
          styles.bar,
          { backgroundColor: alpha(c.danger, 0.12), borderColor: alpha(c.danger, 0.3) },
        ]}
      >
        <Ionicons name="alert-circle-outline" size={18} color={c.danger} />
        <Text variant="meta" style={{ flex: 1 }}>
          {error}
        </Text>
        <Pressable
          onPress={onDismissError}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color={c.textSubtle} />
        </Pressable>
      </View>
    );
  if (!call && !inCall) return null;
  if (inCall)
    return (
      <Pressable
        onPress={onReturn}
        accessibilityRole="button"
        style={[styles.bar, { backgroundColor: c.success, borderColor: c.success }]}
      >
        <Ionicons name="call" size={18} color="#FFFFFF" />
        <Text variant="label" style={{ flex: 1, color: '#FFFFFF' }}>
          You are in this call. Tap to return.
        </Text>
      </Pressable>
    );
  const joined = call!.participants.filter((p) => p.state === 'joined');
  const video = call!.media === 'video';
  return (
    <Animated.View
      entering={motion.base ? FadeInUp.duration(motion.base) : undefined}
      style={[
        styles.bar,
        { backgroundColor: alpha(c.success, 0.12), borderColor: alpha(c.success, 0.35) },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={video ? 'videocam' : 'call'} size={18} color={c.success} />
      <View style={{ flex: 1 }}>
        <Text variant="label">{video ? 'Video call' : 'Voice call'} in progress</Text>
        <Text variant="meta" tone="muted" numberOfLines={1}>
          {joined.length
            ? joined.map((p) => nameOf(p.userId)).join(', ')
            : `Started by ${nameOf(call!.startedBy)}`}
        </Text>
      </View>
      <Pressable
        onPress={() => onJoin(call!.media)}
        accessibilityRole="button"
        accessibilityLabel={`Join ${video ? 'video' : 'voice'} call`}
        style={({ pressed }) => [
          styles.join,
          { backgroundColor: c.success, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text variant="label" style={{ color: '#FFFFFF' }}>
          Join
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  join: { paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill },
});
