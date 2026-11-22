import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { minutesWhen } from '../../lib/minutes';
import { callMeta, formatDuration } from '../../lib/systemMessages';
import { useMessages } from '../../state/hooks';
import { useMinutesList } from '../../state/useMinutes';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Minutes of the calls in a conversation, and recent calls that have none yet. */
export default function MinutesListScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const items = useMinutesList(conversationId);
  const { messages } = useMessages(conversationId);
  const withMinutes = useMemo(() => new Set((items ?? []).map((m) => m.callId)), [items]);
  const calls = useMemo(
    () =>
      messages
        .flatMap((m) => {
          const call = callMeta(m.metadata);
          return m.messageType === 'system' && call?.callId && call.status === 'ended'
            ? [
                {
                  callId: call.callId,
                  at: m.createdAt,
                  media: call.media,
                  durationSec: call.durationSec,
                },
              ]
            : [];
        })
        .filter((x) => !withMinutes.has(x.callId))
        .reverse()
        .slice(0, 10),
    [messages, withMinutes],
  );
  const open = (callId: string) =>
    router.push({ pathname: '/minutes/[callId]', params: { callId } });

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        {items === null ? (
          <Text tone="muted">Loading…</Text>
        ) : items.length ? (
          <View style={{ gap: space.sm }}>
            {items.map((m) => (
              <Glass key={m.minutesId}>
                <Pressable
                  onPress={() => open(m.callId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.title}, ${m.status === 'draft' ? 'draft' : 'shared'}`}
                  style={styles.row}
                >
                  <Ionicons name="document-text-outline" size={22} color={c.accent} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {m.title}
                    </Text>
                    <Text variant="meta" tone="muted">
                      {minutesWhen(m)} · {m.decisions.length} decision
                      {m.decisions.length === 1 ? '' : 's'} · {m.actionItems.length} action
                      {m.actionItems.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {m.status === 'draft' ? (
                    <View style={[styles.pill, { backgroundColor: alpha(c.warning, 0.15) }]}>
                      <Text variant="meta" style={{ color: c.warning }}>
                        Draft
                      </Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
                </Pressable>
              </Glass>
            ))}
          </View>
        ) : (
          <Text tone="muted">No minutes in this conversation yet.</Text>
        )}
        {calls.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              Recent calls without minutes
            </Text>
            {calls.map((x) => (
              <Pressable
                key={x.callId}
                onPress={() => open(x.callId)}
                accessibilityRole="button"
                accessibilityLabel={`Make minutes for the call on ${new Date(x.at).toLocaleString()}`}
                style={[styles.row, styles.callRow, { borderColor: c.border }]}
              >
                <Ionicons
                  name={x.media === 'video' ? 'videocam-outline' : 'call-outline'}
                  size={18}
                  color={c.textMuted}
                />
                <Text style={{ flex: 1 }}>
                  {new Date(x.at).toLocaleString([], {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {x.durationSec ? ` · ${formatDuration(x.durationSec)}` : ''}
                </Text>
                <Text variant="label" style={{ color: c.accent }}>
                  Make minutes
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  callRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  pill: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
});
