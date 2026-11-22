import { Ionicons } from '@expo/vector-icons';
import {
  CALL_APPEARANCE_ENHANCE,
  CALL_LOOK_FILTERS,
  DEFAULT_CALL_APPEARANCE,
  isNeutralAppearance,
  type CallAppearance,
} from '@sampledge/contracts';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Slider } from '../../components/Slider';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { useCallBackground } from '../../state/useCallBackground';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type SliderKey = Exclude<keyof CallAppearance, 'filter'>;

const LIGHT: { key: SliderKey; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
];
const TOUCH_UP: { key: SliderKey; label: string }[] = [
  { key: 'lowLight', label: 'Low light' },
  { key: 'sharpness', label: 'Sharpness' },
  { key: 'smoothing', label: 'Skin smoothing' },
];
const FACE: { key: SliderKey; label: string }[] = [
  { key: 'faceSlim', label: 'Slim face' },
  { key: 'eyes', label: 'Bigger eyes' },
  { key: 'nose', label: 'Slim nose' },
];

/** Waits this long after the last change before saving, so dragging sends one change. */
const SAVE_AFTER_MS = 500;

/**
 * How you look on camera: a look (filter), light and colour, touch-up and face shaping. Saved
 * to your account so every device uses it; works offline.
 */
export default function CallAppearanceScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const state = useCallBackground();
  const [draft, setDraft] = useState<CallAppearance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);

  // Follow other devices, except while you are changing it here.
  useEffect(() => {
    if (state && !editing.current) setDraft(state.appearance);
  }, [state]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!draft)
    return (
      <Screen edges={['bottom']}>
        <Text tone="muted" style={{ padding: space.lg }}>
          Loading…
        </Text>
      </Screen>
    );

  const change = (next: CallAppearance) => {
    setDraft(next);
    editing.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      editing.current = false;
      void engine.setCallAppearance(next);
    }, SAVE_AFTER_MS);
  };
  const set = (key: SliderKey, v: number) => change({ ...draft, [key]: v });

  const sliders = (title: string, rows: { key: SliderKey; label: string }[], min: number) => (
    <Glass>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text variant="label" tone="muted">
          {title}
        </Text>
        {rows.map((r) => (
          <View key={r.key} style={{ gap: 4 }}>
            <View style={styles.rowBetween}>
              <Text variant="meta">{r.label}</Text>
              <Text variant="meta" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                {draft[r.key] > 0 && min < 0 ? `+${draft[r.key]}` : draft[r.key]}
              </Text>
            </View>
            <Slider
              value={draft[r.key]}
              min={min}
              max={100}
              step={5}
              centered={min < 0}
              label={r.label}
              valueText={String(draft[r.key])}
              onChange={(v) => set(r.key, v)}
            />
          </View>
        ))}
      </View>
    </Glass>
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text variant="meta" tone="muted">
          Saved to your account, so every device uses it, and a change here reaches a call you are
          in on another device. Works offline.
        </Text>
        <Glass>
          <View style={styles.notice}>
            <Ionicons name="phone-portrait-outline" size={18} color={c.accent} />
            <Text variant="meta" tone="muted" style={{ flex: 1 }}>
              Applied to your camera when you join from a browser or the desktop app. Applying it to
              a phone’s camera is planned.
            </Text>
          </View>
        </Glass>

        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Look
          </Text>
          <Chips
            label="Look"
            options={CALL_LOOK_FILTERS.map((f) => ({ key: f.id, label: f.name }))}
            selected={[draft.filter]}
            onToggle={(filter) => change({ ...draft, filter })}
          />
        </View>

        <View style={styles.actions}>
          <Button
            title="Enhance"
            kind="quiet"
            icon="sparkles-outline"
            onPress={() => change({ ...draft, ...CALL_APPEARANCE_ENHANCE })}
            style={{ flex: 1 }}
          />
          <Button
            title="Reset"
            kind="quiet"
            disabled={isNeutralAppearance(draft)}
            onPress={() => change(DEFAULT_CALL_APPEARANCE)}
            style={{ flex: 1 }}
          />
        </View>

        {sliders('Light and colour', LIGHT, -100)}
        {sliders('Touch-up', TOUCH_UP, 0)}
        {sliders('Face shaping', FACE, 0)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, alignItems: 'flex-start' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: space.sm },
});
