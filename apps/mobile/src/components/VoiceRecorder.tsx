import { Ionicons } from '@expo/vector-icons';
import { formatClipDuration, MAX_CLIP_DURATION_MS } from '@sampledge/contracts';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { PendingFileInput } from '../db/store';
import { keepPickedFile, localFileSize } from '../lib/localFiles';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Voice is mono AAC (m4a) on phones and Opus in WebM in the browser preview. */
const VOICE: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  web: { mimeType: 'audio/webm', bitsPerSecond: 64_000 },
};
const MIME = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
const EXT = Platform.OS === 'web' ? 'webm' : 'm4a';
/** Shorter than this is almost always a mis-tap, so it is dropped. */
const MIN_MS = 700;

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

/**
 * Records a voice message. The finished file is copied into app storage and handed back
 * as a pending attachment, so sending it goes through the same durable outbox as any file
 * and works offline.
 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(VOICE);
  const state = useAudioRecorderState(recorder, 200);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const start = async (): Promise<boolean> => {
    if (busy.current || active) return false;
    busy.current = true;
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Allow microphone access to record voice messages.');
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_CLIP_DURATION_MS / 1000 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setActive(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? `Could not start recording: ${e.message}` : 'Could not record');
      return false;
    } finally {
      busy.current = false;
    }
  };

  /** Stops; returns the clip to send, or null when cancelled or too short. */
  const finish = async (keep: boolean): Promise<PendingFileInput | null> => {
    if (!active || busy.current) return null;
    busy.current = true;
    const durationMs = Math.min(
      MAX_CLIP_DURATION_MS,
      Math.round(recorder.getStatus().durationMillis || state.durationMillis),
    );
    try {
      await recorder.stop();
    } catch {
      // already stopped (the 30 minute limit)
    }
    setActive(false);
    busy.current = false;
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    const uri = recorder.uri;
    if (!keep || !uri) return null;
    if (durationMs < MIN_MS) {
      setError('Hold on a little longer to record a voice message.');
      return null;
    }
    const fileName = `Voice message ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.${EXT}`;
    const localUri = await keepPickedFile(uri, fileName);
    return {
      localUri,
      fileName,
      mimeType: MIME,
      sizeBytes: await localFileSize(localUri),
      width: null,
      height: null,
      recording: 'voice',
      durationMs,
    };
  };

  return {
    active,
    error,
    clearError: () => setError(null),
    elapsedMs: active ? state.durationMillis : 0,
    start,
    finish,
  };
}

/** Replaces the text field while recording: red dot, elapsed time, cancel and send. */
export function VoiceRecordBar({
  voice,
  onSend,
}: {
  voice: VoiceRecorder;
  onSend: (clip: PendingFileInput) => void;
}) {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!motion.fast) return;
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [motion.fast, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const left = MAX_CLIP_DURATION_MS - voice.elapsedMs;

  return (
    <View
      style={[styles.bar, { backgroundColor: c.surfaceRaised, borderColor: alpha(c.danger, 0.5) }]}
      accessibilityLabel={`Recording voice message, ${formatClipDuration(voice.elapsedMs)}`}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={() => void voice.finish(false)}
        accessibilityRole="button"
        accessibilityLabel="Discard voice message"
        hitSlop={8}
        style={styles.round}
      >
        <Ionicons name="trash-outline" size={20} color={c.danger} />
      </Pressable>
      <Animated.View style={[styles.dot, { backgroundColor: c.danger }, dot]} />
      <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
        {formatClipDuration(voice.elapsedMs)}
      </Text>
      <Text variant="meta" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
        {left < 60_000 ? `${Math.ceil(left / 1000)} s left` : 'Recording…'}
      </Text>
      <Pressable
        onPress={async () => {
          const clip = await voice.finish(true);
          if (clip) onSend(clip);
        }}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        style={[styles.send, { backgroundColor: c.accent }]}
      >
        <Ionicons name="arrow-up" size={18} color={c.onAccent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingLeft: 4,
    paddingRight: 5,
    paddingVertical: 5,
  },
  round: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
