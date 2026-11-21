import { Ionicons } from '@expo/vector-icons';
import type { RsvpResponse } from '@sampledge/contracts';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LocalMeeting } from '../db/store';
import { canJoinNow, relativeStart, timeRange } from '../lib/time';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export const RSVP_LABEL: Record<RsvpResponse, string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
  pending: 'No response',
};

export const RSVP_ICON: Record<RsvpResponse, keyof typeof Ionicons.glyphMap> = {
  accepted: 'checkmark-circle',
  tentative: 'help-circle',
  declined: 'close-circle',
  pending: 'ellipse-outline',
};

export function useRsvpColor(): (r: RsvpResponse | null) => string {
  const { theme } = useTheme();
  const c = theme.colors;
  return (r) =>
    r === 'accepted'
      ? c.success
      : r === 'tentative'
        ? c.warning
        : r === 'declined'
          ? c.danger
          : c.textSubtle;
}

/** Starts or joins the meeting chat's call and opens the call screen. */
export function useJoinMeeting(): (m: LocalMeeting) => Promise<void> {
  const { engine } = useWorkspace();
  return async (m) => {
    const cur = await engine.calls.start(m.conversationId, m.media);
    if (cur) router.push({ pathname: '/call/[id]', params: { id: cur.call.callId } });
  };
}

/** One meeting in a list: time, title, who, your answer, and Join while it is open. */
export function MeetingRow({
  m,
  now,
  nameOf,
  canJoin,
}: {
  m: LocalMeeting;
  now: number;
  nameOf: (id: string) => string;
  canJoin: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = useRsvpColor();
  const join = useJoinMeeting();
  const cancelled = m.status === 'cancelled';
  const live = !cancelled && canJoinNow(m.startsAt, m.endsAt, now);
  const others = m.attendees.length - 1;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/meeting/[id]', params: { id: m.meetingId } })}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}, ${timeRange(m.startsAt, m.endsAt)}${cancelled ? ', cancelled' : ''}${m.myResponse ? `, ${RSVP_LABEL[m.myResponse]}` : ''}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: c.surfaceRaised,
          borderColor: live ? alpha(c.accent, 0.6) : c.border,
          opacity: pressed ? 0.85 : cancelled ? 0.6 : 1,
        },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: cancelled ? c.textSubtle : c.accent }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" tone="muted">
          {timeRange(m.startsAt, m.endsAt)}
          {live ? (
            <Text variant="label" tone="accent">
              {'  '}
              {relativeStart(m.startsAt, m.endsAt, now)}
            </Text>
          ) : null}
        </Text>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={cancelled ? { textDecorationLine: 'line-through' } : undefined}
        >
          {m.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons
            name={m.media === 'video' ? 'videocam-outline' : 'call-outline'}
            size={13}
            color={c.textSubtle}
          />
          <Text variant="meta" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {cancelled
              ? 'Cancelled'
              : `${nameOf(m.organizerId)}${others > 0 ? ` + ${others} other${others === 1 ? '' : 's'}` : ''}`}
          </Text>
          {!cancelled && m.myResponse ? (
            <View style={styles.metaRow}>
              <Ionicons name={RSVP_ICON[m.myResponse]} size={13} color={color(m.myResponse)} />
              <Text variant="meta" style={{ color: color(m.myResponse) }}>
                {RSVP_LABEL[m.myResponse]}
                {m.rsvpPending ? ' · not sent yet' : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {live && canJoin ? (
        <Pressable
          onPress={() => void join(m)}
          accessibilityRole="button"
          accessibilityLabel={`Join ${m.title}`}
          style={[styles.join, { backgroundColor: c.accent }]}
        >
          <Ionicons name={m.media === 'video' ? 'videocam' : 'call'} size={15} color={c.onAccent} />
          <Text variant="label" tone="onAccent">
            Join
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginLeft: space.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  join: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
});
