import {
  TASK_KINDS,
  TASK_PRIORITIES,
  type TaskKind,
  type TaskPriority,
  type UpdateTaskRequest,
} from '@sampledge/contracts';
import type { LocalTask } from '../../db/work';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { dueChoices, TASK_KIND_LABEL, TASK_PRIORITY_LABEL, titleFrom } from '../../lib/work';
import { useWorkspace } from '../../state/AppProvider';
import { useMessages, usePeopleChoices } from '../../state/hooks';
import { radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * New task, from a message (chat-to-task) or on its own, or (with `edit`) changes to one.
 * Works offline: it is created or changed on reconnect.
 */
export default function NewTask() {
  const {
    conversationId: convParam,
    messageId,
    title: titleParam,
    edit,
  } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
    /** Suggested title, e.g. an AI action item. */
    title?: string;
    /** Edit this task instead of making one. */
    edit?: string;
  }>();
  const [original, setOriginal] = useState<LocalTask | null>(null);
  const conversationId = convParam ?? original?.conversationId ?? undefined;
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { messages } = useMessages(conversationId ?? '');
  const source = messageId ? messages.find((m) => m.messageId === messageId) : undefined;
  const people = usePeopleChoices(conversationId);
  const due = useMemo(() => dueChoices(new Date()), []);

  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [kind, setKind] = useState<TaskKind>('task');
  const [dueKey, setDueKey] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.queueBlocker();
  const shownTitle = title ?? (titleParam ? titleParam.slice(0, 200) : titleFrom(source?.text));

  useEffect(() => {
    if (!edit) return;
    void engine.getTask(edit).then((t) => {
      setOriginal(t);
      setTitle(t.title);
      setDescription(t.description);
      setAssignees(t.assigneeIds);
      setPriority(t.priority);
      setKind(t.kind);
      setDueKey(t.dueAt ? 'keep' : 'none');
    });
  }, [edit, engine]);
  const dueOptions = original?.dueAt
    ? [
        {
          key: 'keep',
          label: `Keep ${new Date(original.dueAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`,
          at: new Date(original.dueAt),
        },
        ...due,
      ]
    : due;

  const saveEdit = async (t: LocalTask) => {
    if (!shownTitle.trim()) return setError('Give the task a title.');
    const at =
      dueKey === 'keep' ? t.dueAt : (due.find((d) => d.key === dueKey)?.at?.toISOString() ?? null);
    const patch: UpdateTaskRequest = {};
    if (shownTitle.trim() !== t.title) patch.title = shownTitle.trim();
    if (description.trim() !== t.description) patch.description = description.trim();
    if (priority !== t.priority) patch.priority = priority;
    if (at !== t.dueAt) patch.dueAt = at;
    if (assignees.join() !== t.assigneeIds.join()) patch.assigneeIds = assignees;
    if (!Object.keys(patch).length) return router.back();
    setBusy(true);
    try {
      await engine.updateTask(t.taskId, patch);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const save = async () => {
    if (original) return saveEdit(original);
    if (!shownTitle.trim()) return setError('Give the task a title.');
    setBusy(true);
    setError(null);
    try {
      const at = due.find((d) => d.key === dueKey)?.at ?? null;
      const task = await engine.createTask({
        title: shownTitle.trim(),
        description: description.trim(),
        kind,
        priority,
        assigneeIds: assignees,
        dueAt: at ? at.toISOString() : null,
        conversationId: conversationId ?? null,
        sourceMessageId: messageId ?? null,
      });
      router.replace({ pathname: '/task/[id]', params: { id: task.taskId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: edit ? 'Edit task' : 'New task' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {source ? (
            <View style={[styles.quote, { borderColor: c.accent }]}>
              <Text variant="meta" tone="muted" numberOfLines={3}>
                {source.text}
              </Text>
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Title
            </Text>
            <TextInput
              value={shownTitle}
              onChangeText={(t) => {
                setTitle(t);
                setError(null);
              }}
              placeholder="What needs doing?"
              placeholderTextColor={c.textSubtle}
              maxLength={200}
              accessibilityLabel="Title"
              style={input}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Details (optional)
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Anything the assignee should know"
              placeholderTextColor={c.textSubtle}
              maxLength={4000}
              multiline
              accessibilityLabel="Details"
              style={[input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Assign to
            </Text>
            <Chips
              label="Assign to"
              multi
              options={people}
              selected={assignees}
              onToggle={(u) =>
                setAssignees((all) => (all.includes(u) ? all.filter((x) => x !== u) : [...all, u]))
              }
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Due
            </Text>
            <Chips label="Due" options={dueOptions} selected={[dueKey]} onToggle={setDueKey} />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Priority
            </Text>
            <Chips
              label="Priority"
              options={TASK_PRIORITIES.map((p) => ({ key: p, label: TASK_PRIORITY_LABEL[p] }))}
              selected={[priority]}
              onToggle={setPriority}
            />
          </View>
          {edit ? null : (
            <View style={{ gap: 6 }}>
              <Text variant="label" tone="muted">
                Kind
              </Text>
              <Chips
                label="Kind"
                options={TASK_KINDS.map((k) => ({ key: k, label: TASK_KIND_LABEL[k] }))}
                selected={[kind]}
                onToggle={setKind}
              />
            </View>
          )}
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? `${blocked}`}
            </Text>
          ) : null}
          <Button
            title={edit ? 'Save changes' : 'Create task'}
            icon="checkbox-outline"
            busy={busy}
            disabled={!!blocked || (!!edit && !original)}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quote: { borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: 2 },
});
