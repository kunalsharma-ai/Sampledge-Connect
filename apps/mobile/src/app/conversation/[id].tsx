import { TYPING_TTL_MS } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Composer } from '../../components/Composer';
import { ConnectivityBanner } from '../../components/Connectivity';
import { MessageBubble } from '../../components/MessageBubble';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import type { LocalConversation } from '../../db/store';
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
  const typingNames = Object.keys(typers).map(nameOf);

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
          inverted
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
                showSender={!older || older.senderId !== item.senderId}
                animate={!firstRender.current}
                onRetry={(cid) => void engine.retry(cid)}
                onDiscard={(cid) => void engine.discard(cid)}
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
        <Composer conversationId={id} placeholder={`Message ${title}`} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  typing: { paddingHorizontal: space.lg, paddingBottom: space.xs },
});
