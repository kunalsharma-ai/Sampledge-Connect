import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Connectivity } from '../state/engine';
import { useApp } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const COPY: Record<Connectivity, { label: string; detail: string }> = {
  online: { label: 'Connected', detail: 'Live' },
  connecting: { label: 'Reconnecting', detail: 'Messages still send over HTTPS' },
  offline: {
    label: 'Offline',
    detail: 'Showing saved conversations. New messages are queued on this device.',
  },
  sessionExpired: {
    label: 'Signed out by the server',
    detail: 'Sign in again to send queued messages.',
  },
  noServer: {
    label: 'Demo workspace',
    detail: 'No server connected. Messages you send stay queued on this device.',
  },
};

/** Pulsing dot used in headers. */
export function ConnectivityDot() {
  const { theme, reducedMotion } = useTheme();
  const state = useApp().engineState?.connectivity ?? 'offline';
  const color =
    state === 'online'
      ? theme.colors.success
      : state === 'connecting'
        ? theme.colors.warning
        : state === 'noServer'
          ? theme.colors.accentSecondary
          : theme.colors.danger;
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value =
      reducedMotion || state === 'online'
        ? 1
        : withRepeat(
            withSequence(withTiming(1.6, { duration: 600 }), withTiming(1, { duration: 600 })),
            -1,
          );
  }, [state, reducedMotion, scale]);
  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 2 - scale.value,
  }));
  return (
    <View style={styles.dotWrap} accessibilityLabel={COPY[state].label}>
      <Animated.View style={[styles.halo, { backgroundColor: alpha(color, 0.35) }, halo]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

/** Explicit banner whenever the app is not fully live, with the number of queued messages. */
export function ConnectivityBanner() {
  const { theme } = useTheme();
  const s = useApp().engineState;
  if (!s || s.connectivity === 'online') return null;
  const copy = COPY[s.connectivity];
  const tint =
    s.connectivity === 'connecting'
      ? theme.colors.warning
      : s.connectivity === 'noServer'
        ? theme.colors.accentSecondary
        : theme.colors.danger;
  const icon: keyof typeof Ionicons.glyphMap =
    s.connectivity === 'offline'
      ? 'cloud-offline-outline'
      : s.connectivity === 'connecting'
        ? 'sync-outline'
        : s.connectivity === 'noServer'
          ? 'flask-outline'
          : 'key-outline';
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(150)}>
      <Pressable
        disabled={s.connectivity !== 'sessionExpired'}
        onPress={() => router.push('/sign-in')}
        style={[
          styles.banner,
          { backgroundColor: alpha(tint, 0.12), borderColor: alpha(tint, 0.35) },
        ]}
        accessibilityRole={s.connectivity === 'sessionExpired' ? 'button' : 'summary'}
      >
        <Ionicons name={icon} size={18} color={tint} />
        <View style={{ flex: 1 }}>
          <Text variant="label">
            {copy.label}
            {s.pending > 0 ? ` · ${s.pending} queued` : ''}
          </Text>
          <Text variant="meta" tone="muted">
            {copy.detail}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  halo: { position: 'absolute', width: 14, height: 14, borderRadius: 7 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
