import { Ionicons } from '@expo/vector-icons';
import { TYPING_TTL_MS } from '@sampledge/contracts';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Composer, type ComposerMode } from '../../components/Composer';
import { ConnectivityBanner } from '../../components/Connectivity';
import { NOTIFY_ICON, NotifyLevelSheet } from '../../components/NotifyLevelSheet';
import { MessageActions, type MessageAction } from '../../components/MessageActions';
import { MessageBubble, type ReplyPreview } from '../../components/MessageBubble';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import type { LocalConversation, LocalMessage } from '../../db/store';
import type { MentionCandidate } from '../../lib/mentions';
import { CallBanner } from '../../calls/CallBanner';
import { Button } from '../../components/Button';
import { isUnjoinedChannel } from '../../lib/access';
import { guestSenderLabel } from '../../lib/guests';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useCalls, useMessages, usePeople } from '../../state/hooks';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { store, engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { messages } = useMessages(id);
  const [conv, setConv] = useState<LocalConversation | undefined>();
  const [typers, setTypers] = useState<Record<string, number>>({});
  const firstRender = useRef(true);
  const list = useRef<FlatList<LocalMessage>>(null);
  const [sheetFor, setSheetFor] = useState<LocalMessage | null>(null);
  const [mode, setMode] = useState<ComposerMode>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const calls = useCalls();
  const { engineState } = useApp();
  const online =
    engineState?.connectivity === 'online' || engineState?.connectivity === 'connecting';
  const callsOn = !!calls.config?.enabled;
  const liveCall = calls.live[id] ?? null;
  const startCall = async (media: 'audio' | 'video') => {
    const cur = await engine.calls.start(id, media);
    if (cur) router.push({ pathname: '/call/[id]', params: { id: cur.call.callId } });
  };
  const joinCall = async (media: 'audio' | 'video') => {
    if (!liveCall) return;
    const cur = await engine.calls.join(liveCall.callId, media);
    if (cur) router.push({ pathname: '/call/[id]', params: { id: cur.call.callId } });
  };
  const atBottom = useRef(true);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const join = async () => {
    setJoinBusy(true);
    setJoinError(null);
    try {
      await engine.joinChannel(id);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoinBusy(false);
    }
  };
  const openInfo = () => router.push({ pathname: '/conversation-info/[id]', params: { id } });

  useEffect(() => {
    const load = () => void store.getConversation(id).then(setConv);
    load();
    return store.events.on('conversations', load);
  }, [store, id]);

  // Mark as read up to the newest server message while the screen is showing (not while it
  // sits under another screen, such as a call with its chat opened on top).
  const focused = useIsFocused();
  const newestSeq = useMemo(
    () => messages.reduce((n, m) => Math.max(n, m.serverSeq ?? 0), 0),
    [messages],
  );
  useEffect(() => {
    if (focused && newestSeq > 0) void engine.markRead(id, newestSeq);
  }, [engine, id, newestSeq, focused]);

  // Opening a conversation clears its mentions and replies, here and on your other devices.
  useEffect(() => {
    if (!focused) return;
    const clear = () => void engine.markNotificationsRead({ conversationId: id });
    clear();
    return store.events.on('notifications', clear);
  }, [engine, store, id, focused]);

  useEffect(
    () =>
      engine.onTyping((e) => {
        if (e.conversationId !== id || e.userId === selfId) return;
        setTypers((t) => {
          const next = { ...t };
          if (e.typing) next[e.userId] = Date.now() + TYPING_TTL_MS;
          else delete next[e.userId];
          return next;
        });
      }),
    [engine, id, selfId],
  );
  useEffect(() => {
    const t = setInterval(
      () =>
        setTypers((cur) =>
          Object.fromEntries(Object.entries(cur).filter(([, exp]) => exp > Date.now())),
        ),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => (firstRender.current = false), 300);
    return () => clearTimeout(t);
  }, []);

  const title = conv ? conversationTitle(conv, nameOf, selfId) : '';
  const reversed = useMemo(() => [...messages].reverse(), [messages]);
  const typingNames = Object.keys(typers).map((u) => nameOf(u));
  const byServerId = useMemo(
    () => new Map(messages.filter((m) => m.messageId).map((m) => [m.messageId!, m])),
    [messages],
  );
  const members: MentionCandidate[] = useMemo(
    () =>
      (conv?.memberIds ?? [])
        .filter((u) => u !== selfId)
        .map((userId) => ({ userId, name: nameOf(userId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [conv?.memberIds, selfId, nameOf],
  );

  const replyPreview = (m: LocalMessage): ReplyPreview | null => {
    if (!m.replyTo) return null;
    const parent = byServerId.get(m.replyTo);
    return {
      messageId: m.replyTo,
      senderName: parent
        ? (guestSenderLabel(parent.metadata) ?? nameOf(parent.senderId))
        : 'Earlier message',
      text: parent ? parent.text : null,
      deleted: !!parent?.deletedAt,
    };
  };

  // Follow new messages while you are at the bottom, and always after you send one.
  const newest = messages[messages.length - 1];
  useEffect(() => {
    if (!newest) return;
    if (atBottom.current || newest.senderId === selfId)
      list.current?.scrollToOffset({ offset: 0, animated: !firstRender.current });
  }, [newest?.clientId, newest?.senderId, selfId]);

  const jumpTo = useCallback(
    (messageId: string) => {
      const index = reversed.findIndex((m) => m.messageId === messageId);
      if (index < 0) return;
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setHighlight(messageId);
      setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 1600);
    },
    [reversed],
  );

  const react = useCallback(
    (m: LocalMessage, emoji: string) => void engine.toggleReaction(m.clientId, emoji),
    [engine],
  );

  const onAction = (action: MessageAction, m: LocalMessage) => {
    switch (action) {
      case 'reply':
        return setMode({
          kind: 'reply',
          message: m,
          senderName: guestSenderLabel(m.metadata) ?? nameOf(m.senderId),
        });
      case 'edit':
        return setMode({ kind: 'edit', message: m });
      case 'retry':
        return void engine.retry(m.clientId);
      case 'discard':
        return void engine.discard(m.clientId);
      case 'delete': {
        const go = () => void engine.remove(m.clientId);
        if (Platform.OS === 'web') return go();
        Alert.alert(
          'Delete for everyone?',
          'Everyone in the conversation will see that it was deleted.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: go },
          ],
        );
      }
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <Pressable
              onPress={openInfo}
              accessibilityRole="button"
              accessibilityLabel={`${title}, details`}
              style={{ alignItems: 'center' }}
            >
              <Text variant="heading" numberOfLines={1}>
                {title}
              </Text>
              {conv?.topic || conv?.memberIds ? (
                <Text variant="meta" tone="muted" numberOfLines={1}>
                  {conv.topic ?? `${conv.memberIds.length} members`}
                </Text>
              ) : null}
            </Pressable>
          ),
          headerRight: () =>
            conv ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {callsOn && conv.myRole !== null && !conv.archivedAt
                  ? (['audio', 'video'] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => void startCall(m)}
                        disabled={!online}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={m === 'video' ? 'Start video call' : 'Start voice call'}
                        accessibilityState={{ disabled: !online }}
                        style={{ paddingHorizontal: space.sm, opacity: online ? 1 : 0.4 }}
                      >
                        <Ionicons
                          name={m === 'video' ? 'videocam-outline' : 'call-outline'}
                          size={22}
                          color={theme.colors.accent}
                        />
                      </Pressable>
                    ))
                  : null}
                {conv.myRole !== null ? (
                  <Pressable
                    onPress={() => setNotifyOpen(true)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Notifications: ${
                      conv.notifyLevel === 'all'
                        ? 'all activity'
                        : conv.notifyLevel === 'mentions'
                          ? 'mentions only'
                          : 'off'
                    }`}
                    style={{ paddingHorizontal: space.sm }}
                  >
                    <Ionicons
                      name={NOTIFY_ICON[conv.notifyLevel]}
                      size={22}
                      color={
                        conv.notifyLevel === 'all' ? theme.colors.accent : theme.colors.warning
                      }
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={openInfo}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Conversation details"
                  style={{ paddingHorizontal: space.sm }}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={23}
                    color={theme.colors.accent}
                  />
                </Pressable>
              </View>
            ) : null,
        }}
      />
      <NotifyLevelSheet
        visible={notifyOpen}
        level={conv?.notifyLevel ?? 'all'}
        pending={!!conv?.notifyLevelPending}
        onPick={(level) => void engine.setNotifyLevel(id, level)}
        onClose={() => setNotifyOpen(false)}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={{ paddingTop: space.sm }}>
          <ConnectivityBanner />
          <CallBanner
            call={liveCall && liveCall.callId !== calls.current?.call.callId ? liveCall : null}
            inCall={!!liveCall && liveCall.callId === calls.current?.call.callId}
            error={calls.error}
            nameOf={nameOf}
            onJoin={(media) => void joinCall(media)}
            onReturn={() =>
              // Back to the call screen already in the stack (never a second copy of the call).
              router.dismissTo({ pathname: '/call/[id]', params: { id: liveCall!.callId } })
            }
            onDismissError={() => engine.calls.dismissError()}
          />
        </View>
        <FlatList
          ref={list}
          inverted
          onScroll={(e) => (atBottom.current = e.nativeEvent.contentOffset.y < 80)}
          scrollEventThrottle={64}
          onScrollToIndexFailed={(e) =>
            list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true })
          }
          data={reversed}
          keyExtractor={(m) => m.clientId}
          contentContainerStyle={{ paddingVertical: space.md }}
          renderItem={({ item, index }) => {
            const older = reversed[index + 1];
            return (
              <MessageBubble
                message={item}
                own={item.senderId === selfId}
                senderName={guestSenderLabel(item.metadata) ?? nameOf(item.senderId)}
                selfId={selfId}
                showSender={
                  !older ||
                  older.senderId !== item.senderId ||
                  older.messageType === 'system' ||
                  !!item.replyTo
                }
                animate={!firstRender.current}
                mentioned={item.mentions.map((userId) => ({
                  userId,
                  name: nameOf(userId, { asWritten: true }),
                }))}
                reply={replyPreview(item)}
                highlighted={!!item.messageId && item.messageId === highlight}
                onOpenActions={setSheetFor}
                onPressReply={jumpTo}
                onToggleReaction={react}
                nameOf={nameOf}
              />
            );
          }}
          ListEmptyComponent={
            <Text
              tone="muted"
              style={{ textAlign: 'center', padding: space.xl, transform: [{ scaleY: -1 }] }}
            >
              {conv && isUnjoinedChannel(conv)
                ? 'No messages in this channel yet.'
                : 'No messages saved on this device yet. Say hello.'}
            </Text>
          }
        />
        {typingNames.length ? (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(150)}
            style={styles.typing}
          >
            <Text variant="meta" tone="muted">
              {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
            </Text>
          </Animated.View>
        ) : null}
        {conv && isUnjoinedChannel(conv) ? (
          <View style={[styles.bar, { borderTopColor: theme.colors.border }]}>
            <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
              {joinError ?? 'You are reading this channel. Join to post and get notified.'}
            </Text>
            <Button
              title="Join channel"
              icon="enter-outline"
              onPress={() => void join()}
              busy={joinBusy}
              disabled={!!engine.serverActionBlocker()}
            />
          </View>
        ) : conv?.archivedAt ? (
          <View style={[styles.bar, { borderTopColor: theme.colors.border }]}>
            <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
              This conversation is archived and read-only.
            </Text>
          </View>
        ) : (
          <Composer
            conversationId={id}
            placeholder={`Message ${title}`}
            members={members}
            mode={mode}
            onCancelMode={() => setMode(null)}
          />
        )}
      </KeyboardAvoidingView>
      <MessageActions
        message={sheetFor}
        own={sheetFor?.senderId === selfId}
        onAction={onAction}
        onReact={react}
        onClose={() => setSheetFor(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  typing: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  bar: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
