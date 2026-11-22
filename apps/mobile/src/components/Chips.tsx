import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** A row of pill choices. `multi` makes each pill a checkbox instead of one radio group. */
export function Chips<K extends string>({
  options,
  selected,
  onToggle,
  multi = false,
  label,
}: {
  options: { key: K; label: string }[];
  selected: readonly K[];
  onToggle: (key: K) => void;
  multi?: boolean;
  /** Read out for the group. */
  label: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View
      style={styles.chips}
      accessibilityRole={multi ? undefined : 'radiogroup'}
      accessibilityLabel={label}
    >
      {options.map((x) => {
        const on = selected.includes(x.key);
        return (
          <Pressable
            key={x.key}
            onPress={() => onToggle(x.key)}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on }}
            aria-checked={on}
            style={[
              styles.chip,
              {
                backgroundColor: on ? c.accent : alpha(c.text, 0.06),
                borderColor: on ? c.accent : c.border,
              },
            ]}
          >
            {multi && on ? <Ionicons name="checkmark" size={14} color={c.onAccent} /> : null}
            <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
              {x.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
