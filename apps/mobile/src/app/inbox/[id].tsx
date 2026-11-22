import { Ionicons } from '@expo/vector-icons';
import { renderTemplate, type InboxTemplate } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ConnectivityBanner } from '../../components/Connectivity';
import {
  Pill,
  PriorityDot,
  ProviderMark,
  SlaPill,
  TestModeBadge,
} from '../../components/InboxBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  deliveryLabel,
  isHandoff,
  itemAt,
  PROVIDER_META,
  STATUS_LABEL,
  templateQuery,
  type LocalTimelineItem,
} from '../../lib/inbox';
import { clock, dayLabel } from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useNow, usePeople } from '../../state/hooks';
import { useInboxConversation, useInboxTemplates } from '../../state/useInbox';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Mode = 'reply' | 'note';

/**
 * One client conversation: client messages, your replies with their delivery state, internal
 * notes (amber, never sent to the client) and what changed. Replies and notes are saved on this
 * phone first and sent in order when online; other agents and your devices see them live.
 */
export default function InboxConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState, session } = useApp();
  const nameOf = usePeople();
  const now = useNow();
  const { detail, timeline, loading, error } = useInboxConversation(id);
  const templates = useInboxTemplates();
  const [mode, setMode] = useState<Mode>('reply');
  const [text, setText] = useState('');
  const [template, setTemplate] = useState<InboxTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const conv = detail?.conversation;
  const offline = engineState?.connectivity === 'offline';

  // Opening it, or a client message arriving while it is open, marks it read on all your devices.
  useEffect(() => {
    if (conv?.unread) void engine.inboxMarkRead(conv.conversationId);
  }, [engine, conv?.unread, conv?.conversationId, conv?.lastMessage?.at]);

  const slash = templateQuery(text);
  const suggestions = useMemo(
    () =>
      slash === null || mode !== 'reply'
        ? []
        : templates
            .filter(
              (t) =>
                (t.shortcut ?? '').startsWith(slash) ||
                t.name.toLowerCase().includes(slash.toLowerCase()),
            )
            .slice(0, 5),
    [slash, templates, mode],
  );

  const applyTemplate = (t: InboxTemplate) => {
    if (!detail) return;
    setText(
      renderTemplate(t.body, {
        clientName: detail.client.name,
        clientCompany: detail.client.company,
        agentName: session?.user.displayName ?? nameOf(selfId),
      }),
    );
    setTemplate(t);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !conv) return;
    setBusy(true);
    setNote(null);
    try {
      if (mode === 'reply')
        await engine.inboxReply(conv.conversationId, body, template?.templateId);
      else await engine.inboxNote(conv.conversationId, body);
      setText('');
      setTemplate(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const serverDo = async (run: () => Promise<unknown>) => {
    setNote(null);
    try {
      await run();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const rows = useMemo(() => [...timeline].reverse(), [timeline]);

  if (!detail || !conv)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Client conversation' }} />
        <View style={styles.center}>
          {loading ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {error
                ? error.code === 'NOT_FOUND'
                  ? 'This conversation is no longer in your inbox.'
                  : error.message
                : 'This conversation has not been opened on this phone yet. It loads when you are online.'}
            </Text>
          )}
        </View>
      </Screen>
    );

  const handoff = conv.channelMode === 'handoff';
  const assignedToMe = conv.assigneeId === selfId;
  const resolved = conv.status === 'resolved';

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: detail.client.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/inbox/details/${conv.conversationId}`)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Client and conversation details"
              style={{ paddingHorizontal: space.sm }}
            >
              <Ionicons name="information-circle-outline" size={24} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      <ConnectivityBanner />
      <Pressable
        onPress={() => router.push(`/inbox/details/${conv.conversationId}`)}
        accessibilityRole="button"
        accessibilityLabel="Open details"
        style={[styles.summary, { borderBottomColor: c.border, backgroundColor: c.surface }]}
      >
        <ProviderMark provider={conv.provider} size={32} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text variant="label" numberOfLines={1}>
            {conv.subject}
          </Text>
          <View style={styles.pills}>
            <PriorityDot priority={conv.priority} />
            <Pill text={STATUS_LABEL[conv.status]} tone={resolved ? 'success' : 'muted'} />
            <SlaPill sla={conv.sla} now={now} />
            {conv.escalation ? <Pill text="Escalated" tone="danger" icon="flag-outline" /> : null}
            {conv.testMode ? <TestModeBadge /> : null}
            <Text variant="meta" tone="subtle" numberOfLines={1}>
              {conv.assigneeId
                ? assignedToMe
                  ? 'Assigned to you'
                  : `Assigned to ${nameOf(conv.assigneeId)}`
                : 'Unassigned'}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
      </Pressable>
      <View style={[styles.quick, { borderBottomColor: c.border }]}>
        {!assignedToMe ? (
          <QuickAction
            icon="person-add-outline"
            label="Assign to me"
            onPress={() => void engine.inboxUpdate(conv.conversationId, { assigneeId: selfId })}
          />
        ) : null}
        <QuickAction
          icon={resolved ? 'refresh-outline' : 'checkmark-done-outline'}
          label={resolved ? 'Reopen' : 'Resolve'}
          onPress={() =>
            void engine.inboxUpdate(conv.conversationId, { status: resolved ? 'open' : 'resolved' })
          }
        />
        {handoff ? (
          <QuickAction
            icon="download-outline"
            label="Log client message"
            onPress={() => router.push(`/inbox/details/${conv.conversationId}?log=1`)}
          />
        ) : null}
      </View>
      {note ? (
        <View style={[styles.banner, { backgroundColor: alpha(c.danger, 0.12) }]}>
          <Text variant="meta" style={{ color: c.danger }}>
            {note}
          </Text>
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          data={rows}
          inverted
          keyExtractor={(t) =>
            t.type === 'message'
              ? t.message.messageId
              : t.type === 'note'
                ? t.note.noteId
                : t.activity.activityId
          }
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          renderItem={({ item, index }) => {
            const older = rows[index + 1];
            const day = new Date(itemAt(item));
            const newDay = !older || dayLabel(new Date(itemAt(older))) !== dayLabel(day);
            return (
              <View style={{ gap: space.sm }}>
                {newDay ? (
                  <Text
                    variant="overline"
                    tone="subtle"
                    style={{ textAlign: 'center', marginTop: space.sm }}
                  >
                    {dayLabel(day)}
                  </Text>
                ) : null}
                <TimelineItem
                  item={item}
                  provider={conv.provider}
                  clientName={detail.client.name}
                  nameOf={(u) => (u === selfId ? 'You' : nameOf(u))}
                  onRetryPost={(a) => void engine.inboxRetry(a)}
                  onDiscardPost={(a) => void engine.inboxDiscard(a)}
                  onRetryDelivery={(messageId) =>
                    void serverDo(() =>
                      engine.inboxServer(
                        'POST',
                        `/v1/inbox/conversations/${conv.conversationId}/replies/${messageId}/retry`,
                        undefined,
                        conv.conversationId,
                      ),
                    )
                  }
                />
              </View>
            );
          }}
        />
        {suggestions.length ? (
          <View
            style={[styles.suggest, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          >
            {suggestions.map((t) => (
              <Pressable
                key={t.templateId}
                onPress={() => applyTemplate(t)}
                accessibilityRole="button"
                accessibilityLabel={`Use template ${t.name}`}
                style={styles.suggestRow}
              >
                <Text variant="label" tone="accent">
                  /{t.shortcut ?? ''}
                </Text>
                <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                  {t.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View
          style={[
            styles.composer,
            {
              borderTopColor: c.border,
              backgroundColor: mode === 'note' ? alpha(c.warning, 0.08) : c.surface,
            },
          ]}
        >
          <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Write a">
            {(['reply', 'note'] as const).map((m) => {
              const on = m === mode;
              const tint = m === 'note' ? c.warning : c.accent;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  style={[
                    styles.mode,
                    {
                      backgroundColor: on ? alpha(tint, 0.16) : 'transparent',
                      borderColor: on ? alpha(tint, 0.5) : c.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={m === 'reply' ? 'arrow-undo-outline' : 'lock-closed-outline'}
                    size={13}
                    color={on ? tint : c.textMuted}
                  />
                  <Text
                    variant="meta"
                    style={{ color: on ? tint : c.textMuted, fontWeight: '600' }}
                  >
                    {m === 'reply'
                      ? `Reply on ${PROVIDER_META[conv.provider].name}`
                      : 'Internal note'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (!t) setTemplate(null);
              }}
              multiline
              placeholder={
                mode === 'note'
                  ? 'Only agents see notes. Never sent to the client.'
                  : handoff
                    ? `Write the reply, then send it in ${PROVIDER_META[conv.provider].name}`
                    : templates.length
                      ? 'Reply to the client, or type / for a template'
                      : 'Reply to the client'
              }
              placeholderTextColor={c.textSubtle}
              accessibilityLabel={mode === 'note' ? 'Internal note' : 'Reply to the client'}
              style={[
                typeScale.body,
                styles.input,
                { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
              ]}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!text.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel={mode === 'note' ? 'Add note' : 'Send reply'}
              style={[
                styles.send,
                {
                  backgroundColor: mode === 'note' ? c.warning : c.accent,
                  opacity: !text.trim() || busy ? 0.5 : 1,
                },
              ]}
            >
              <Ionicons
                name={mode === 'note' ? 'document-text-outline' : 'send'}
                size={18}
                color={mode === 'note' ? '#1A1300' : c.onAccent}
              />
            </Pressable>
          </View>
          {offline ? (
            <Text variant="meta" tone="subtle">
              Offline: what you write is kept on this phone and sent when you reconnect.
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quickBtn,
        {
          borderColor: c.border,
          backgroundColor: pressed ? alpha(c.accent, 0.12) : c.surfaceRaised,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={c.accent} />
      <Text variant="meta" tone="accent" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function TimelineItem({
  item,
  provider,
  clientName,
  nameOf,
  onRetryPost,
  onDiscardPost,
  onRetryDelivery,
}: {
  item: LocalTimelineItem;
  provider: Parameters<typeof deliveryLabel>[1];
  clientName: string;
  nameOf: (userId: string) => string;
  onRetryPost: (actionId: string) => void;
  onDiscardPost: (actionId: string) => void;
  onRetryDelivery: (messageId: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  if (item.type === 'activity')
    return (
      <Text variant="meta" tone="subtle" style={{ textAlign: 'center' }}>
        {item.activity.actorId ? `${nameOf(item.activity.actorId)}: ` : ''}
        {item.activity.summary} · {clock(item.activity.createdAt)}
      </Text>
    );
  if (item.type === 'note') {
    const n = item.note;
    return (
      <View
        style={[
          styles.note,
          { backgroundColor: alpha(c.warning, 0.12), borderColor: alpha(c.warning, 0.4) },
        ]}
        accessibilityLabel={`Internal note from ${nameOf(n.authorId)}: ${n.text}`}
      >
        <View style={styles.noteHead}>
          <Ionicons name="lock-closed" size={11} color={c.warning} />
          <Text variant="meta" style={{ color: c.warning, fontWeight: '600' }}>
            Internal note · {nameOf(n.authorId)}
          </Text>
          <View style={{ flex: 1 }} />
          <Text variant="meta" tone="subtle">
            {n.pendingLocal ? (n.syncError ? 'Not saved' : 'Saving…') : clock(n.createdAt)}
          </Text>
        </View>
        <Text>{n.text}</Text>
        {n.syncError && item.actionId ? (
          <PostFailed
            error={n.syncError}
            onRetry={() => onRetryPost(item.actionId!)}
            onDiscard={() => onDiscardPost(item.actionId!)}
          />
        ) : null}
      </View>
    );
  }
  const m = item.message;
  const out = m.direction === 'outbound';
  const failed = !!m.syncError || m.deliveryState === 'failed';
  return (
    <View style={{ alignItems: out ? 'flex-end' : 'flex-start' }}>
      <Text variant="meta" tone="subtle" style={{ marginBottom: 2, marginHorizontal: 4 }}>
        {out ? (m.authorId ? nameOf(m.authorId) : 'Agent') : clientName} · {clock(m.createdAt)}
      </Text>
      <View
        style={[
          styles.bubble,
          out
            ? { backgroundColor: c.bubbleOwn, borderBottomRightRadius: 4 }
            : { backgroundColor: c.bubbleOther, borderBottomLeftRadius: 4 },
        ]}
      >
        <Text style={{ color: out ? c.bubbleOwnText : c.text }}>{m.text}</Text>
        {m.attachments.length ? (
          <Text variant="meta" style={{ color: out ? c.bubbleOwnText : c.textMuted, marginTop: 4 }}>
            {m.attachments.map((a) => a.name).join(', ')}
          </Text>
        ) : null}
      </View>
      {out ? (
        <View style={[styles.delivery]}>
          {m.deliveryState === 'handoff' && m.handoffUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(m.handoffUrl!)}
              accessibilityRole="link"
              accessibilityLabel={`Send it in ${PROVIDER_META[provider].name}`}
              style={styles.line}
            >
              <Ionicons name="open-outline" size={12} color={c.accent} />
              <Text variant="meta" tone="accent" style={{ fontWeight: '600' }}>
                Send it in {PROVIDER_META[provider].name}
              </Text>
            </Pressable>
          ) : (
            <Text
              variant="meta"
              style={{
                color: failed
                  ? c.danger
                  : m.deliveryState === 'test'
                    ? c.accentSecondary
                    : m.deliveryState === 'delivered' || m.deliveryState === 'read'
                      ? c.accent
                      : c.textSubtle,
              }}
            >
              {deliveryLabel(m, provider)}
            </Text>
          )}
          {m.deliveryState === 'failed' && !m.pendingLocal ? (
            <Pressable
              onPress={() => onRetryDelivery(m.messageId)}
              accessibilityRole="button"
              accessibilityLabel="Retry delivery"
              hitSlop={6}
            >
              <Text variant="meta" tone="accent" style={{ fontWeight: '600' }}>
                Retry
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {m.syncError && item.type === 'message' && item.actionId ? (
        <PostFailed
          error={m.syncError}
          onRetry={() => onRetryPost(item.actionId!)}
          onDiscard={() => onDiscardPost(item.actionId!)}
        />
      ) : null}
    </View>
  );
}

function PostFailed({
  error,
  onRetry,
  onDiscard,
}: {
  error: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <View
      style={[styles.line, { marginTop: 4, gap: space.md }]}
      accessibilityLabel={`Not sent: ${error}`}
    >
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Send again"
        hitSlop={6}
      >
        <Text variant="meta" tone="accent" style={{ fontWeight: '600' }}>
          Send again
        </Text>
      </Pressable>
      <Pressable
        onPress={onDiscard}
        accessibilityRole="button"
        accessibilityLabel="Discard"
        hitSlop={6}
      >
        <Text variant="meta" tone="danger" style={{ fontWeight: '600' }}>
          Discard
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pills: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  quick: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.sm,
  },
  bubble: {
    maxWidth: '84%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
  },
  delivery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: 3,
    marginHorizontal: 4,
  },
  note: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: space.md,
    gap: 4,
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggest: {
    marginHorizontal: space.lg,
    marginBottom: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  modes: { flexDirection: 'row', gap: space.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingTop: 10,
    paddingBottom: 10,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
