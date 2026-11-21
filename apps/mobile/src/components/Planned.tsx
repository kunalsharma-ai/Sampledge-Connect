import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Glass } from './Glass';
import { Text } from './Text';

/** Honest placeholder for a module that is not built yet. No sample data is shown. */
export function Planned({
  title,
  summary,
  icon,
}: {
  title: string;
  summary: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.wrap}>
      <Glass style={styles.card}>
        <View style={[styles.icon, { backgroundColor: alpha(theme.colors.accent, 0.14) }]}>
          <Ionicons name={icon} size={26} color={theme.colors.accent} />
        </View>
        <Text variant="title" style={{ textAlign: 'center' }}>
          {title}
        </Text>
        <View style={[styles.pill, { borderColor: alpha(theme.colors.accentSecondary, 0.5) }]}>
          <Text variant="overline" style={{ color: theme.colors.accentSecondary }}>
            Planned
          </Text>
        </View>
        <Text tone="muted" style={{ textAlign: 'center' }}>
          {summary}
        </Text>
        <Text variant="meta" tone="subtle" style={{ textAlign: 'center' }}>
          Not available in this build of the mobile app yet.
        </Text>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: space.xl },
  card: { alignItems: 'center', gap: space.md, padding: space.xl, borderRadius: radius.xl },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
});
