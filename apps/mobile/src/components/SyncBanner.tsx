import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { LocalWork } from '../db/work';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

/**
 * On a task, approval or scheduled message: says a change made on this phone is waiting to be
 * sent, or that the server refused something you created, with Try again and Discard.
 */
export function SyncBanner({
  item,
  what,
  onRetry,
  onDiscard,
}: {
  item: LocalWork;
  /** "task", "approval"... */
  what: string;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  if (!item.pending && !item.syncError) return null;
  const failed = !!item.syncError;
  const tint = failed ? c.danger : c.warning;
  return (
    <View
      style={[styles.box, { backgroundColor: alpha(tint, 0.12) }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Ionicons name={failed ? 'alert-circle' : 'cloud-upload-outline'} size={18} color={tint} />
        <Text variant="meta" style={{ color: tint, flex: 1 }}>
          {failed
            ? `This ${what} was not created: ${item.syncError}`
            : item.local
              ? `Saved on this phone. The ${what} is created for everyone when you are back online.`
              : 'Your change is saved on this phone and is sent when you are back online.'}
        </Text>
      </View>
      {failed && (onRetry || onDiscard) ? (
        <View style={styles.row}>
          {onRetry ? (
            <Button title="Try again" kind="quiet" icon="refresh" onPress={onRetry} />
          ) : null}
          {onDiscard ? (
            <Button title="Discard" kind="danger" icon="trash-outline" onPress={onDiscard} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
