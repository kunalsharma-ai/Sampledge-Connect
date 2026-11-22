import { Ionicons } from '@expo/vector-icons';
import type { NetworkPerson } from '@sampledge/contracts';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { personLine } from '../lib/network';
import { useWorkspace } from '../state/AppProvider';
import { useConversations } from '../state/hooks';
import { TransportError } from '../sync/transport';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Glass } from './Glass';
import { Text } from './Text';

export function netErrorText(e: unknown): string {
  if (e instanceof TransportError) {
    if (e.kind === 'network') return 'You’re offline. This needs a connection.';
    if (e.code === 'RATE_LIMITED') return 'Too many tries. Wait a moment and try again.';
    if (e.message) return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** A titled group of rows. */
export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.sectionHead}>
        <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs, flex: 1 }}>
          {title}
        </Text>
        {right}
      </View>
      <Glass>{children}</Glass>
    </View>
  );
}

/** "Queued": a change made here that is not on the server yet. */
export function QueuedTag() {
  const { theme } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: alpha(theme.colors.warning, 0.16) }]}>
      <Ionicons name="time-outline" size={11} color={theme.colors.warning} />
      <Text variant="meta" style={{ color: theme.colors.warning }}>
        Queued
      </Text>
    </View>
  );
}

export function Tag({ text, accent }: { text: string; accent?: boolean }) {
  const { theme } = useTheme();
  const c = accent ? theme.colors.accent : theme.colors.textMuted;
  return (
    <View style={[styles.tag, { backgroundColor: alpha(c, 0.14) }]}>
      <Text variant="meta" style={{ color: c }}>
        {text}
      </Text>
    </View>
  );
}

/** One person: avatar, name, Connect ID and organization, then whatever fits the list. */
export function PersonRow({
  person,
  tags,
  actions,
  divider,
  onPress,
}: {
  person: NetworkPerson;
  tags?: ReactNode;
  actions?: ReactNode;
  divider?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const open =
    onPress ??
    (() => router.push({ pathname: '/network/person/[id]', params: { id: person.userId } }));
  return (
    <View
      style={[
        styles.row,
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <Pressable
        onPress={open}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityLabel={`${person.displayName}, @${person.handle}`}
      >
        <Avatar name={person.displayName} size={42} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {person.displayName}
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {personLine(person)}
          </Text>
          {tags ? <View style={styles.tags}>{tags}</View> : null}
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** A small pill button for row actions. */
export function SmallButton({
  title,
  onPress,
  kind = 'quiet',
  icon,
  accessibilityLabel,
}: {
  title?: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.danger : c.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      hitSlop={4}
      style={({ pressed }) => [
        styles.small,
        {
          backgroundColor:
            kind === 'primary' ? c.accent : alpha(kind === 'danger' ? c.danger : c.accent, 0.1),
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      {title ? (
        <Text variant="label" style={{ color: fg }}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { theme } = useTheme();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.textSubtle}
        autoCorrect={false}
        {...rest}
        style={[
          styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceSunken,
            borderColor: theme.colors.border,
          },
          rest.multiline && { minHeight: 84, textAlignVertical: 'top' },
          style,
        ]}
        accessibilityLabel={label}
      />
      {hint ? (
        <Text variant="meta" tone="subtle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Empty({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={theme.colors.textSubtle} />
      <Text variant="bodyStrong" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** Opens your direct chat with a connection, starting it when there is none yet. */
export function useMessagePerson(): {
  message: (userId: string) => Promise<void>;
  busy: boolean;
  error: string | null;
} {
  const { engine, selfId } = useWorkspace();
  const { conversations } = useConversations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = async (userId: string) => {
    const dm = conversations.find(
      (x) =>
        x.kind === 'dm' &&
        x.memberIds.includes(userId) &&
        x.memberIds.includes(selfId) &&
        x.memberIds.length === 2,
    );
    if (dm)
      return router.push({ pathname: '/conversation/[id]', params: { id: dm.conversationId } });
    setBusy(true);
    setError(null);
    try {
      const cid = await engine.createConversation({ kind: 'dm', memberIds: [userId] });
      router.push({ pathname: '/conversation/[id]', params: { id: cid } });
    } catch (e) {
      setError(netErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { message, busy, error };
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: { alignItems: 'center', gap: space.sm, padding: space.xl },
});
