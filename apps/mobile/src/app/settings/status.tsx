import { Ionicons } from '@expo/vector-icons';
import {
  AVAILABILITIES,
  DEFAULT_DND_SCHEDULE,
  effectiveStatus,
  inDndSchedule,
  type Availability,
  type DndSchedule,
} from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  AVAILABILITY_LABEL,
  CLEAR_AFTER,
  CLEARED,
  STATUS_PRESETS,
  clockLabel,
  expiryFor,
  shiftTime,
  statusLine,
  type ClearAfter,
} from '../../lib/status';
import { deviceTimeZone } from '../../lib/time';
import { useWorkspace } from '../../state/AppProvider';
import { useProfile } from '../../state/hooks';
import { alpha, fonts, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const AVAIL_ICON: Record<Availability, keyof typeof Ionicons.glyphMap> = {
  auto: 'radio-button-on-outline',
  busy: 'remove-circle-outline',
  away: 'moon-outline',
  dnd: 'notifications-off-outline',
};
const AVAIL_HINT: Record<Availability, string> = {
  auto: 'Shows when you are active',
  busy: 'Others see you are busy',
  away: 'Others see you are away',
  dnd: 'No push notifications. Messages still arrive in the app.',
};

/**
 * Your availability, a status message that can clear itself, and recurring quiet hours. Every
 * change shows at once, works offline, and reaches your other devices and your teammates.
 */
export default function StatusScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const me = useProfile(selfId);
  const now = new Date();
  const current = effectiveStatus(me?.userStatus, now);
  const savedSchedule: DndSchedule = me?.dndSchedule ?? {
    ...DEFAULT_DND_SCHEDULE,
    timeZone: me?.timeZone ?? deviceTimeZone(),
  };

  const [availability, setAvailability] = useState<Availability>('auto');
  const [emoji, setEmoji] = useState('');
  const [text, setText] = useState('');
  const [clear, setClear] = useState<ClearAfter | 'keep'>('keep');
  const [schedule, setSchedule] = useState<DndSchedule>(savedSchedule);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (loaded || !me) return;
    setAvailability(current.availability);
    setEmoji(current.emoji ?? '');
    setText(current.text ?? '');
    setSchedule(savedSchedule);
    setLoaded(true);
  }, [me, loaded, current, savedSchedule]);

  const scheduleChanged = useMemo(
    () => JSON.stringify(schedule) !== JSON.stringify(savedSchedule),
    [schedule, savedSchedule],
  );
  const statusChanged =
    availability !== current.availability ||
    (emoji.trim() || null) !== current.emoji ||
    (text.trim() || null) !== current.text ||
    clear !== 'keep';
  const quietNow = inDndSchedule(schedule, now);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (statusChanged)
        await engine.setStatus({
          availability,
          emoji: emoji.trim() || null,
          text: text.trim() || null,
          expiresAt: clear === 'keep' ? current.expiresAt : expiryFor(clear, new Date()),
        });
      if (scheduleChanged) await engine.setDndSchedule(schedule);
      router.back();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await engine.setStatus(CLEARED);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) => [
    styles.chip,
    {
      backgroundColor: on ? c.accent : c.surfaceRaised,
      borderColor: on ? c.accent : c.border,
    },
  ];
  const stepTime = (key: 'start' | 'end', label: string) => (
    <View style={styles.timeRow}>
      <Text variant="label" tone="muted" style={{ width: 48 }}>
        {label}
      </Text>
      <View style={[styles.stepper, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}>
        <Pressable
          onPress={() => setSchedule((s) => ({ ...s, [key]: shiftTime(s[key], -30) }))}
          accessibilityRole="button"
          accessibilityLabel={`${label} earlier`}
          hitSlop={6}
          style={styles.step}
        >
          <Ionicons name="remove" size={18} color={c.accent} />
        </Pressable>
        <Text variant="label" style={{ minWidth: 84, textAlign: 'center' }}>
          {clockLabel(schedule[key])}
        </Text>
        <Pressable
          onPress={() => setSchedule((s) => ({ ...s, [key]: shiftTime(s[key], 30) }))}
          accessibilityRole="button"
          accessibilityLabel={`${label} later`}
          hitSlop={6}
          style={styles.step}
        >
          <Ionicons name="add" size={18} color={c.accent} />
        </Pressable>
      </View>
    </View>
  );

  const preview = statusLine(
    {
      availability,
      emoji: emoji.trim() || null,
      text: text.trim() || null,
      expiresAt: clear === 'keep' ? current.expiresAt : expiryFor(clear, now),
    },
    now,
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Status' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}>
        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle">
            Availability
          </Text>
          <Glass>
            {AVAILABILITIES.map((a, i) => {
              const on = availability === a;
              return (
                <Pressable
                  key={a}
                  onPress={() => setAvailability(a)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  accessibilityLabel={AVAILABILITY_LABEL[a]}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <Ionicons name={AVAIL_ICON[a]} size={20} color={c.accent} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{AVAILABILITY_LABEL[a]}</Text>
                    <Text variant="meta" tone="muted">
                      {AVAIL_HINT[a]}
                    </Text>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? c.accent : c.textSubtle}
                  />
                </Pressable>
              );
            })}
          </Glass>
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle">
            Status message
          </Text>
          <Glass style={{ padding: space.md, gap: space.md }}>
            <View style={styles.inputRow}>
              <TextInput
                value={emoji}
                onChangeText={(v) => setEmoji(v.slice(0, 8))}
                placeholder="🙂"
                placeholderTextColor={c.textSubtle}
                accessibilityLabel="Status emoji"
                style={[
                  styles.emoji,
                  { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
                ]}
              />
              <TextInput
                value={text}
                onChangeText={(v) => setText(v.slice(0, 100))}
                placeholder="What's your status?"
                placeholderTextColor={c.textSubtle}
                accessibilityLabel="Status message"
                style={[
                  styles.text,
                  { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
                ]}
              />
            </View>
            <View style={styles.wrap}>
              {STATUS_PRESETS.map((p) => (
                <Pressable
                  key={p.text}
                  onPress={() => {
                    setEmoji(p.emoji);
                    setText(p.text);
                    setClear(p.clear);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${p.text}`}
                  style={chip(text === p.text)}
                >
                  <Text variant="label" tone={text === p.text ? 'onAccent' : 'default'}>
                    {p.emoji} {p.text}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="label" tone="muted">
              Clear after
            </Text>
            <View style={styles.wrap} accessibilityRole="radiogroup">
              {CLEAR_AFTER.map((o) => {
                const on =
                  clear === o.key || (clear === 'keep' && !current.expiresAt && o.key === 'never');
                return (
                  <Pressable
                    key={o.key}
                    onPress={() => setClear(o.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={`Clear after ${o.label}`}
                    style={chip(on)}
                  >
                    <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {preview ? (
              <View style={[styles.preview, { backgroundColor: alpha(c.accent, 0.1) }]}>
                <Ionicons name="eye-outline" size={15} color={c.accent} />
                <Text variant="label" tone="accent" style={{ flex: 1 }}>
                  {preview}
                </Text>
              </View>
            ) : null}
          </Glass>
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle">
            Quiet hours
          </Text>
          <Glass style={{ padding: space.md, gap: space.md }}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Pause notifications on a schedule</Text>
                <Text variant="meta" tone="muted">
                  No push notifications during these hours. Everything still arrives in the app.
                </Text>
              </View>
              <Switch
                value={schedule.enabled}
                onValueChange={(on) => setSchedule((s) => ({ ...s, enabled: on }))}
                accessibilityLabel="Quiet hours"
              />
            </View>
            {schedule.enabled ? (
              <>
                <View style={styles.days}>
                  {WEEK.map((d) => {
                    const on = schedule.days.includes(d);
                    return (
                      <Pressable
                        key={d}
                        onPress={() =>
                          setSchedule((s) => ({
                            ...s,
                            days: on ? s.days.filter((x) => x !== d) : [...s.days, d].sort(),
                          }))
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        aria-checked={on}
                        accessibilityLabel={DAY[d]}
                        style={[
                          styles.day,
                          {
                            backgroundColor: on ? c.accent : c.surfaceRaised,
                            borderColor: on ? c.accent : c.border,
                          },
                        ]}
                      >
                        <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                          {DAY[d]!.slice(0, 1)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {stepTime('start', 'From')}
                {stepTime('end', 'To')}
                <Text variant="meta" tone="subtle">
                  {schedule.end < schedule.start ? 'Runs past midnight. ' : ''}Times are in{' '}
                  {schedule.timeZone}.{quietNow ? ' Quiet hours are on now.' : ''}
                </Text>
              </>
            ) : null}
          </Glass>
        </View>

        {note ? (
          <Text variant="meta" tone="danger">
            {note}
          </Text>
        ) : null}
        <Button
          title="Save"
          icon="checkmark"
          onPress={() => void save()}
          busy={busy}
          disabled={busy || (!statusChanged && !scheduleChanged)}
        />
        {statusLine(me?.userStatus, now) ? (
          <Button
            title="Clear status"
            kind="quiet"
            onPress={() => void clearAll()}
            disabled={busy}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  inputRow: { flexDirection: 'row', gap: space.sm },
  emoji: {
    width: 52,
    textAlign: 'center',
    fontSize: 20,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  days: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  day: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  step: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
