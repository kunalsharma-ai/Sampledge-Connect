import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { alpha, radius } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A simple slider: tap or drag along the track. Screen readers get "adjustable" with increase
 * and decrease actions moving by `step`.
 */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueText,
  centered = false,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  valueText: string;
  /** Fill from the middle (for -1 to 1 values). */
  centered?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [w, setW] = useState(0);
  const last = useRef(value);
  const frac = (value - min) / (max - min);
  const snap = (v: number) =>
    Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const at = (e: GestureResponderEvent) => {
    if (!w) return;
    const v = snap(min + (e.nativeEvent.locationX / w) * (max - min));
    if (v !== last.current) {
      last.current = v;
      onChange(Math.round(v * 1000) / 1000);
    }
  };
  const mid = centered ? (0 - min) / (max - min) : 0;
  const lo = Math.min(mid, frac);
  const hi = Math.max(mid, frac);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      aria-valuetext={valueText}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))
      }
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={at}
      onResponderMove={at}
      style={styles.hit}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: alpha(c.text, 0.15) }]}>
        <View
          style={[
            styles.fill,
            { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, backgroundColor: c.accent },
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { left: `${frac * 100}%`, backgroundColor: c.onAccent, borderColor: c.accent },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0 },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    borderWidth: 3,
  },
});
