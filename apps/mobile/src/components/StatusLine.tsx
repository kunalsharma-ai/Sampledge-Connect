import { Ionicons } from '@expo/vector-icons';
import { dndActive, type DndSchedule, type UserStatus } from '@sampledge/contracts';
import { StyleSheet, View } from 'react-native';
import { availabilityTone, statusLine } from '../lib/status';
import { useNow } from '../state/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * Someone's availability dot and status message ("Busy · 📅 In a meeting · until 3:30 PM"),
 * plus a note while their notifications are paused. Renders nothing when nothing is set.
 */
export function StatusLine({
  status,
  schedule,
  center,
  fallback,
}: {
  status: UserStatus | null | undefined;
  schedule: DndSchedule | null | undefined;
  center?: boolean;
  /** Shown when no status is set (for example "Set a status"). */
  fallback?: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const now = new Date(useNow());
  const line = statusLine(status, now);
  const quiet = dndActive(status, schedule, now);
  if (!line && !quiet && !fallback) return null;
  const tone = availabilityTone(status, schedule, now);
  const dot = tone === 'busy' ? c.danger : tone === 'away' ? c.warning : c.success;
  return (
    <View style={[styles.wrap, center && { justifyContent: 'center' }]}>
      {line || quiet ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text
        variant="meta"
        tone={line ? 'default' : 'muted'}
        numberOfLines={2}
        style={center ? { textAlign: 'center' } : { flexShrink: 1 }}
      >
        {line ?? (quiet ? '' : fallback)}
      </Text>
      {quiet ? (
        <View style={styles.wrap} accessibilityLabel="Notifications paused">
          <Ionicons name="notifications-off-outline" size={13} color={c.textMuted} />
          <Text variant="meta" tone="muted">
            Notifications paused
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
