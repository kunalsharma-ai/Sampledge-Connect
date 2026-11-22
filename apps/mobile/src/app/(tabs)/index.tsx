import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PersonAvatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ConnectivityBanner, ConnectivityDot } from '../../components/Connectivity';
import { ConversationRow, relativeTime } from '../../components/ConversationRow';
import { Glass } from '../../components/Glass';
import { NetworkHome } from '../../components/NetworkHome';
import { MeetingRow } from '../../components/MeetingBits';
import { Screen } from '../../components/Screen';
import { ConversationSkeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { TaskRow } from '../../components/WorkRows';
import type { LocalNotification } from '../../db/store';
import type { LocalApproval, LocalTask } from '../../db/work';
import { isUnjoinedChannel } from '../../lib/access';
import { homeSummary, sortMyTasks, waitingOnMe } from '../../lib/home';
import { formatMoney, isOverdue } from '../../lib/work';
import { useApp, useWorkspace } from '../../state/AppProvider';
import {
  conversationTitle,
  useCalls,
  useConversations,
  useMeetings,
  useNotifications,
  useNow,
  usePeople,
  useWorkList,
} from '../../state/hooks';
import { useInNetwork } from '../../state/useNetwork';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';
import { FeatureHelp } from '../../components/FeatureHelp';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Home: your organization's day, or SampConnect Network when that space is showing. */
export default function HomeTab() {
  return useInNetwork() ? <NetworkHome /> : <Home />;
}

function Home() {
  const { theme, org } = useTheme();
  const c = theme.colors;
  const { session, sessionState, engineState } = useApp();
  const { engine, selfId } = useWorkspace();
  const { conversations, loading } = useConversations();
  const nameOf = usePeople();
  const notes = useNotifications();
  const firstName = session?.user.displayName.split(' ')[0];
  const workspaceName =
    sessionState === 'demo'
      ? 'Demo workspace'
      : (org?.organizationName ?? session?.tenant.name ?? 'Workspace');
  const now = useNow();
  const calls = useCalls();
  const win = useMemo(
    () => ({
      from: new Date(Date.now() - 60 * 60_000).toISOString(),
      to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }),
    [],
  );
  const { meetings } = useMeetings(win.from, win.to);
  const tasks = useWorkList<LocalTask>(
    (fresh) => engine.listTasks({ scope: 'mine', status: 'active' }, { fresh }),
    [],
  );
  const approvals = useWorkList<LocalApproval>(
    (fresh) => engine.listApprovals({ scope: 'to_decide', status: 'pending' }, { fresh }),
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);

  const unreadConvs = conversations.filter((x) => x.unread > 0 && !isUnjoinedChannel(x));
  const unread = unreadConvs.reduce((n, x) => n + x.unread, 0);
  const forYou = notes.items.filter((n) => !n.readAt);
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.endsAt) > now);
  const today = upcoming.filter(
    (m) => new Date(m.startsAt).toDateString() === new Date(now).toDateString(),
  );
  const myTasks = tasks.items ? sortMyTasks(tasks.items, now) : null;
  const overdue = myTasks?.filter((t) => isOverdue(t, now)).length ?? 0;
  const waiting = approvals.items ? waitingOnMe(approvals.items, selfId) : null;
  const offline = engineState?.connectivity === 'offline';
  const pending = engineState?.pending ?? 0;

  const where = (id: string | null) => {
    if (!id) return 'No conversation';
    const conv = conversations.find((x) => x.conversationId === id);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'A conversation';
  };
  const openConversation = (id: string, focus?: string) =>
    router.push({ pathname: '/conversation/[id]', params: { id, ...(focus ? { focus } : {}) } });
  const step = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.workspace}>
              {org?.logo && sessionState !== 'demo' ? (
                <Image
                  source={{ uri: org.logo }}
                  style={styles.orgLogo}
                  resizeMode="contain"
                  accessibilityLabel={`${org.displayName} logo`}
                />
              ) : null}
              <ConnectivityDot />
              <Text variant="overline" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {new Date(now).toLocaleDateString([], {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}{' '}
                · {workspaceName}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                marginTop: space.xs,
              }}
            >
              <Text variant="display" style={{ flexShrink: 1 }}>
                {greeting()}
                {firstName ? `, ${firstName}` : ''}
              </Text>
              <FeatureHelp id="home" size={24} />
            </View>
            <Text tone="muted" style={{ marginTop: space.xs }}>
              {homeSummary({
                unread,
                forYou: forYou.length,
                meetingsToday: today.length,
                approvals: waiting?.length ?? 0,
              })}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/search')}
            style={[styles.iconBtn, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Ionicons name="search" size={20} color={c.text} />
          </Pressable>
        </View>
        <ConnectivityBanner />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quick}
        >
          <Quick
            icon="create-outline"
            label="New message"
            onPress={() => router.push('/new-conversation')}
          />
          <Quick
            icon="calendar-outline"
            label="Schedule"
            onPress={() => router.push('/meetings/new')}
          />
          <Quick
            icon="checkbox-outline"
            label="New task"
            onPress={() => router.push('/task/new')}
          />
          <Quick
            icon="happy-outline"
            label="Set status"
            onPress={() => router.push('/settings/status')}
          />
        </ScrollView>

        <View style={styles.stats}>
          <Stat
            label="Unread"
            value={String(unread)}
            sub={unreadConvs.length ? `in ${unreadConvs.length} chats` : 'All read'}
            icon="chatbubble-ellipses-outline"
            onPress={() => router.push('/messages')}
          />
          <Stat
            label="For you"
            value={String(forYou.length)}
            sub={forYou.length ? 'new' : 'None new'}
            icon="at"
            onPress={() => router.push('/activity')}
          />
        </View>
        <View style={[styles.stats, { marginTop: space.md }]}>
          <Stat
            label="My tasks"
            value={myTasks ? String(myTasks.length) : '…'}
            sub={overdue ? `${overdue} overdue` : 'None overdue'}
            danger={overdue > 0}
            icon="checkbox-outline"
            onPress={() => router.push('/tasks')}
          />
          <Stat
            label="Approvals"
            value={waiting ? String(waiting.length) : '…'}
            sub={waiting?.length ? 'waiting on you' : 'Nothing to decide'}
            icon="shield-checkmark-outline"
            onPress={() => router.push('/tasks')}
          />
        </View>
        {pending || offline ? (
          <Text variant="meta" tone="subtle" style={styles.syncNote}>
            {offline ? 'Offline: showing what is saved on this phone. ' : ''}
            {pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to send.` : ''}
          </Text>
        ) : null}

        <Section title="Catch up" action="Messages" onAction={() => router.push('/messages')}>
          <Glass style={styles.card}>
            {loading ? (
              <ConversationSkeleton />
            ) : unreadConvs.length === 0 ? (
              <Empty text="No unread conversations." />
            ) : (
              unreadConvs
                .slice(0, 5)
                .map((x) => (
                  <ConversationRow key={x.conversationId} c={x} nameOf={nameOf} selfId={selfId} />
                ))
            )}
          </Glass>
        </Section>

        <Section title="For you" action="Activity" onAction={() => router.push('/activity')}>
          <Glass style={styles.card}>
            {forYou.length === 0 ? (
              <Empty text="Nothing new for you." />
            ) : (
              forYou.slice(0, 4).map((n) => (
                <Pressable
                  key={n.notificationId}
                  onPress={() => {
                    void engine.markNotificationsRead({ notificationIds: [n.notificationId] });
                    openConversation(n.conversationId, n.messageId);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${nameOf(n.actorId)} ${VERB[n.kind]} in ${where(n.conversationId)}: ${n.preview}`}
                  style={styles.noteRow}
                >
                  <PersonAvatar userId={n.actorId} name={nameOf(n.actorId)} size={34} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text variant="label" numberOfLines={1}>
                      {nameOf(n.actorId)}
                      <Text variant="label" tone="muted">
                        {' '}
                        {VERB[n.kind]} in {where(n.conversationId)}
                      </Text>
                    </Text>
                    <Text variant="meta" tone="muted" numberOfLines={2}>
                      {n.preview}
                    </Text>
                  </View>
                  <Text variant="meta" tone="subtle">
                    {relativeTime(n.createdAt)}
                  </Text>
                </Pressable>
              ))
            )}
          </Glass>
        </Section>

        <Section title="Coming up" action="Meetings" onAction={() => router.push('/meetings')}>
          {upcoming.length === 0 ? (
            <Glass style={styles.card}>
              <Empty text="No meetings in the next 7 days." />
            </Glass>
          ) : (
            <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
              {upcoming.slice(0, 3).map((m) => (
                <MeetingRow
                  key={m.meetingId}
                  m={m}
                  now={now}
                  nameOf={nameOf}
                  canJoin={!!calls.config?.enabled}
                />
              ))}
            </View>
          )}
        </Section>

        <Section title="My tasks" action="All tasks" onAction={() => router.push('/tasks')}>
          {myTasks === null ? (
            <ActivityIndicator color={c.accent} />
          ) : myTasks.length === 0 ? (
            <Glass style={styles.card}>
              <Empty text="No open tasks assigned to you." />
            </Glass>
          ) : (
            <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
              {myTasks.slice(0, 4).map((t) => (
                <TaskRow
                  key={t.taskId}
                  task={t}
                  context={where(t.conversationId)}
                  busy={busy === t.taskId}
                  onOpen={() => router.push({ pathname: '/task/[id]', params: { id: t.taskId } })}
                  onToggleDone={() =>
                    void step(t.taskId, () => engine.updateTask(t.taskId, { status: 'done' }))
                  }
                />
              ))}
            </View>
          )}
        </Section>

        <Section title="Waiting on you">
          {waiting === null ? (
            <ActivityIndicator color={c.accent} />
          ) : waiting.length === 0 ? (
            <Glass style={styles.card}>
              <Empty text="No approvals waiting on your decision." />
            </Glass>
          ) : (
            <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
              {waiting.slice(0, 3).map((a) => (
                <Glass key={a.approvalId} style={{ padding: space.md, gap: space.sm }}>
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/approval/[id]', params: { id: a.approvalId } })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Open approval ${a.title}`}
                  >
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text variant="meta" tone="muted" numberOfLines={1}>
                      From {nameOf(a.requesterId)}
                      {a.amount ? ` · ${formatMoney(a.amount)}` : ''}
                      {a.conversationId ? ` · ${where(a.conversationId)}` : ''}
                    </Text>
                  </Pressable>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button
                      title="Approve"
                      icon="checkmark"
                      busy={busy === a.approvalId}
                      onPress={() =>
                        void step(a.approvalId, () =>
                          engine.decideApproval(a.approvalId, { decision: 'approve', comment: '' }),
                        )
                      }
                      accessibilityLabel={`Approve ${a.title}`}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Reject"
                      icon="close"
                      kind="quiet"
                      disabled={busy === a.approvalId}
                      onPress={() =>
                        void step(a.approvalId, () =>
                          engine.decideApproval(a.approvalId, { decision: 'reject', comment: '' }),
                        )
                      }
                      accessibilityLabel={`Reject ${a.title}`}
                      style={{ flex: 1 }}
                    />
                  </View>
                </Glass>
              ))}
            </View>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const VERB: Record<LocalNotification['kind'], string> = {
  mention: 'mentioned you',
  reply: 'replied',
  task: 'gave you a task',
  approval: 'needs your approval',
  alert: 'posted an update',
};

function Section({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.sectionHead}>
        <Text variant="heading">{title}</Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} accessibilityRole="link">
            <Text variant="label" tone="accent">
              {action}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text tone="muted" style={{ padding: space.lg }}>
      {text}
    </Text>
  );
}

function Quick({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quickBtn,
        {
          backgroundColor: theme.colors.surfaceRaised,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.colors.accent} />
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  danger,
  onPress,
}: {
  label: string;
  value: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}, ${sub}`}
      style={{ flex: 1 }}
    >
      <Glass style={styles.stat}>
        <Ionicons name={icon} size={18} color={theme.colors.accent} />
        <Text variant="title" style={{ marginTop: space.sm }}>
          {value}
        </Text>
        <Text variant="label">{label}</Text>
        <Text variant="meta" tone={danger ? 'danger' : 'muted'}>
          {sub}
        </Text>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
  },
  workspace: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  orgLogo: { width: 22, height: 22, borderRadius: 5 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  stats: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, marginTop: space.sm },
  stat: { flex: 1, padding: space.md, borderRadius: radius.lg },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  card: { marginHorizontal: space.lg, paddingVertical: space.xs },
  quick: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  syncNote: { paddingHorizontal: space.lg, marginTop: space.md },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
