import { Ionicons } from '@expo/vector-icons';
import type { WorkingHours } from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { deviceTimeZone, zoneLabel } from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type Day = { on: boolean; start: string; end: string };

/** When people can book you: "find a time" only suggests slots inside everyone's hours. */
export default function WorkingHoursScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  useApp();
  const [days, setDays] = useState<Record<number, Day> | null>(null);
  const [zone, setZone] = useState(deviceTimeZone());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = engine.serverActionBlocker();
  const phoneZone = deviceTimeZone();

  useEffect(() => {
    if (blocked) return;
    void engine
      .getWorkingHours()
      .then((h) => {
        setZone(h.timeZone);
        const map: Record<number, Day> = {};
        for (let d = 0; d < 7; d++) {
          const x = h.days.find((y) => y.day === d);
          map[d] = x
            ? { on: true, start: x.start, end: x.end }
            : { on: false, start: '09:00', end: '17:30' };
        }
        setDays(map);
      })
      .catch((e: unknown) =>
        setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }),
      );
  }, [engine, blocked]);

  const patch = (d: number, p: Partial<Day>) => {
    setNote(null);
    setDays((cur) => (cur ? { ...cur, [d]: { ...cur[d]!, ...p } } : cur));
  };
  const step = (d: number, key: 'start' | 'end', delta: number) => {
    const x = days![d]!;
    const next = Math.min(23 * 60 + 30, Math.max(0, toMin(x[key]) + delta));
    if (key === 'start' && next >= toMin(x.end)) return;
    if (key === 'end' && next <= toMin(x.start)) return;
    patch(d, { [key]: toHHMM(next) });
  };

  const save = async () => {
    if (!days) return;
    const body: WorkingHours = {
      timeZone: zone,
      days: ORDER.filter((d) => days[d]!.on).map((d) => ({
        day: d,
        start: days[d]!.start,
        end: days[d]!.end,
      })),
    };
    setBusy(true);
    try {
      await engine.setWorkingHours(body);
      setNote({ ok: true, text: 'Saved. Suggested meeting times now follow these hours.' });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const stepper = (d: number, key: 'start' | 'end') => (
    <View style={[styles.stepper, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}>
      <Pressable
        onPress={() => step(d, key, -30)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${DAY_NAMES[d]} ${key} earlier`}
      >
        <Ionicons name="remove" size={16} color={c.accent} />
      </Pressable>
      <Text variant="label" style={{ minWidth: 44, textAlign: 'center' }}>
        {days![d]![key]}
      </Text>
      <Pressable
        onPress={() => step(d, key, 30)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${DAY_NAMES[d]} ${key} later`}
      >
        <Ionicons name="add" size={16} color={c.accent} />
      </Pressable>
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Working hours' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text tone="muted">
          When you are available for meetings. Suggested times only use hours where everyone invited
          is working and free.
        </Text>
        {blocked ? (
          <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
            <Text variant="meta" style={{ color: c.warning }}>
              {blocked} Working hours are kept on the server.
            </Text>
          </View>
        ) : null}
        {days ? (
          <>
            <Glass>
              <View style={styles.row}>
                <Ionicons name="globe-outline" size={20} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">Time zone</Text>
                  <Text variant="meta" tone="muted">
                    {zone} ({zoneLabel(zone)})
                  </Text>
                </View>
                {zone !== phoneZone ? (
                  <Button
                    title="Use this phone’s"
                    kind="quiet"
                    onPress={() => setZone(phoneZone)}
                    style={{ paddingVertical: 6, paddingHorizontal: space.md }}
                  />
                ) : null}
              </View>
            </Glass>
            <Glass>
              {ORDER.map((d, i) => {
                const x = days[d]!;
                return (
                  <View
                    key={d}
                    style={[
                      styles.row,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: c.border,
                      },
                    ]}
                  >
                    <Switch
                      value={x.on}
                      onValueChange={(on) => patch(d, { on })}
                      accessibilityLabel={`Working on ${DAY_NAMES[d]}`}
                      trackColor={{ true: c.accent, false: c.border }}
                    />
                    <Text variant="bodyStrong" style={{ width: 44 }}>
                      {DAY_NAMES[d]!.slice(0, 3)}
                    </Text>
                    {x.on ? (
                      <View style={styles.times}>
                        {stepper(d, 'start')}
                        <Text tone="subtle">–</Text>
                        {stepper(d, 'end')}
                      </View>
                    ) : (
                      <Text tone="subtle" style={{ flex: 1 }}>
                        Not working
                      </Text>
                    )}
                  </View>
                );
              })}
            </Glass>
            {note ? (
              <Text
                variant="meta"
                tone={note.ok ? 'muted' : 'danger'}
                accessibilityLiveRegion="polite"
              >
                {note.text}
              </Text>
            ) : null}
            <Button
              title="Save working hours"
              onPress={() => void save()}
              busy={busy}
              disabled={!!blocked}
            />
          </>
        ) : note ? (
          <Text tone="danger">{note.text}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  times: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { padding: space.md, borderRadius: radius.md },
});
