import { Ionicons } from '@expo/vector-icons';
import {
  SUMMARY_RANGES,
  type ActionItem,
  type AiMeetingSummary,
  type AiSummary,
  type SummaryRange,
} from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AiShare } from '../../components/AiShare';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { SUMMARY_RANGE_LABEL, summaryAsMessage } from '../../lib/ai';
import { useWorkspace } from '../../state/AppProvider';
import { usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * AI summary of a conversation (`id` is the conversation) or of a meeting (`meeting=1`):
 * the gist, decisions, action items with Create task, and open questions.
 */
export default function Summary() {
  const { id, meeting } = useLocalSearchParams<{ id: string; meeting?: string }>();
  const isMeeting = meeting === '1';
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const [range, setRange] = useState<SummaryRange>('recent');
  const [s, setS] = useState<AiSummary | AiMeetingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    if (blocked) return setLoading(false);
    let alive = true;
    setLoading(true);
    setError(null);
    (isMeeting ? engine.aiSummarizeMeeting(id) : engine.aiSummarize(id, range))
      .then((r) => alive && setS(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isMeeting, range, blocked]);

  const conversationId = s?.conversationId ?? (isMeeting ? null : id);
  const jump = (messageId: string | null) =>
    conversationId &&
    router.push({
      pathname: '/conversation/[id]',
      params: messageId ? { id: conversationId, focus: messageId } : { id: conversationId },
    });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: isMeeting ? 'Meeting summary' : 'Summary' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}>
        {!isMeeting ? (
          <Chips
            label="What to summarize"
            options={SUMMARY_RANGES.map((r) => ({ key: r, label: SUMMARY_RANGE_LABEL[r] }))}
            selected={[range]}
            onToggle={(r) => {
              setRange(r);
              setSharing(false);
            }}
          />
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.accent} />
            <Text variant="meta" tone="muted">
              Reading the conversation…
            </Text>
          </View>
        ) : error || blocked || !s ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error ?? `${blocked ?? 'Nothing to show.'} The assistant runs on your server.`}
          </Text>
        ) : (
          <>
            {'title' in s ? (
              <Text variant="title" accessibilityRole="header">
                {s.title}
              </Text>
            ) : null}
            <Glass style={{ padding: space.md, gap: space.sm }}>
              <View style={styles.row}>
                <Ionicons name="sparkles" size={16} color={c.accent} />
                <Text variant="meta" tone="muted" style={{ flex: 1 }}>
                  {s.messageCount} message{s.messageCount === 1 ? '' : 's'}
                  {'transcriptCount' in s && s.transcriptCount
                    ? ` · ${s.transcriptCount} recording transcript${s.transcriptCount === 1 ? '' : 's'}`
                    : ''}
                  {s.engine === 'basic' ? ' · built-in' : ''}
                </Text>
              </View>
              <Text>{s.summary || 'Nothing new to summarize here.'}</Text>
            </Glass>
            <Section title="Highlights" items={s.highlights} icon="star-outline" />
            <Section title="Decisions" items={s.decisions} icon="checkmark-done-outline" />
            {s.actionItems.length ? (
              <View style={{ gap: space.sm }}>
                <Text variant="label" tone="muted">
                  Action items
                </Text>
                {s.actionItems.map((a, i) => (
                  <ActionRow
                    key={i}
                    item={a}
                    who={
                      a.assigneeId ? (a.assigneeId === selfId ? 'You' : nameOf(a.assigneeId)) : null
                    }
                    onJump={a.messageId ? () => jump(a.messageId) : undefined}
                    onTask={
                      conversationId
                        ? () =>
                            router.push({
                              pathname: '/task/new',
                              params: {
                                conversationId,
                                title: a.text,
                                ...(a.messageId ? { messageId: a.messageId } : {}),
                              },
                            })
                        : undefined
                    }
                  />
                ))}
              </View>
            ) : null}
            <Section title="Open questions" items={s.openQuestions} icon="help-circle-outline" />
            {conversationId && s.summary ? (
              sharing ? (
                <AiShare
                  conversationId={conversationId}
                  text={summaryAsMessage(s)}
                  onDone={(sent) => {
                    setSharing(false);
                    setShared(sent);
                  }}
                />
              ) : (
                <Button
                  title={shared ? 'Shared in the conversation' : 'Share in the conversation'}
                  kind="quiet"
                  icon={shared ? 'checkmark' : 'share-outline'}
                  disabled={shared}
                  onPress={() => setSharing(true)}
                />
              )
            ) : null}
            <Text variant="meta" tone="subtle">
              Made from messages you can read. Check anything important before acting on it.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Section({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: 'star-outline' | 'checkmark-done-outline' | 'help-circle-outline';
}) {
  const { theme } = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      {items.map((x, i) => (
        <View key={i} style={styles.row}>
          <Ionicons name={icon} size={16} color={theme.colors.accent} style={{ marginTop: 2 }} />
          <Text style={{ flex: 1 }}>{x}</Text>
        </View>
      ))}
    </View>
  );
}

function ActionRow({
  item,
  who,
  onJump,
  onTask,
}: {
  item: ActionItem;
  who: string | null;
  onJump?: () => void;
  onTask?: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.action, { borderColor: c.border, backgroundColor: alpha(c.text, 0.03) }]}>
      <Pressable
        onPress={onJump}
        disabled={!onJump}
        accessibilityRole={onJump ? 'button' : 'text'}
        accessibilityHint={onJump ? 'Opens the message' : undefined}
        style={{ flex: 1, gap: 2 }}
      >
        <Text>{item.text}</Text>
        {who || item.due ? (
          <Text variant="meta" tone="muted">
            {[who, item.due].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </Pressable>
      {onTask ? (
        <Pressable
          onPress={onTask}
          accessibilityRole="button"
          accessibilityLabel={`Create task: ${item.text}`}
          hitSlop={8}
          style={[styles.taskBtn, { backgroundColor: alpha(c.accent, 0.12) }]}
        >
          <Ionicons name="checkbox-outline" size={16} color={c.accent} />
          <Text variant="label" style={{ color: c.accent }}>
            Task
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
});
