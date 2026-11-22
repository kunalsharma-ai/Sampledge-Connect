import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useTranscription } from '../state/useTranscript';
import { alpha, radius } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * "Transcript" under a call recording, voice message or recorded video. Hidden until the
 * organization has its own speech-to-text server.
 */
export function TranscriptButton({
  attachmentId,
  title,
  own = false,
}: {
  attachmentId: string | null;
  title?: string;
  own?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const settings = useTranscription();
  if (!attachmentId || !settings?.configured) return null;
  const fg = own ? c.onAccent : c.textMuted;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/transcript/[attachmentId]',
          params: { attachmentId, ...(title ? { title } : {}) },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={title ? `Transcript of ${title}` : 'Transcript'}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: alpha(own ? c.onAccent : c.text, pressed ? 0.14 : 0.06) },
      ]}
    >
      <Ionicons name="document-text-outline" size={14} color={fg} />
      <Text variant="meta" style={{ color: fg }}>
        Transcript
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
