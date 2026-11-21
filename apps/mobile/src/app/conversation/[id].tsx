import { TYPING_TTL_MS } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Composer, type ComposerMode } from '../../components/Composer';
import { ConnectivityBanner } from '../../components/Connectivity';
import { MessageActions, type MessageAction } from '../../components/MessageActions';
import { MessageBubble, type ReplyPreview } from '../../components/MessageBubble';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import type { LocalConversation, LocalMessage } from '../../db/store';
import type { MentionCandidate } from '../../lib/mentions';
import { useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useMessages, usePeople } from '../../state/hooks';
import { space } from '../../theme/themes';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const atBottom = useRef(true);

  useEffect(() => {
    const load = () => void store.getConversation(id).then(setConv);
    load();
    return store.events.on('conversations', load);
  }, [store, id]);

  // Mark as read up to the newest server message while the screen is open.
  const newestSeq = useMemo(
    () => messages.reduce((n, m) => Math.max(n, m.serverSeq ?? 0), 0),
    [messages],
  );
  useEffect(() => {
    if (newestSeq > 0) void engine.markRead(id, newestSeq);
  }, [engine, id, newestSeq]);

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
      senderName: parent ? nameOf(parent.senderId) : 'Earlier message',
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
        return setMode({ kind: 'reply', message: m, senderName: nameOf(m.senderId) });
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
            <View style={{ alignItems: 'center' }}>
              <Text variant="heading" numberOfLines={1}>
                {title}
              </Text>
              {conv?.topic || conv?.memberIds ? (
                <Text variant="meta" tone="muted" numberOfLines={1}>
                  {conv.topic ?? `${conv.memberIds.length} members`}
                </Text>
              ) : null}
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={{ paddingTop: space.sm }}>
          <ConnectivityBanner />
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
                senderName={nameOf(item.senderId)}
                selfId={selfId}
                showSender={!older || older.senderId !== item.senderId || !!item.replyTo}
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
              No messages saved on this device yet. Say hello.
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
        <Composer
          conversationId={id}
          placeholder={`Message ${title}`}
          members={members}
          mode={mode}
          onCancelMode={() => setMode(null)}
        />
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
});
