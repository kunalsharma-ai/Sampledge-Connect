import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  combineDayTime,
  formatSendAt,
  SCHEDULE_TIMES,
  scheduleDays,
  schedulePresets,
  scheduleProblem,
} from '../lib/schedule';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

/** Bottom sheet to pick when a message sends: quick choices, or a day and a time. */
export function ScheduleSheet({
  visible,
  title = 'Send later',
  busy,
  error,
  onPick,
  onClose,
}: {
  visible: boolean;
  title?: string;
  busy?: boolean;
  error?: string | null;
  onPick: (at: Date) => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const [custom, setCustom] = useState(false);
  const [day, setDay] = useState('1');
  const [minutes, setMinutes] = useState(9 * 60);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [visible]);
  const presets = useMemo(() => schedulePresets(now), [now]);
  const days = useMemo(() => scheduleDays(now), [now]);
  if (!visible) return null;

  const pick = (at: Date) => {
    const p = scheduleProblem(at, new Date());
    setProblem(p);
    if (!p) onPick(at);
  };
  const chosen = combineDayTime(days.find((d) => d.key === day)!.date, minutes);

  const chip = (on: boolean) => [
    styles.chip,
    { backgroundColor: on ? c.accent : alpha(c.text, 0.06), borderColor: on ? c.accent : c.border },
  ];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View
        style={[styles.backdrop, { backgroundColor: alpha('#000000', theme.dark ? 0.55 : 0.3) }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: c.surfaceRaised,
              borderColor: c.border,
              marginBottom: insets.bottom + space.sm,
            },
          ]}
        >
          <Text variant="heading">{title}</Text>
          <Text variant="meta" tone="muted">
            The server sends it as you at that time, even if this phone is off.
          </Text>
          {!custom ? (
            <View style={[styles.list, { borderColor: c.border }]}>
              {presets.map((p, i) => (
                <Pressable
                  key={p.key}
                  onPress={() => pick(p.at)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.label}, ${formatSendAt(p.at.toISOString(), now)}`}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                    pressed && { backgroundColor: alpha(c.accent, 0.08) },
                  ]}
                >
                  <Ionicons name="time-outline" size={20} color={c.accent} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {p.label}
                  </Text>
                  <Text variant="meta" tone="muted">
                    {formatSendAt(p.at.toISOString(), now)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setCustom(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                  pressed && { backgroundColor: alpha(c.accent, 0.08) },
                ]}
              >
                <Ionicons name="calendar-outline" size={20} color={c.accent} />
                <Text variant="bodyStrong">Pick a day and time</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {days.map((d) => (
                    <Pressable
                      key={d.key}
                      onPress={() => setDay(d.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: d.key === day }}
                      style={chip(d.key === day)}
                    >
                      <Text variant="label" style={{ color: d.key === day ? c.onAccent : c.text }}>
                        {d.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <ScrollView style={{ maxHeight: 150 }}>
                <View style={[styles.chips, { flexWrap: 'wrap' }]} accessibilityRole="radiogroup">
                  {SCHEDULE_TIMES.map((t) => (
                    <Pressable
                      key={t.minutes}
                      onPress={() => setMinutes(t.minutes)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: t.minutes === minutes }}
                      style={chip(t.minutes === minutes)}
                    >
                      <Text
                        variant="label"
                        style={{ color: t.minutes === minutes ? c.onAccent : c.text }}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <Button
                title={`Schedule for ${formatSendAt(chosen.toISOString(), now)}`}
                icon="time-outline"
                busy={busy}
                onPress={() => pick(chosen)}
              />
            </View>
          )}
          {problem || error ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {problem ?? error}
            </Text>
          ) : null}
          <Pressable
            onPress={custom ? () => setCustom(false) : onClose}
            accessibilityRole="button"
            style={[styles.cancel, { backgroundColor: c.surfaceSunken }]}
          >
            <Text variant="bodyStrong" tone="muted">
              {custom ? 'Back' : 'Cancel'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.md },
  sheet: {
    padding: space.md,
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancel: { height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
