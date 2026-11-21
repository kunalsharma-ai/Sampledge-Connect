import { Ionicons } from '@expo/vector-icons';
import type { Approval, Task } from '@sampledge/contracts';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  APPROVAL_CATEGORY_LABEL,
  APPROVAL_STATUS_LABEL,
  approvalProgress,
  formatMoney,
  isMyTurn,
  isOverdue,
  TASK_KIND_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type WorkCardMeta,
} from '../lib/work';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Glass } from './Glass';
import { Text } from './Text';

export function dueLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return 'Due yesterday';
  return `Due ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: alpha(color, 0.14) }]}>
      <Text variant="meta" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

export function useStatusColor() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (status: string): string =>
    status === 'done' || status === 'approved'
      ? c.success
      : status === 'blocked' || status === 'rejected'
        ? c.danger
        : status === 'cancelled'
          ? c.textSubtle
          : status === 'in_progress'
            ? c.accent
            : c.warning;
}

/** One task in a list: tick it done, or tap for details. */
export function TaskRow({
  task: t,
  context,
  busy,
  onOpen,
  onToggleDone,
}: {
  task: Task;
  /** Who it is for, or where it came from. */
  context: string;
  busy?: boolean;
  onOpen: () => void;
  onToggleDone?: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = useStatusColor();
  const done = t.status === 'done';
  const overdue = isOverdue(t);
  return (
    <Glass>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${t.title}. ${TASK_STATUS_LABEL[t.status]}, ${TASK_PRIORITY_LABEL[t.priority]} priority${t.dueAt ? `, ${dueLabel(t.dueAt)}` : ''}. Open task`}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: alpha(c.accent, 0.06) }]}
      >
        {onToggleDone ? (
          <Pressable
            onPress={onToggleDone}
            disabled={busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
            hitSlop={8}
          >
            {busy ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <Ionicons
                name={done ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={done ? c.success : c.textSubtle}
              />
            )}
          </Pressable>
        ) : (
          <Ionicons name="checkbox-outline" size={22} color={c.accent} />
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            variant="bodyStrong"
            numberOfLines={2}
            style={done ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}
          >
            {t.title}
          </Text>
          <View style={styles.pills}>
            <Pill label={TASK_STATUS_LABEL[t.status]} color={color(t.status)} />
            {t.kind !== 'task' ? <Pill label={TASK_KIND_LABEL[t.kind]} color={c.accent} /> : null}
            {t.priority === 'high' || t.priority === 'urgent' ? (
              <Pill label={TASK_PRIORITY_LABEL[t.priority]} color={c.danger} />
            ) : null}
            {t.dueAt ? (
              <Text variant="meta" style={{ color: overdue ? c.danger : c.textMuted }}>
                {dueLabel(t.dueAt)}
              </Text>
            ) : null}
          </View>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {context}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
      </Pressable>
    </Glass>
  );
}

/** One approval in a list, flagged when it waits for you. */
export function ApprovalRow({
  approval: a,
  selfId,
  context,
  onOpen,
}: {
  approval: Approval;
  selfId: string;
  context: string;
  onOpen: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = useStatusColor();
  const turn = isMyTurn(a, selfId);
  return (
    <Glass>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${a.title}. ${APPROVAL_STATUS_LABEL[a.status]}${a.amount ? `, ${formatMoney(a.amount)}` : ''}${turn ? '. Waiting for your decision' : ''}. Open approval`}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: alpha(c.accent, 0.06) }]}
      >
        <Ionicons
          name={turn ? 'hand-left-outline' : 'shield-checkmark-outline'}
          size={22}
          color={turn ? c.warning : c.accent}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {a.title}
          </Text>
          <View style={styles.pills}>
            <Pill label={APPROVAL_STATUS_LABEL[a.status]} color={color(a.status)} />
            <Pill label={APPROVAL_CATEGORY_LABEL[a.category]} color={c.accent} />
            {a.amount ? (
              <Text variant="label" tone="muted">
                {formatMoney(a.amount)}
              </Text>
            ) : null}
          </View>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {turn ? 'Your decision · ' : ''}
            {context} · {approvalProgress(a)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
      </Pressable>
    </Glass>
  );
}

/** The card a task or approval posts in its conversation. Tap to open it. */
export function WorkCard({ work: w, time }: { work: WorkCardMeta; time: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = useStatusColor();
  const task = w.kind === 'task';
  const status =
    (task
      ? TASK_STATUS_LABEL[w.status as Task['status']]
      : APPROVAL_STATUS_LABEL[w.status as Approval['status']]) ?? w.status;
  return (
    <Pressable
      onPress={() =>
        router.push(
          task
            ? { pathname: '/task/[id]', params: { id: w.id } }
            : { pathname: '/approval/[id]', params: { id: w.id } },
        )
      }
      accessibilityRole="button"
      accessibilityLabel={`${task ? 'Task' : 'Approval'}: ${w.title}. ${status}. ${w.summary}. Open ${task ? 'task' : 'approval'}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? alpha(c.accent, 0.1) : c.surfaceRaised,
          borderColor: c.border,
        },
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: alpha(c.accent, 0.14) }]}>
        <Ionicons
          name={task ? 'checkbox-outline' : 'shield-checkmark-outline'}
          size={18}
          color={c.accent}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="meta" tone="muted">
          {task ? 'Task' : 'Approval'} · {time}
        </Text>
        <Text variant="bodyStrong" numberOfLines={2}>
          {w.title}
        </Text>
        <View style={styles.pills}>
          {status ? <Pill label={status} color={color(w.status)} /> : null}
          {w.summary ? (
            <Text variant="meta" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {w.summary}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 420,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
});
