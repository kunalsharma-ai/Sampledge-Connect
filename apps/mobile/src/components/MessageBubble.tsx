import { Ionicons } from '@expo/vector-icons';
import { forwardedOf } from '@sampledge/contracts';
import { memo } from 'react';
import { router } from 'expo-router';
import { Pressable, Text as RNText, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { LocalMessage } from '../db/store';
import { segmentMentions, type MentionCandidate } from '../lib/mentions';
import {
  callMeta,
  meetingMeta,
  minutesMeta,
  recordingMeta,
  systemText,
} from '../lib/systemMessages';
import { workMeta } from '../lib/work';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { useChatHalo } from './ChatBackdrop';
import { AttachmentList } from './Attachments';
import { PollCard } from './PollCard';
import { STATUS_LABEL, StatusIcon } from './StatusIcon';
import { Text } from './Text';
import { WorkCard } from './WorkRows';

export interface ReplyPreview {
  /** Server id of the quoted message. */
  messageId: string;
  senderName: string;
  /** Null when the quoted message is not on this device (evicted or never synced). */
  text: string | null;
  deleted: boolean;
}

interface Props {
  message: LocalMessage;
  own: boolean;
  senderName: string;
  selfId: string;
  /** First message in a run from the same sender shows the name. */
  showSender: boolean;
  animate: boolean;
  /** People mentioned in this message, with display names. */
  mentioned: MentionCandidate[];
  reply: ReplyPreview | null;
  highlighted: boolean;
  onOpenActions: (message: LocalMessage) => void;
  onPressReply: (messageId: string) => void;
  onToggleReaction: (message: LocalMessage, emoji: string) => void;
  /** Names for the accessibility label of reaction chips. */
  nameOf: (userId: string) => string;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function MessageBubbleImpl({
  message: m,
  own,
  senderName,
  selfId,
  showSender,
  animate,
  mentioned,
  reply,
  highlighted,
  onOpenActions,
  onPressReply,
  onToggleReaction,
  nameOf,
}: Props) {
  const { theme, motion } = useTheme();
  const halo = useChatHalo();
  const c = theme.colors;
  const unsent = m.status === 'queued' || m.status === 'sending' || m.status === 'failed';
  const deleted = !!m.deletedAt;
  const bubbleColor = own ? c.bubbleOwn : c.bubbleOther;
  const textColor = own ? c.bubbleOwnText : c.text;
  const mentionsMe = !own && m.mentions.includes(selfId);
  const confirmedError = !unsent && m.error;

  if (m.messageType === 'system') return <SystemEvent message={m} animate={animate} />;
  const segments = deleted ? [] : segmentMentions(m.text, mentioned);
  const fwd = forwardedOf(m);

  return (
    <Animated.View
      entering={animate && motion.base ? FadeInDown.duration(motion.base) : undefined}
      style={[
        styles.row,
        own ? styles.rowOwn : styles.rowOther,
        highlighted && { backgroundColor: alpha(c.accent, 0.12) },
      ]}
    >
      {showSender && !own ? (
        <Text variant="label" tone="muted" style={[styles.sender, halo]}>
          {senderName}
        </Text>
      ) : null}
      <Pressable
        onLongPress={() => onOpenActions(m)}
        onPress={m.status === 'failed' ? () => onOpenActions(m) : undefined}
        delayLongPress={300}
        accessibilityHint="Double tap and hold for reply, edit and other actions"
        accessibilityLabel={`${own ? 'You' : senderName}: ${deleted ? 'message deleted' : [m.text, ...m.attachments.map((a) => `attachment ${a.fileName}`)].filter(Boolean).join(', ')}. ${own ? STATUS_LABEL[m.status] : ''}${m.pendingOp ? ', change not saved yet' : ''}`}
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubbleOther,
          {
            backgroundColor: bubbleColor,
            borderColor: mentionsMe ? c.accentSecondary : c.border,
            opacity: m.status === 'queued' || m.status === 'sending' ? 0.86 : 1,
          },
          mentionsMe && { borderWidth: 1 },
          m.status === 'failed' && { borderColor: c.danger, borderWidth: 1 },
        ]}
      >
        {reply && !deleted ? (
          <Pressable
            onPress={() => onPressReply(reply.messageId)}
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${reply.senderName}. Show original message`}
            style={[
              styles.quote,
              {
                borderLeftColor: own ? alpha(textColor, 0.7) : c.accent,
                backgroundColor: alpha(own ? '#000000' : c.accent, own ? 0.12 : 0.08),
              },
            ]}
          >
            <Text variant="label" style={{ color: own ? textColor : c.accent }} numberOfLines={1}>
              {reply.senderName}
            </Text>
            <Text
              variant="meta"
              numberOfLines={2}
              style={{
                color: textColor,
                opacity: 0.8,
                fontStyle: reply.text ? 'normal' : 'italic',
              }}
            >
              {reply.deleted
                ? 'Message deleted'
                : (reply.text ?? 'Original message is not saved on this device')}
            </Text>
          </Pressable>
        ) : null}
        {fwd && !deleted ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/conversation/[id]',
                params: { id: fwd.conversationId, focus: fwd.messageId },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Forwarded message from ${nameOf(fwd.senderId)}${fwd.from ? ` in ${fwd.from}` : ''}: ${fwd.text}. Double tap to open the original`}
            style={[
              styles.quote,
              {
                borderLeftColor: own ? alpha(textColor, 0.7) : c.accentSecondary,
                backgroundColor: alpha(own ? '#000000' : c.accentSecondary, own ? 0.12 : 0.08),
              },
            ]}
          >
            <View style={styles.fwdHead}>
              <Ionicons name="arrow-redo" size={12} color={alpha(textColor, 0.75)} />
              <Text variant="meta" style={{ color: textColor, opacity: 0.75 }} numberOfLines={1}>
                Forwarded{fwd.from ? ` from ${fwd.from}` : ''}
              </Text>
            </View>
            <Text
              variant="label"
              style={{ color: own ? textColor : c.accentSecondary }}
              numberOfLines={1}
            >
              {nameOf(fwd.senderId)}
            </Text>
            {fwd.text ? (
              <Text variant="body" style={{ color: textColor }} numberOfLines={8}>
                {fwd.text}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {!deleted ? <AttachmentList items={m.attachments} own={own} /> : null}
        {m.poll && !deleted ? (
          <PollCard messageId={m.messageId} poll={m.poll} own={own} nameOf={nameOf} />
        ) : deleted || m.text ? (
          <Text
            variant="body"
            style={{
              color: textColor,
              fontStyle: deleted ? 'italic' : 'normal',
              opacity: deleted ? 0.7 : 1,
            }}
          >
            {deleted
              ? 'This message was deleted'
              : segments.map((s, i) =>
                  s.userId ? (
                    <RNText
                      key={i}
                      style={{
                        fontFamily: fonts.semibold,
                        color: own ? textColor : c.accent,
                        backgroundColor:
                          s.userId === selfId ? alpha(c.accentSecondary, 0.25) : undefined,
                        textDecorationLine: own ? 'underline' : 'none',
                      }}
                    >
                      {s.text}
                    </RNText>
                  ) : (
                    s.text
                  ),
                )}
          </Text>
        ) : null}
        <View style={styles.meta}>
          {m.pinned && !deleted ? (
            <Ionicons
              name="pin"
              size={12}
              color={alpha(textColor, 0.75)}
              accessibilityLabel="Pinned"
            />
          ) : null}
          {m.pendingOp ? (
            <Ionicons name="time-outline" size={12} color={alpha(textColor, 0.7)} />
          ) : null}
          {m.actionPending && !deleted ? (
            <Ionicons
              name="cloud-upload-outline"
              size={12}
              color={alpha(textColor, 0.7)}
              accessibilityLabel="Your change is waiting to sync"
            />
          ) : null}
          {m.editedAt && !deleted ? (
            <Text variant="meta" style={{ color: textColor, opacity: 0.7 }}>
              {m.pendingOp === 'edit' ? 'saving edit' : 'edited'}
            </Text>
          ) : null}
          <Text variant="meta" style={{ color: textColor, opacity: 0.7 }}>
            {time(m.createdAt)}
          </Text>
          {own ? <StatusIcon status={m.status} onAccent /> : null}
        </View>
      </Pressable>
      {m.reactions.length && !deleted ? (
        <View style={[styles.chips, own ? styles.chipsOwn : null]}>
          {m.reactions.map((r) => {
            const who = r.userIds.map((u) => (u === selfId ? 'you' : nameOf(u)));
            const more = r.count - who.length;
            return (
              <Pressable
                key={r.emoji}
                onPress={() => onToggleReaction(m, r.emoji)}
                onLongPress={() => onOpenActions(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: r.mine }}
                accessibilityLabel={`${r.emoji} ${r.count}: ${who.join(', ')}${more > 0 ? ` and ${more} more` : ''}. ${r.mine ? 'Double tap to remove yours' : 'Double tap to add yours'}`}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: r.mine ? alpha(c.accent, 0.2) : c.surfaceRaised,
                    borderColor: r.mine ? c.accent : c.border,
                    opacity: r.pending ? 0.75 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
              >
                <RNText style={{ fontSize: 14 }}>{r.emoji}</RNText>
                <Text variant="meta" style={{ color: r.mine ? c.accent : c.textMuted }}>
                  {r.count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {own && m.status === 'failed' ? (
        <Text variant="meta" tone="danger" style={styles.failNote}>
          Not sent. Tap to retry.
        </Text>
      ) : null}
      {confirmedError ? (
        <Text variant="meta" tone="danger" style={styles.failNote}>
          {m.error}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

/** A server-written event in the timeline (e.g. a call), shown centred rather than as a bubble. */
function SystemEvent({ message: m, animate }: { message: LocalMessage; animate: boolean }) {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const work = workMeta(m.metadata);
  const call = callMeta(m.metadata);
  const meeting = meetingMeta(m.metadata);
  const rec = recordingMeta(m.metadata);
  const mins = minutesMeta(m.metadata);
  const missed =
    call?.status === 'missed' ||
    call?.status === 'declined' ||
    meeting?.status === 'cancelled' ||
    !!rec?.failed;
  const icon: keyof typeof Ionicons.glyphMap = rec
    ? 'recording-outline'
    : call
      ? call.media === 'video'
        ? 'videocam'
        : 'call'
      : meeting
        ? 'calendar'
        : 'information-circle-outline';
  const label = systemText(m.text, m.metadata);
  const minutesCallId =
    mins && !mins.deleted ? mins.callId : call?.status === 'ended' ? call.callId : undefined;
  const openMeeting = meeting?.meetingId
    ? () => router.push({ pathname: '/meeting/[id]', params: { id: meeting.meetingId! } })
    : minutesCallId
      ? () => router.push({ pathname: '/minutes/[callId]', params: { callId: minutesCallId } })
      : undefined;
  if (mins)
    return (
      <Animated.View
        entering={animate && motion.base ? FadeInDown.duration(motion.base) : undefined}
        style={styles.systemRow}
      >
        <Pressable
          onPress={openMeeting}
          disabled={!openMeeting}
          accessibilityRole={openMeeting ? 'button' : 'text'}
          accessibilityLabel={
            mins.deleted
              ? 'Minutes of meeting deleted'
              : `Minutes of meeting, ${mins.title ?? ''}. Open minutes`
          }
          style={[styles.minutesCard, { borderColor: c.border, backgroundColor: c.surface }]}
        >
          <Ionicons
            name={mins.deleted ? 'document-outline' : 'document-text'}
            size={22}
            color={mins.deleted ? c.textSubtle : c.accent}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" tone={mins.deleted ? 'subtle' : undefined} numberOfLines={1}>
              {mins.deleted ? 'Minutes of meeting deleted' : (mins.title ?? 'Minutes of meeting')}
            </Text>
            <Text variant="meta" tone="muted">
              {mins.deleted
                ? time(m.createdAt)
                : `Minutes · ${mins.decisions ?? 0} decision${mins.decisions === 1 ? '' : 's'} · ${mins.actionItems ?? 0} action${mins.actionItems === 1 ? '' : 's'} · ${time(m.createdAt)}`}
            </Text>
          </View>
          {openMeeting ? <Ionicons name="chevron-forward" size={14} color={c.textSubtle} /> : null}
        </Pressable>
      </Animated.View>
    );
  if (work)
    return (
      <Animated.View
        entering={animate && motion.base ? FadeInDown.duration(motion.base) : undefined}
        style={styles.systemRow}
      >
        <WorkCard work={work} time={time(m.createdAt)} />
      </Animated.View>
    );
  return (
    <Animated.View
      entering={animate && motion.base ? FadeInDown.duration(motion.base) : undefined}
      style={styles.systemRow}
    >
      <Pressable
        onPress={openMeeting}
        disabled={!openMeeting}
        accessibilityRole={openMeeting ? 'button' : 'text'}
        accessibilityLabel={`${label}, ${time(m.createdAt)}${openMeeting ? (meeting ? '. Open meeting' : '. Minutes') : ''}`}
      >
        <View
          style={[
            styles.systemPill,
            {
              backgroundColor: missed ? alpha(c.danger, 0.12) : alpha(c.accent, 0.1),
              borderColor: missed ? alpha(c.danger, 0.3) : c.border,
            },
          ]}
        >
          <Ionicons name={icon} size={14} color={missed ? c.danger : c.accent} />
          <Text variant="meta" style={{ color: missed ? c.danger : c.textMuted }}>
            {label}
          </Text>
          <Text variant="meta" tone="subtle">
            {time(m.createdAt)}
          </Text>
          {openMeeting ? <Ionicons name="chevron-forward" size={12} color={c.textSubtle} /> : null}
        </View>
      </Pressable>
      {m.attachments.length ? (
        <View style={styles.systemFiles}>
          <AttachmentList items={m.attachments} own={false} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fwdHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  systemFiles: { marginTop: 6, alignItems: 'center' },
  minutesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    width: '86%',
    maxWidth: 420,
  },
  row: { paddingHorizontal: space.lg, paddingVertical: 1.5 },
  rowOwn: { alignItems: 'flex-end' },
  rowOther: { alignItems: 'flex-start' },
  sender: { marginTop: space.md, marginBottom: 3, marginLeft: space.xs },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 7,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleOwn: { borderBottomRightRadius: 6 },
  bubbleOther: { borderBottomLeftRadius: 6 },
  quote: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    marginBottom: 6,
    gap: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 3,
  },
  failNote: { marginTop: 3, marginRight: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4, maxWidth: '82%' },
  chipsOwn: { justifyContent: 'flex-end' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  systemRow: { alignItems: 'center', paddingVertical: space.sm, paddingHorizontal: space.lg },
  systemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
