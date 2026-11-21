import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Primary, quiet or destructive action with a busy state. */
export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  busy,
  disabled,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const off = disabled || busy;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.danger : c.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        styles.base,
        kind === 'primary'
          ? { backgroundColor: c.accent }
          : {
              backgroundColor: alpha(kind === 'danger' ? c.danger : c.accent, 0.1),
              borderColor: alpha(kind === 'danger' ? c.danger : c.accent, 0.35),
              borderWidth: StyleSheet.hairlineWidth,
            },
        { opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <Text variant="bodyStrong" style={{ color: fg }}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
});
