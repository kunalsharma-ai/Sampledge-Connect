import { Ionicons } from '@expo/vector-icons';
import { TASK_STATUSES, type TaskStatus } from '@sampledge/contracts';
import type { LocalTask } from '../../db/work';
import { SyncBanner } from '../../components/SyncBanner';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { dueLabel, Pill, useStatusColor } from '../../components/WorkRows';
import { isOverdue, TASK_KIND_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../lib/work';
import { useWorkspace } from '../../state/AppProvider';
import {
  conversationTitle,
  useConversations,
  usePeople,
  useTenantRole,
  useWorkList,
} from '../../state/hooks';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** One task: what, who, when, where it came from, and its status. */
export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const role = useTenantRole();
  const { conversations } = useConversations();
  const color = useStatusColor();
  const one = useWorkList<LocalTask>(
    (fresh) => engine.getTask(id, { fresh }).then((t) => [t]),
    [id],
  );
  const t = one.items?.[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.queueBlocker();

  if (!t)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Task' }} />
        <View style={styles.center}>
          {one.error || blocked ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {one.error ?? blocked}
            </Text>
          ) : (
            <ActivityIndicator color={c.accent} />
          )}
        </View>
      </Screen>
    );

  const canEdit =
    t.createdBy === selfId ||
    t.assigneeIds.includes(selfId) ||
    role === 'owner' ||
    role === 'admin';
  const conv = t.conversationId
    ? conversations.find((x) => x.conversationId === t.conversationId)
    : undefined;
  const who = (u: string) => (u === selfId ? 'You' : nameOf(u));

  const setStatus = async (status: TaskStatus) => {
    if (status === t.status) return;
    setBusy(true);
    setError(null);
    try {
      await engine.updateTask(t.taskId, { status });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: TASK_KIND_LABEL[t.kind],
          headerRight:
            canEdit && !t.syncError && t.status !== 'cancelled' && t.origin !== 'module'
              ? () => (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/task/new', params: { edit: t.taskId } })
                    }
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit task"
                    style={{ paddingHorizontal: space.sm }}
                  >
                    <Ionicons name="create-outline" size={22} color={c.accent} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">
            {t.title}
          </Text>
          <View style={styles.pills}>
            <Pill label={TASK_STATUS_LABEL[t.status]} color={color(t.status)} />
            <Pill
              label={`${TASK_PRIORITY_LABEL[t.priority]} priority`}
              color={t.priority === 'high' || t.priority === 'urgent' ? c.danger : c.textMuted}
            />
            {t.dueAt ? (
              <Text variant="label" style={{ color: isOverdue(t) ? c.danger : c.textMuted }}>
                {dueLabel(t.dueAt)}
                {isOverdue(t) ? ' · overdue' : ''}
              </Text>
            ) : null}
          </View>
        </View>
        <SyncBanner
          item={t}
          what="task"
          onRetry={() => void engine.retryLocal('task', t.taskId)}
          onDiscard={() => {
            void engine.discardLocal('task', t.taskId);
            router.back();
          }}
        />
        {t.description ? <Text>{t.description}</Text> : null}

        <Glass style={{ padding: space.md, gap: space.md }}>
          <Field label="Assigned to">
            {t.assigneeIds.length ? t.assigneeIds.map(who).join(', ') : 'Nobody yet'}
          </Field>
          <Field label="Created by">
            {who(t.createdBy)} ·{' '}
            {new Date(t.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
          </Field>
          {t.record ? <Field label={t.record.module}>{t.record.title}</Field> : null}
        </Glass>

        {t.conversationId ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/conversation/[id]',
                params: t.sourceMessageId
                  ? { id: t.conversationId!, focus: t.sourceMessageId }
                  : { id: t.conversationId! },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Open the message in its conversation"
          >
            <Glass style={styles.source}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={c.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" tone="muted">
                  From {conv ? conversationTitle(conv, nameOf, selfId) : 'a conversation'}
                </Text>
                {t.sourceExcerpt ? (
                  <Text numberOfLines={3} style={{ fontStyle: 'italic' }}>
                    “{t.sourceExcerpt}”
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Glass>
          </Pressable>
        ) : null}

        {t.record?.url ? (
          <Pressable onPress={() => void Linking.openURL(t.record!.url!)} accessibilityRole="link">
            <Text variant="label" style={{ color: c.accent }}>
              Open in {t.record.module}
            </Text>
          </Pressable>
        ) : null}

        <View style={{ gap: 6 }}>
          <View style={styles.pills}>
            <Text variant="label" tone="muted">
              Status
            </Text>
            {busy ? <ActivityIndicator size="small" color={c.accent} /> : null}
          </View>
          {canEdit && !t.syncError ? (
            <Chips
              label="Status"
              options={TASK_STATUSES.map((s) => ({ key: s, label: TASK_STATUS_LABEL[s] }))}
              selected={[t.status]}
              onToggle={(s) => void setStatus(s)}
            />
          ) : (
            <Text variant="meta" tone="muted">
              Only the creator, the people assigned, and admins can change this task.
            </Text>
          )}
        </View>
        {error || blocked ? (
          <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
            {error ?? `${blocked}`}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
});
