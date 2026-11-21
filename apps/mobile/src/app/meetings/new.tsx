import { Ionicons } from '@expo/vector-icons';
import type { FindTimesResponse, GuestInput } from '@sampledge/contracts';
import { checkGuestEmail, INVITE_LABEL } from '../../lib/guests';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { PeoplePicker } from '../../components/PeoplePicker';
import { RepeatPicker } from '../../components/RepeatPicker';
import {
  draftFromRecurrence,
  draftToRecurrence,
  newRepeatDraft,
  repeatProblem,
  sameRecurrence,
  type RepeatDraft,
} from '../../lib/recurrence';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  addDays,
  clock,
  dayKey,
  dayLabel,
  deviceTimeZone,
  minutesBetween,
  startOfDay,
} from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useDirectory, useMeeting } from '../../state/hooks';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const DURATIONS = [15, 30, 45, 60, 90];
const REMINDERS = [0, 5, 10, 15, 30, 60];
const FIRST_HOUR = 7;
const LAST_HOUR = 21;

type Slot = { startsAt: string; endsAt: string };

const overlaps = (a: Slot, b: Slot) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** Next half hour from now. */
function nextHalfHour(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/** Schedule a meeting, or (with ?edit=id) change one you organize. */
export default function ScheduleMeeting() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const people = useDirectory();
  const { meeting: existing } = useMeeting(edit ?? '');
  const editing = !!edit;

  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [guests, setGuests] = useState<GuestInput[]>([]);
  const [removedGuests, setRemovedGuests] = useState<string[]>([]);
  const [guestText, setGuestText] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [duration, setDuration] = useState(30);
  const [media, setMedia] = useState<'video' | 'audio'>('video');
  const [reminders, setReminders] = useState<number[]>([10]);
  const [start, setStart] = useState<Date | null>(null);
  const [day, setDay] = useState(dayKey(new Date()));
  const [picker, setPicker] = useState(false);
  const [found, setFound] = useState<FindTimesResponse | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [repeat, setRepeat] = useState<RepeatDraft>(() => newRepeatDraft(null));
  /** Editing a recurring meeting: just this one, or this and every upcoming one. */
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence');
  const series = existing?.series ?? null;
  const tz = existing?.timeZone ?? deviceTimeZone();
  const blocked = engine.serverActionBlocker();

  // Prefill when editing.
  useEffect(() => {
    if (!existing || loaded) return;
    setTitle(existing.title);
    setAgenda(existing.agenda);
    setDuration(minutesBetween(existing.startsAt, existing.endsAt));
    setMedia(existing.media);
    setReminders(existing.remindMinutes);
    setStart(new Date(existing.startsAt));
    setDay(dayKey(new Date(existing.startsAt)));
    if (existing.series)
      setRepeat(draftFromRecurrence(existing.series.recurrence, new Date(existing.startsAt)));
    setLoaded(true);
  }, [existing, loaded]);

  // A new rule follows the chosen time: weekly on that day, ending three months later.
  useEffect(() => {
    if (!start || editing) return;
    setRepeat((r) => {
      const fresh = newRepeatDraft(start);
      return r.frequency === 'none' || r.weekdays.length <= 1
        ? {
            ...r,
            weekdays: fresh.weekdays,
            endsOn: r.frequency === 'none' ? fresh.endsOn : r.endsOn,
          }
        : r;
    });
  }, [start, editing]);

  const already = useMemo(
    () => (existing ? existing.attendees.map((a) => a.userId) : []),
    [existing],
  );
  const everyone = useMemo(() => [...already, ...selected], [already, selected]);

  // Free slots for everyone in the next two weeks (needs the server).
  useEffect(() => {
    if (blocked) return;
    let alive = true;
    const t = setTimeout(() => {
      setFinding(true);
      const from = nextHalfHour();
      void engine
        .findTimes({
          attendeeIds: everyone,
          durationMinutes: duration,
          from: from.toISOString(),
          to: addDays(from, 14).toISOString(),
          stepMinutes: 30,
          limit: 50,
          ...(edit ? { ignoreMeetingId: edit } : {}),
        })
        .then((r) => alive && setFound(r))
        .catch(() => alive && setFound(null))
        .finally(() => alive && setFinding(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, everyone, duration, edit, blocked]);

  const slot: Slot | null = start
    ? {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + duration * 60_000).toISOString(),
      }
    : null;
  const busyIds = (s: Slot) =>
    Object.entries(found?.busy ?? {})
      .filter(([, blocks]) => blocks.some((b) => overlaps(b, s)))
      .map(([u]) => u);
  const clash = slot ? busyIds(slot) : [];
  // Spread suggestions over several days: at most two per day, eight in all.
  const suggestions = useMemo(() => {
    const perDay = new Map<string, number>();
    return (found?.slots ?? [])
      .filter((s) => {
        const k = dayKey(new Date(s.startsAt));
        const n = perDay.get(k) ?? 0;
        perDay.set(k, n + 1);
        return n < 2;
      })
      .slice(0, 8);
  }, [found]);
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.displayName ?? 'Someone';

  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i)),
    [],
  );
  const times = useMemo(() => {
    const base = new Date(`${day}T00:00:00`);
    const out: Date[] = [];
    for (let h = FIRST_HOUR; h < LAST_HOUR; h++)
      for (const mm of [0, 30])
        out.push(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mm));
    return out.filter((d) => d.getTime() > Date.now());
  }, [day]);

  const keptGuests = (existing?.guests ?? []).filter((g) => !removedGuests.includes(g.guestId));
  const addGuest = () => {
    if (!guestText.trim()) return;
    const r = checkGuestEmail(guestText, {
      taken: [...keptGuests.map((g) => g.email), ...guests.map((g) => g.email.toLowerCase())],
      directory: people,
    });
    if ('error' in r) return setGuestError(r.error);
    setGuests((g) => [...g, { email: r.email }]);
    setGuestText('');
    setGuestError(null);
  };

  const toggleReminder = (r: number) =>
    setReminders((cur) =>
      cur.includes(r) ? cur.filter((x) => x !== r) : cur.length >= 3 ? cur : [...cur, r],
    );

  const submit = async () => {
    if (!title.trim()) return setError('Give the meeting a title.');
    if (!slot) return setError('Pick a time.');
    if (Date.parse(slot.startsAt) < Date.now()) return setError('Pick a time in the future.');
    const forSeries = !editing || scope === 'series';
    if (forSeries) {
      const problem = repeatProblem(repeat, start);
      if (problem) return setError(problem);
    }
    if (editing && series && scope === 'series' && repeat.frequency === 'none')
      return setError('To stop the series, cancel the upcoming meetings instead.');
    if (
      editing &&
      series &&
      scope === 'occurrence' &&
      (guests.length > 0 || removedGuests.length > 0)
    )
      return setError(
        'Guests are invited to the whole series. Choose “This and all upcoming” to change them.',
      );
    setBusy(true);
    setError(null);
    try {
      if (editing && existing) {
        const moved =
          slot.startsAt !== new Date(existing.startsAt).toISOString() ||
          slot.endsAt !== new Date(existing.endsAt).toISOString();
        const rule = draftToRecurrence(repeat);
        const ruleChanged =
          !!series && scope === 'series' && !sameRecurrence(rule, series.recurrence);
        await engine.updateMeeting(existing.meetingId, {
          ...(series ? { scope } : {}),
          ...(ruleChanged && rule ? { recurrence: rule } : {}),
          title: title.trim(),
          agenda: agenda.trim(),
          media,
          remindMinutes: reminders,
          ...(moved
            ? { startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone: deviceTimeZone() }
            : {}),
          addAttendeeIds: selected,
          addGuests: guests,
          removeGuestIds: removedGuests,
        });
        router.back();
      } else {
        const m = await engine.createMeeting({
          title: title.trim(),
          agenda: agenda.trim(),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timeZone: deviceTimeZone(),
          media,
          remindMinutes: reminders,
          attendeeIds: selected,
          guests,
          ...(draftToRecurrence(repeat) ? { recurrence: draftToRecurrence(repeat) } : {}),
        });
        router.replace({ pathname: '/meeting/[id]', params: { id: m.meetingId } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean, warn = false) => [
    styles.chip,
    {
      backgroundColor: on ? c.accent : warn ? alpha(c.warning, 0.1) : c.surfaceRaised,
      borderColor: on ? c.accent : warn ? alpha(c.warning, 0.5) : c.border,
    },
  ];
  const field = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: editing ? 'Edit meeting' : 'Schedule a meeting' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {blocked ? (
          <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
            <Text variant="meta" style={{ color: c.warning }}>
              {blocked}
            </Text>
          </View>
        ) : null}
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title, e.g. Wave 3 fieldwork kickoff"
          placeholderTextColor={c.textSubtle}
          maxLength={120}
          accessibilityLabel="Meeting title"
          style={[field, { fontFamily: typeScale.heading.fontFamily }]}
        />

        <Section title={editing ? 'Invite more people' : 'People'}>
          <View style={styles.wrap}>
            {already.map((id) => (
              <View key={id} style={[styles.person, { borderColor: c.border }]}>
                <Text variant="label" tone="muted">
                  {nameOf(id)}
                </Text>
              </View>
            ))}
            {selected.map((id) => (
              <Pressable
                key={id}
                onPress={() => setSelected((s) => s.filter((x) => x !== id))}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${nameOf(id)}`}
                style={[
                  styles.person,
                  { backgroundColor: alpha(c.accent, 0.14), borderColor: alpha(c.accent, 0.4) },
                ]}
              >
                <Text variant="label" tone="accent">
                  {nameOf(id)}
                </Text>
                <Ionicons name="close" size={13} color={c.accent} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => setPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Add people"
              style={[styles.person, { borderColor: c.accent, borderStyle: 'dashed' }]}
            >
              <Ionicons name="person-add-outline" size={14} color={c.accent} />
              <Text variant="label" tone="accent">
                Add people
              </Text>
            </Pressable>
          </View>
          {!editing ? (
            <Text variant="meta" tone="subtle">
              A meeting chat is created for everyone invited. Joining the meeting joins its call.
            </Text>
          ) : null}
        </Section>

        <Section title="Guests from outside">
          <View style={styles.wrap}>
            {keptGuests.map((g) => (
              <Pressable
                key={g.guestId}
                onPress={() => setRemovedGuests((r) => [...r, g.guestId])}
                accessibilityRole="button"
                accessibilityLabel={`Remove guest ${g.email}. They get a cancellation`}
                style={[styles.person, { borderColor: c.border }]}
              >
                <Ionicons name="mail-outline" size={13} color={c.textMuted} />
                <Text variant="label" tone="muted">
                  {g.email}
                </Text>
                <Ionicons name="close" size={13} color={c.textSubtle} />
              </Pressable>
            ))}
            {guests.map((g) => (
              <Pressable
                key={g.email}
                onPress={() => setGuests((all) => all.filter((x) => x.email !== g.email))}
                accessibilityRole="button"
                accessibilityLabel={`Remove guest ${g.email}`}
                style={[
                  styles.person,
                  {
                    backgroundColor: alpha(c.accentSecondary, 0.14),
                    borderColor: alpha(c.accentSecondary, 0.45),
                  },
                ]}
              >
                <Ionicons name="mail-outline" size={13} color={c.accentSecondary} />
                <Text variant="label" style={{ color: c.accentSecondary }}>
                  {g.email}
                </Text>
                <Ionicons name="close" size={13} color={c.accentSecondary} />
              </Pressable>
            ))}
          </View>
          <View style={styles.guestRow}>
            <TextInput
              value={guestText}
              onChangeText={(t) => {
                setGuestText(t);
                if (guestError) setGuestError(null);
              }}
              onSubmitEditing={addGuest}
              placeholder="name@client.com"
              placeholderTextColor={c.textSubtle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Guest email"
              style={[field, { flex: 1 }]}
            />
            <Button
              title="Add"
              kind="quiet"
              icon="add"
              onPress={addGuest}
              disabled={!guestText.trim()}
              accessibilityLabel="Add guest"
            />
          </View>
          {guestError ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {guestError}
            </Text>
          ) : (
            <Text variant="meta" tone="subtle">
              Guests get an email with a calendar invite and a personal join link. They wait in the
              lobby until someone in the call lets them in.
            </Text>
          )}
          {removedGuests.length ? (
            <Text variant="meta" style={{ color: c.warning }}>
              {removedGuests.length} guest{removedGuests.length === 1 ? '' : 's'} will get a
              cancellation and their link stops working.
            </Text>
          ) : null}
        </Section>

        <Section title="Length">
          <View style={styles.wrap}>
            {DURATIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                accessibilityRole="radio"
                accessibilityState={{ checked: duration === d }}
                accessibilityLabel={`${d} minutes`}
                style={chip(duration === d)}
              >
                <Text variant="label" tone={duration === d ? 'onAccent' : 'default'}>
                  {d < 60 ? `${d} min` : d === 60 ? '1 h' : '1 h 30'}
                </Text>
              </Pressable>
            ))}
            {(['video', 'audio'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setMedia(k)}
                accessibilityRole="radio"
                accessibilityState={{ checked: media === k }}
                accessibilityLabel={k === 'video' ? 'Video meeting' : 'Voice meeting'}
                style={chip(media === k)}
              >
                <Ionicons
                  name={k === 'video' ? 'videocam-outline' : 'call-outline'}
                  size={14}
                  color={media === k ? c.onAccent : c.text}
                />
                <Text variant="label" tone={media === k ? 'onAccent' : 'default'}>
                  {k === 'video' ? 'Video' : 'Voice'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section
          title="Suggested times"
          detail={
            blocked
              ? 'Free times need a connection.'
              : finding
                ? 'Checking everyone’s working hours and meetings…'
                : found && found.slots.length === 0
                  ? 'No time in the next two weeks fits everyone’s working hours. Pick one below.'
                  : 'Everyone is free and inside their working hours.'
          }
        >
          <View style={styles.wrap}>
            {suggestions.map((s) => {
              const on = slot?.startsAt === s.startsAt;
              return (
                <Pressable
                  key={s.startsAt}
                  onPress={() => {
                    setStart(new Date(s.startsAt));
                    setDay(dayKey(new Date(s.startsAt)));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Suggested ${dayLabel(new Date(s.startsAt))} ${clock(s.startsAt)}`}
                  style={chip(on)}
                >
                  <Ionicons name="sparkles-outline" size={13} color={on ? c.onAccent : c.accent} />
                  <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                    {dayLabel(new Date(s.startsAt))} · {clock(s.startsAt)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Or pick a time">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {days.map((d) => {
              const k = dayKey(d);
              const on = k === day;
              return (
                <Pressable
                  key={k}
                  onPress={() => setDay(k)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={dayLabel(d)}
                  style={[
                    styles.day,
                    {
                      backgroundColor: on ? c.accent : c.surfaceRaised,
                      borderColor: on ? c.accent : c.border,
                    },
                  ]}
                >
                  <Text variant="meta" tone={on ? 'onAccent' : 'muted'}>
                    {d.toLocaleDateString([], { weekday: 'short' })}
                  </Text>
                  <Text variant="heading" tone={on ? 'onAccent' : 'default'}>
                    {d.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.wrap}>
            {times.map((t) => {
              const s = {
                startsAt: t.toISOString(),
                endsAt: new Date(t.getTime() + duration * 60_000).toISOString(),
              };
              const on = slot?.startsAt === s.startsAt;
              const taken = busyIds(s).length > 0;
              return (
                <Pressable
                  key={s.startsAt}
                  onPress={() => setStart(t)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${clock(t)}${taken ? ', someone is busy' : ''}`}
                  style={[chip(on, taken), styles.time]}
                >
                  <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                    {clock(t)}
                  </Text>
                </Pressable>
              );
            })}
            {times.length === 0 ? (
              <Text variant="meta" tone="muted">
                No times left today.
              </Text>
            ) : null}
          </View>
          {found ? (
            <Text variant="meta" tone="subtle">
              Amber times clash with someone’s meeting. Titles of other people’s meetings are never
              shown.
            </Text>
          ) : null}
        </Section>

        {editing && series ? (
          <Section
            title="Change"
            detail={
              scope === 'series'
                ? 'Changes every meeting of the series that hasn’t started. A new time or rule recreates them, so answers reset.'
                : 'Changes only this meeting. The rest of the series stays as it is.'
            }
          >
            <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Change">
              {(
                [
                  ['occurrence', 'Only this meeting'],
                  ['series', 'This and all upcoming'],
                ] as const
              ).map(([k, label]) => (
                <Pressable
                  key={k}
                  onPress={() => setScope(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: scope === k }}
                  accessibilityLabel={label}
                  style={chip(scope === k)}
                >
                  <Text variant="label" tone={scope === k ? 'onAccent' : 'default'}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {!editing || (series && scope === 'series') ? (
          <Section title="Repeat">
            <RepeatPicker value={repeat} onChange={setRepeat} start={start} timeZone={tz} />
          </Section>
        ) : null}

        <Section title="Remind everyone">
          <View style={styles.wrap}>
            {REMINDERS.map((r) => (
              <Pressable
                key={r}
                onPress={() => toggleReminder(r)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: reminders.includes(r) }}
                accessibilityLabel={r === 0 ? 'Remind at start' : `Remind ${r} minutes before`}
                style={chip(reminders.includes(r))}
              >
                <Text variant="label" tone={reminders.includes(r) ? 'onAccent' : 'default'}>
                  {r === 0 ? 'At start' : r === 60 ? '1 h before' : `${r} min`}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text variant="meta" tone="subtle">
            Up to three. Reminders arrive in the app and as a push when it is closed.
          </Text>
        </Section>

        <Section title="Agenda">
          <TextInput
            value={agenda}
            onChangeText={setAgenda}
            placeholder="What will you cover? (optional)"
            placeholderTextColor={c.textSubtle}
            multiline
            maxLength={4000}
            accessibilityLabel="Agenda"
            style={[field, { minHeight: 96, textAlignVertical: 'top' }]}
          />
        </Section>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
        {slot ? (
          <Text
            variant="meta"
            tone={clash.length ? 'default' : 'muted'}
            style={clash.length ? { color: c.warning } : undefined}
          >
            {dayLabel(new Date(slot.startsAt))}, {clock(slot.startsAt)} – {clock(slot.endsAt)}
            {clash.length
              ? ` · ${clash.map(nameOf).join(', ')} ${clash.length === 1 ? 'is' : 'are'} busy`
              : ''}
          </Text>
        ) : null}
        {error ? (
          <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button
          title={editing ? 'Save changes' : 'Send invites'}
          icon={editing ? 'checkmark' : 'paper-plane-outline'}
          onPress={() => void submit()}
          busy={busy}
          disabled={!!blocked || engineState?.connectivity === 'noServer'}
        />
      </View>

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: c.background,
            paddingTop: insets.top + space.md,
            paddingHorizontal: space.lg,
          }}
        >
          <View style={styles.modalHead}>
            <Text variant="title">Invite people</Text>
            <Button
              title="Done"
              kind="quiet"
              onPress={() => setPicker(false)}
              style={{ paddingVertical: 7 }}
            />
          </View>
          <PeoplePicker
            people={people}
            selected={selected}
            onChange={setSelected}
            exclude={already}
          />
        </View>
      </Modal>
    </Screen>
  );
}

function Section({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
        {title}
      </Text>
      {detail ? (
        <Text variant="meta" tone="muted" style={{ marginLeft: space.xs }}>
          {detail}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { padding: space.md, borderRadius: radius.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  time: { minWidth: 72, justifyContent: 'center' },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  day: {
    width: 52,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
});
