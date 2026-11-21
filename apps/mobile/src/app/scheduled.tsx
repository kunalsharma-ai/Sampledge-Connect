import { Ionicons } from '@expo/vector-icons';
import type { ScheduledMessage } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Glass } from '../components/Glass';
import { ScheduleSheet } from '../components/ScheduleSheet';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { confirmThen } from '../lib/confirm';
import { formatSendAt } from '../lib/schedule';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople, useScheduled } from '../state/hooks';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Messages you scheduled, soonest first: send now, change the time or delete. Only you see
 * them until they send. They live on the server, so this needs a connection.
 */
export default function Scheduled() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const { items, error: loadError, reload } = useScheduled(conversationId || undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<ScheduledMessage | null>(null);
  const blocked = engine.serverActionBlocker();
  const shown = (items ?? []).filter((m) => m.status === 'scheduled' || m.status === 'failed');

  const step = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const where = (id: string) => {
    const conv = conversations.find((x) => x.conversationId === id);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'Conversation';
  };
  const note =
    error ??
    loadError ??
    (blocked ? `${blocked} Scheduled messages are kept on the server.` : null);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: title ? `Scheduled · ${title}` : 'Scheduled messages' }} />
      <ScheduleSheet
        visible={!!moving}
        title="Change send time"
        busy={busy === moving?.scheduledId}
        error={error}
        onPick={(at) =>
          void step(moving!.scheduledId, async () => {
            await engine.rescheduleMessage(moving!.scheduledId, at);
            setMoving(null);
          })
        }
        onClose={() => setMoving(null)}
      />
      <FlatList
        data={shown}
        keyExtractor={(m) => m.scheduledId}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={reload} tintColor={c.accent} />
        }
        ListHeaderComponent={
          note ? (
            <View
              style={[
                styles.note,
                { backgroundColor: alpha(error || loadError ? c.danger : c.warning, 0.12) },
              ]}
            >
              <Text variant="meta" style={{ color: error || loadError ? c.danger : c.warning }}>
                {note}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item: m }) => {
          const failed = m.status === 'failed';
          const working = busy === m.scheduledId;
          return (
            <Glass style={{ padding: space.md, gap: space.sm }}>
              <View style={styles.head}>
                <Ionicons
                  name={failed ? 'alert-circle' : 'time-outline'}
                  size={18}
                  color={failed ? c.danger : c.accent}
                />
                <Text variant="bodyStrong" style={{ flex: 1, color: failed ? c.danger : c.text }}>
                  {failed ? 'Not sent' : formatSendAt(m.sendAt, new Date())}
                </Text>
                {working ? <ActivityIndicator size="small" color={c.accent} /> : null}
              </View>
              {conversationId ? null : (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/conversation/[id]',
                      params: { id: m.conversationId },
                    })
                  }
                  accessibilityRole="link"
                >
                  <Text variant="meta" tone="accent">
                    {where(m.conversationId)}
                  </Text>
                </Pressable>
              )}
              <Text numberOfLines={6}>{m.content.text}</Text>
              {failed && m.error ? (
                <Text variant="meta" tone="danger">
                  {m.error}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Action
                  icon="send"
                  label="Send now"
                  disabled={!!blocked || working}
                  onPress={() =>
                    void step(m.scheduledId, () => engine.sendScheduledNow(m.scheduledId))
                  }
                />
                {!failed ? (
                  <Action
                    icon="calendar-outline"
                    label="Change time"
                    disabled={!!blocked || working}
                    onPress={() => {
                      setError(null);
                      setMoving(m);
                    }}
                  />
                ) : null}
                <Action
                  icon="trash-outline"
                  label="Delete"
                  danger
                  disabled={!!blocked || working}
                  onPress={() =>
                    confirmThen(
                      'Delete this scheduled message?',
                      'It will not be sent.',
                      'Delete',
                      () => void step(m.scheduledId, () => engine.cancelScheduled(m.scheduledId)),
                    )
                  }
                />
              </View>
            </Glass>
          );
        }}
        ListEmptyComponent={
          items ? (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                Nothing scheduled. Write a message, then tap + and Send later (or hold the send
                button).
              </Text>
            </View>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
      />
    </Screen>
  );

  function Action({
    icon,
    label,
    onPress,
    disabled,
    danger,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) {
    const color = danger ? c.danger : c.accent;
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: alpha(color, pressed ? 0.16 : 0.08), opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <Ionicons name={icon} size={15} color={color} />
        <Text variant="label" style={{ color }}>
          {label}
        </Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  note: { padding: space.md, borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
});
