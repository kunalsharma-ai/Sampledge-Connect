import { Ionicons } from '@expo/vector-icons';
import { MAX_SERIES_OCCURRENCES, MAX_SERIES_YEARS } from '@sampledge/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { addMonthsYmd, repeatSummary, ymdOf, type RepeatDraft } from '../lib/recurrence';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const FREQS: { key: RepeatDraft['frequency']; label: string }[] = [
  { key: 'none', label: 'Does not repeat' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];
/** Monday first, as people read a week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UNIT = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'] };

function longDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The Repeat controls for scheduling or editing a meeting. */
export function RepeatPicker({
  value,
  onChange,
  start,
  timeZone,
}: {
  value: RepeatDraft;
  onChange: (d: RepeatDraft) => void;
  start: Date | null;
  timeZone: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const set = (p: Partial<RepeatDraft>) => onChange({ ...value, ...p });
  const repeating = value.frequency !== 'none';
  const summary = repeatSummary(value, start, timeZone);
  const first = ymdOf(start ?? new Date());
  const lastEnd = addMonthsYmd(first, MAX_SERIES_YEARS * 12);

  const chip = (on: boolean) => [
    styles.chip,
    {
      backgroundColor: on ? c.accent : c.surfaceRaised,
      borderColor: on ? c.accent : c.border,
    },
  ];
  const stepper = (
    label: string,
    onMinus: () => void,
    onPlus: () => void,
    minusOff: boolean,
    plusOff: boolean,
    what: string,
  ) => (
    <View style={[styles.stepper, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}>
      <Pressable
        onPress={onMinus}
        disabled={minusOff}
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${what}`}
        hitSlop={6}
        style={[styles.step, { opacity: minusOff ? 0.35 : 1 }]}
      >
        <Ionicons name="remove" size={18} color={c.accent} />
      </Pressable>
      <Text variant="label" style={{ minWidth: 96, textAlign: 'center' }}>
        {label}
      </Text>
      <Pressable
        onPress={onPlus}
        disabled={plusOff}
        accessibilityRole="button"
        accessibilityLabel={`More ${what}`}
        hitSlop={6}
        style={[styles.step, { opacity: plusOff ? 0.35 : 1 }]}
      >
        <Ionicons name="add" size={18} color={c.accent} />
      </Pressable>
    </View>
  );

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Repeat">
        {FREQS.map((f) => {
          const on = value.frequency === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => set({ frequency: f.key })}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={f.label}
              style={chip(on)}
            >
              <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {repeating ? (
        <>
          <View style={styles.line}>
            <Text variant="label" tone="muted" style={styles.lineLabel}>
              Every
            </Text>
            {stepper(
              `${value.interval} ${UNIT[value.frequency as keyof typeof UNIT][value.interval === 1 ? 0 : 1]}`,
              () => set({ interval: value.interval - 1 }),
              () => set({ interval: value.interval + 1 }),
              value.interval <= 1,
              value.interval >= 30,
              UNIT[value.frequency as keyof typeof UNIT][1]!,
            )}
          </View>

          {value.frequency === 'weekly' ? (
            <View style={styles.line}>
              <Text variant="label" tone="muted" style={styles.lineLabel}>
                On
              </Text>
              <View style={styles.days}>
                {WEEK.map((d) => {
                  const on = value.weekdays.includes(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() =>
                        set({
                          weekdays: on
                            ? value.weekdays.filter((x) => x !== d)
                            : [...value.weekdays, d],
                        })
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
            </View>
          ) : null}

          <View style={styles.line}>
            <Text variant="label" tone="muted" style={styles.lineLabel}>
              Ends
            </Text>
            <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Ends">
              {(
                [
                  ['never', 'Never'],
                  ['after', 'After'],
                  ['on', 'On a date'],
                ] as const
              ).map(([k, label]) => {
                const on = value.ends === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => set({ ends: k })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={k === 'after' ? 'Ends after a number of meetings' : label}
                    style={chip(on)}
                  >
                    <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {value.ends === 'after' ? (
            <View style={[styles.line, { paddingLeft: 52 }]}>
              {stepper(
                `${value.count} meetings`,
                () => set({ count: value.count - 1 }),
                () => set({ count: value.count + 1 }),
                value.count <= 2,
                value.count >= MAX_SERIES_OCCURRENCES,
                'meetings',
              )}
            </View>
          ) : value.ends === 'on' ? (
            <View style={[styles.line, { paddingLeft: 52 }]}>
              {stepper(
                longDate(value.endsOn),
                () => set({ endsOn: addMonthsYmd(value.endsOn, -1) }),
                () => set({ endsOn: addMonthsYmd(value.endsOn, 1) }),
                addMonthsYmd(value.endsOn, -1) < first,
                addMonthsYmd(value.endsOn, 1) > lastEnd,
                'months',
              )}
            </View>
          ) : null}

          {summary ? (
            <View style={[styles.summary, { backgroundColor: alpha(c.accent, 0.1) }]}>
              <Ionicons name="repeat" size={16} color={c.accent} />
              <Text variant="label" tone="accent" style={{ flex: 1 }}>
                {summary}
              </Text>
            </View>
          ) : null}
          {value.ends === 'never' ? (
            <Text variant="meta" tone="subtle">
              Meetings are added about six months ahead, and more as time passes.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, flexShrink: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineLabel: { width: 44 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  step: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  days: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flexShrink: 1 },
  day: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
});
