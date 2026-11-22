import { Ionicons } from '@expo/vector-icons';
import type { ConnectorProvider, InboxConversation, InboxPriority } from '@sampledge/contracts';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PROVIDER_META, PRIORITY_LABEL, slaLabel, STATUS_LABEL } from '../lib/inbox';
import { alpha, mix, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { PersonAvatar } from './Avatar';
import { Text } from './Text';

/** A neutral two-letter mark per channel (no third-party logos), as on the web inbox. */
export function ProviderMark({
  provider,
  size = 28,
}: {
  provider: ConnectorProvider;
  size?: number;
}) {
  const m = PROVIDER_META[provider];
  return (
    <View
      accessibilityLabel={m.name}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: mix(m.hue, '#000000', 0.12),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: '#FFFFFF',
          fontSize: size * 0.38,
          lineHeight: size * 0.46,
          fontWeight: '700',
        }}
      >
        {m.mark}
      </Text>
    </View>
  );
}

type Tone = 'danger' | 'warning' | 'muted' | 'success' | 'accent' | 'accent2';

/** A small rounded label. */
export function Pill({
  text,
  tone = 'muted',
  icon,
}: {
  text: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const fg = {
    danger: c.danger,
    warning: c.warning,
    success: c.success,
    accent: c.accent,
    accent2: c.accentSecondary,
    muted: c.textMuted,
  }[tone];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: tone === 'muted' ? alpha(c.text, 0.06) : alpha(fg, 0.14),
          borderColor: tone === 'accent2' ? alpha(fg, 0.5) : 'transparent',
          borderStyle: tone === 'accent2' ? 'dashed' : 'solid',
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : null}
      <Text variant="meta" style={{ color: fg, fontWeight: '600' }}>
        {text}
      </Text>
    </View>
  );
}

export function SlaPill({ sla, now }: { sla: InboxConversation['sla']; now?: number }) {
  const l = slaLabel(sla, now);
  if (!l) return null;
  return (
    <Pill
      text={l.text}
      tone={l.tone}
      icon={
        l.tone === 'danger' ? 'alarm-outline' : l.tone === 'success' ? 'checkmark' : 'time-outline'
      }
    />
  );
}

export function PriorityDot({ priority }: { priority: InboxPriority }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color =
    priority === 'urgent'
      ? c.danger
      : priority === 'high'
        ? c.warning
        : priority === 'normal'
          ? c.accent
          : c.textSubtle;
  return (
    <View
      accessibilityLabel={`${PRIORITY_LABEL[priority]} priority`}
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
    />
  );
}

export function TestModeBadge() {
  return <Pill text="Test mode" tone="accent2" icon="flask-outline" />;
}

const relTime = (iso: string, now: number) => {
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return 'now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** One client conversation in the inbox list. */
export const InboxRow = memo(function InboxRow({
  c: conv,
  assigneeName,
  mine,
  now,
}: {
  c: InboxConversation;
  assigneeName: string | null;
  /** Assigned to you: reads "You". */
  mine: boolean;
  now: number;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const unread = conv.unread;
  const preview = conv.lastMessage
    ? `${conv.lastMessage.direction === 'outbound' ? 'You: ' : ''}${conv.lastMessage.preview}`
    : conv.subject;
  return (
    <Pressable
      onPress={() => router.push(`/inbox/${conv.conversationId}`)}
      accessibilityRole="button"
      accessibilityLabel={`${conv.client.name}, ${conv.subject}${unread ? ', unread' : ''}`}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: c.border,
          backgroundColor: pressed ? alpha(c.text, 0.04) : 'transparent',
        },
      ]}
    >
      <ProviderMark provider={conv.provider} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.line}>
          <Text
            variant={unread ? 'bodyStrong' : 'body'}
            numberOfLines={1}
            style={{ flex: 1, fontWeight: unread ? '600' : '400' }}
          >
            {conv.client.name}
            {conv.client.company ? (
              <Text variant="meta" tone="subtle">
                {'  '}
                {conv.client.company}
              </Text>
            ) : null}
          </Text>
          <Text variant="meta" tone={unread ? 'accent' : 'subtle'}>
            {relTime(conv.lastMessage?.at ?? conv.updatedAt, now)}
          </Text>
        </View>
        <Text variant="label" numberOfLines={1} tone={unread ? 'default' : 'muted'}>
          {conv.subject}
        </Text>
        <Text variant="meta" tone="subtle" numberOfLines={1}>
          {preview}
        </Text>
        <View style={[styles.line, { marginTop: 4, gap: space.xs, flexWrap: 'wrap' }]}>
          <PriorityDot priority={conv.priority} />
          {conv.status !== 'open' ? <Pill text={STATUS_LABEL[conv.status]} /> : null}
          <SlaPill sla={conv.sla} now={now} />
          {conv.escalation ? <Pill text="Escalated" tone="danger" icon="flag-outline" /> : null}
          {conv.testMode ? <TestModeBadge /> : null}
          <View style={{ flex: 1 }} />
          {assigneeName ? (
            <View style={[styles.line, { gap: 4 }]}>
              <PersonAvatar userId={conv.assigneeId} name={assigneeName} size={18} />
              <Text variant="meta" tone="subtle" numberOfLines={1}>
                {mine ? 'You' : assigneeName}
              </Text>
            </View>
          ) : (
            <Text variant="meta" tone="subtle">
              Unassigned
            </Text>
          )}
        </View>
      </View>
      {unread ? <View style={[styles.dot, { backgroundColor: c.accent }]} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
});
