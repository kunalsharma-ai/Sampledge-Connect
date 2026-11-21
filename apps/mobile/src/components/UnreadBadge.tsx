import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { fonts } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Animated unread counter. Re-keys on the count so each change pops in. */
export function UnreadBadge({ count }: { count: number }) {
  const { theme, reducedMotion } = useTheme();
  if (count <= 0) return null;
  return (
    <Animated.View
      key={count}
      entering={reducedMotion ? undefined : ZoomIn.duration(180)}
      exiting={reducedMotion ? undefined : ZoomOut.duration(120)}
      style={[styles.badge, { backgroundColor: theme.colors.accent }]}
      accessibilityLabel={`${count} unread`}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: theme.colors.onAccent }}>
        {count > 99 ? '99+' : count}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
