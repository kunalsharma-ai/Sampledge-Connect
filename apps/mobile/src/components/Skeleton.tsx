import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

function Bar({ width, height = 12 }: { width: number | `${number}%`; height?: number }) {
  const { theme, reducedMotion } = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => {
    if (!reducedMotion) o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [o, reducedMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: height / 2, backgroundColor: theme.colors.surfaceRaised },
        style,
      ]}
    />
  );
}

export function ConversationSkeleton() {
  return (
    <View style={{ gap: 18, padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <Bar width={44} height={44} />
          <View style={{ flex: 1, gap: 8 }}>
            <Bar width="45%" />
            <Bar width="80%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12 } });
