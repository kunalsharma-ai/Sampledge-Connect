import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { alpha } from '../theme/themes';
import { radius } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Frosted, layered surface. Android falls back to a translucent fill (blur there is costly on long lists). */
export function Glass({
  children,
  style,
  intensity = 40,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  const { theme } = useTheme();
  const fill = alpha(theme.colors.surface, theme.dark ? 0.72 : 0.82);
  const shadow = theme.dark ? styles.shadowDark : styles.shadowLight;
  return (
    <View style={[styles.base, shadow, { borderColor: theme.colors.border }, style]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={intensity}
          tint={theme.dark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  shadowDark: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  shadowLight: {
    shadowColor: '#1E293B',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
});
