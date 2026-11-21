import { Ionicons } from '@expo/vector-icons';
import type { RsvpResponse } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { RSVP_ICON, RSVP_LABEL, useJoinMeeting, useRsvpColor } from '../../components/MeetingBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { confirmThen } from '../../lib/confirm';
import {
  canJoinNow,
  dayLabel,
  deviceTimeZone,
  durationLabel,
  minutesBetween,
  relativeStart,
  timeRange,
  zoneLabel,
} from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useCalls, useMeeting, useNow, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const CHOICES: Exclude<RsvpResponse, 'pending'>[] = ['accepted', 'tentative', 'declined'];

/** One meeting: when, who, your answer, Join, the meeting chat, and organizer controls. */
export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  useApp();
  const { meeting: m, loading } = useMeeting(id);
  const nameOf = usePeople();
  const calls = useCalls();
  const now = useNow();
  const color = useRsvpColor();
  const join = useJoinMeeting();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!m) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Meeting' }} />
        {loading ? null : (
          <Text tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
            This meeting is not saved on this phone. It appears once you are online and invited.
          </Text>
        )}
      </Screen>
    );
  }

  const cancelled = m.status === 'cancelled';
  const organizer = m.organizerId === selfId;
  const joinable = !cancelled && canJoinNow(m.startsAt, m.endsAt, now);
  const started = Date.parse(m.endsAt) <= now;
  const myTz = deviceTimeZone();
  const counts = CHOICES.map(
    (r) => [r, m.attendees.filter((a) => a.response === r).length] as const,
  );
  const blocked = engine.serverActionBlocker();
  const attendees = [...m.attendees].sort((a, b) =>
    a.userId === m.organizerId
      ? -1
      : b.userId === m.organizerId
        ? 1
        : nameOf(a.userId).localeCompare(nameOf(b.userId)),
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Meeting' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <View style={{ gap: space.xs }}>
          {cancelled ? (
            <View style={[styles.badge, { backgroundColor: alpha(c.danger, 0.14) }]}>
              <Text variant="label" tone="danger">
                Cancelled
              </Text>
            </View>
          ) : joinable ? (
            <View style={[styles.badge, { backgroundColor: alpha(c.accent, 0.16) }]}>
              <Text variant="label" tone="accent">
                {relativeStart(m.startsAt, m.endsAt, now)}
              </Text>
            </View>
          ) : null}
          <Text
            variant="title"
            style={cancelled ? { textDecorationLine: 'line-through' } : undefined}
          >
            {m.title}
          </Text>
          <Text variant="bodyStrong" tone="muted">
            {dayLabel(new Date(m.startsAt), new Date(now))} · {timeRange(m.startsAt, m.endsAt)}
          </Text>
          <Text variant="meta" tone="subtle">
            {durationLabel(minutesBetween(m.startsAt, m.endsAt))} ·{' '}
            {m.media === 'video' ? 'Video' : 'Voice'} ·{' '}
            {m.remindMinutes.length
              ? `Reminder ${m.remindMinutes
                  .slice()
                  .sort((a, b) => b - a)
                  .map((x) => (x === 0 ? 'at start' : `${x} min before`))
                  .join(', ')}`
              : 'No reminder'}
            {m.timeZone !== myTz ? ` · Organizer's time zone: ${zoneLabel(m.timeZone)}` : ''}
          </Text>
        </View>

        {error ? (
          <View style={[styles.note, { backgroundColor: alpha(c.danger, 0.12) }]}>
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          </View>
        ) : null}

        {!cancelled && !started ? (
          <View style={{ gap: space.sm }}>
            <Button
              title={
                joinable
                  ? `Join ${m.media === 'video' ? 'video' : 'voice'} meeting`
                  : 'Join opens 15 min before'
              }
              icon={m.media === 'video' ? 'videocam' : 'call'}
              onPress={() => void join(m)}
              disabled={!joinable || !calls.config?.enabled || !!blocked}
            />
            {joinable && !calls.config?.enabled ? (
              <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
                Calls are not set up on this server yet.
              </Text>
            ) : null}
          </View>
        ) : null}

        {!cancelled ? (
          <View style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
              Your answer
            </Text>
            <View
              style={[styles.segment, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
            >
              {CHOICES.map((r) => {
                const on = m.myResponse === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => void engine.rsvp(m.meetingId, r)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={RSVP_LABEL[r]}
                    style={[
                      styles.segmentItem,
                      on && { backgroundColor: alpha(color(r), 0.18), borderColor: color(r) },
                    ]}
                  >
                    <Ionicons name={RSVP_ICON[r]} size={16} color={on ? color(r) : c.textSubtle} />
                    <Text variant="label" style={{ color: on ? color(r) : c.textMuted }}>
                      {RSVP_LABEL[r]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {m.rsvpPending ? (
              <Text variant="meta" style={{ color: c.warning, marginLeft: space.xs }}>
                Saved on this phone. Sent to the organizer when you are online.
              </Text>
            ) : null}
          </View>
        ) : null}

        {m.agenda ? (
          <View style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
              Agenda
            </Text>
            <Glass style={{ padding: space.lg }}>
              <Text>{m.agenda}</Text>
            </Glass>
          </View>
        ) : null}

        <Glass>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/conversation/[id]', params: { id: m.conversationId } })
            }
            accessibilityRole="button"
            accessibilityLabel="Open meeting chat"
            style={styles.row}
          >
            <Ionicons name="chatbubbles-outline" size={20} color={c.accent} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Meeting chat
            </Text>
            <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
          </Pressable>
        </Glass>

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
            {m.attendees.length} invited ·{' '}
            {counts
              .filter(([, n]) => n > 0)
              .map(([r, n]) => `${n} ${RSVP_LABEL[r].toLowerCase()}`)
              .join(' · ') || 'no answers yet'}
          </Text>
          <Glass>
            {attendees.map((a, i) => {
              const r = a.userId === selfId ? (m.myResponse ?? a.response) : a.response;
              return (
                <View
                  key={a.userId}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <Avatar name={nameOf(a.userId, { asWritten: true })} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {nameOf(a.userId)}
                    </Text>
                    <Text variant="meta" tone="muted">
                      {[
                        a.userId === m.organizerId ? 'Organizer' : null,
                        a.optional ? 'Optional' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Invited'}
                    </Text>
                  </View>
                  <Ionicons name={RSVP_ICON[r]} size={16} color={color(r)} />
                  <Text variant="meta" style={{ color: color(r) }}>
                    {RSVP_LABEL[r]}
                  </Text>
                </View>
              );
            })}
          </Glass>
        </View>

        {organizer && !cancelled && !started ? (
          <View style={{ gap: space.sm }}>
            {blocked ? (
              <Text variant="meta" style={{ color: c.warning, textAlign: 'center' }}>
                {blocked}
              </Text>
            ) : null}
            <Button
              title="Reschedule or edit"
              kind="quiet"
              icon="create-outline"
              onPress={() =>
                router.push({ pathname: '/meetings/new', params: { edit: m.meetingId } })
              }
              disabled={!!blocked}
            />
            <Button
              title="Cancel meeting"
              kind="danger"
              icon="close-circle-outline"
              busy={busy === 'cancel'}
              disabled={!!blocked}
              onPress={() =>
                confirmThen(
                  `Cancel ${m.title}?`,
                  'Everyone invited is told, and the card in the meeting chat shows it was cancelled.',
                  'Cancel meeting',
                  () => void run('cancel', () => engine.cancelMeeting(m.meetingId)),
                )
              }
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  note: { padding: space.md, borderRadius: radius.md },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
});
