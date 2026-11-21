import { Ionicons } from '@expo/vector-icons';
import type { Approval, Task } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { ApprovalRow, TaskRow } from '../components/WorkRows';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople, useWorkList } from '../state/hooks';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Tab = 'mine' | 'created' | 'to_decide' | 'requested';
const TABS: { key: Tab; label: string }[] = [
  { key: 'mine', label: 'My tasks' },
  { key: 'to_decide', label: 'To decide' },
  { key: 'created', label: 'Created by me' },
  { key: 'requested', label: 'Requested' },
];

/** Tasks & Approvals: your work across conversations. Kept on the server; needs a connection. */
export default function Tasks() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const [tab, setTab] = useState<Tab>('mine');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taskTab = tab === 'mine' || tab === 'created';
  const tasks = useWorkList<Task>(
    () =>
      taskTab
        ? engine.listTasks({ scope: tab, status: done ? 'done' : 'active' })
        : Promise.resolve([]),
    [tab, done],
  );
  const approvals = useWorkList<Approval>(
    () =>
      !taskTab
        ? engine.listApprovals({
            scope: tab as 'to_decide' | 'requested',
            status: done ? 'decided' : 'pending',
          })
        : Promise.resolve([]),
    [tab, done],
  );
  const list = taskTab ? tasks : approvals;
  const blocked = engine.serverActionBlocker();

  const where = (id: string | null) => {
    if (!id) return 'No conversation';
    const conv = conversations.find((x) => x.conversationId === id);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'A conversation';
  };
  const people = (ids: string[]) =>
    ids.length ? ids.map((u) => (u === selfId ? 'you' : nameOf(u))).join(', ') : 'Unassigned';

  const toggle = async (t: Task) => {
    setBusy(t.taskId);
    setError(null);
    try {
      await engine.updateTask(t.taskId, { status: t.status === 'done' ? 'open' : 'done' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const note =
    error ??
    list.error ??
    (blocked ? `${blocked} Tasks and approvals are kept on the server.` : null);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Tasks & Approvals',
          headerRight: () => (
            <Pressable
              onPress={() => router.push(taskTab ? '/task/new' : '/approval/new')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={taskTab ? 'New task' : 'Request approval'}
              style={{ paddingHorizontal: space.sm }}
            >
              <Ionicons name="add-circle-outline" size={24} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          accessibilityRole="tablist"
        >
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : alpha(c.text, 0.06),
                    borderColor: on ? c.accent : c.border,
                  },
                ]}
              >
                <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList<Task | Approval>
        data={(list.items ?? []) as (Task | Approval)[]}
        keyExtractor={(x) => ('taskId' in x ? x.taskId : x.approvalId)}
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: space.xs,
          gap: space.md,
          paddingBottom: 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={list.loading && !!list.items}
            onRefresh={list.reload}
            tintColor={c.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space.sm }}>
            {note ? (
              <View
                style={[
                  styles.note,
                  { backgroundColor: alpha(error || list.error ? c.danger : c.warning, 0.12) },
                ]}
              >
                <Text variant="meta" style={{ color: error || list.error ? c.danger : c.warning }}>
                  {note}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => setDone((d) => !d)}
              accessibilityRole="switch"
              accessibilityState={{ checked: done }}
              accessibilityLabel={taskTab ? 'Show finished tasks' : 'Show decided approvals'}
              style={styles.toggle}
            >
              <Ionicons name={done ? 'checkbox' : 'square-outline'} size={18} color={c.accent} />
              <Text variant="label" tone="muted">
                {taskTab ? 'Show finished' : 'Show decided'}
              </Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) =>
          'taskId' in item ? (
            <TaskRow
              task={item}
              context={`${tab === 'created' ? `For ${people(item.assigneeIds)}` : where(item.conversationId)}`}
              busy={busy === item.taskId}
              onOpen={() => router.push({ pathname: '/task/[id]', params: { id: item.taskId } })}
              onToggleDone={blocked ? undefined : () => void toggle(item)}
            />
          ) : (
            <ApprovalRow
              approval={item}
              selfId={selfId}
              context={
                tab === 'requested'
                  ? `Asked ${people(item.approverIds)}`
                  : `From ${item.requesterId === selfId ? 'you' : nameOf(item.requesterId)}`
              }
              onOpen={() =>
                router.push({ pathname: '/approval/[id]', params: { id: item.approvalId } })
              }
            />
          )
        }
        ListEmptyComponent={
          list.items ? (
            <View style={styles.empty}>
              <Ionicons
                name={taskTab ? 'checkbox-outline' : 'shield-checkmark-outline'}
                size={36}
                color={c.textSubtle}
              />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {tab === 'mine'
                  ? done
                    ? 'No finished tasks yet.'
                    : 'Nothing assigned to you. Long-press a message and choose Create task to turn it into work.'
                  : tab === 'created'
                    ? 'You have not created any tasks.'
                    : tab === 'to_decide'
                      ? done
                        ? 'No approvals decided yet.'
                        : 'Nothing waiting for your decision.'
                      : 'You have not asked for any approvals. Long-press a message and choose Request approval.'}
              </Text>
            </View>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { padding: space.md, borderRadius: radius.md },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
});
