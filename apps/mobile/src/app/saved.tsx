import { Ionicons } from '@expo/vector-icons';
import type { LocalBookmark } from '../db/work';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { Screen } from '../components/Screen';
import { SavedMessageCard, shortDate } from '../components/SavedMessageCard';
import { Text } from '../components/Text';
import { guestSenderLabel } from '../lib/guests';
import { useApp, useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople } from '../state/hooks';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Messages you saved for later, across conversations. Kept on the server, so online only. */
export default function Saved() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState } = useApp();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const [items, setItems] = useState<LocalBookmark[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const blocked = engine.queueBlocker();
  const offline = engineState?.connectivity === 'offline';

  const load = useCallback(
    async (fresh = true) => {
      if (engine.queueBlocker()) return;
      setLoading(fresh);
      try {
        setItems(await engine.listBookmarks({ fresh }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [engine],
  );

  useEffect(() => {
    void load();
    // Saves and unsaves here or on your other devices.
    return engine.events.on('bookmarks', () => void load(false));
  }, [load, engine, engineState?.networkUp]);

  const remove = async (b: LocalBookmark) => {
    setBusy(b.messageId);
    try {
      await engine.setBookmark(b.messageId, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const where = (conversationId: string) => {
    const conv = conversations.find((x) => x.conversationId === conversationId);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'A conversation you left';
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Saved messages' }} />
      <FlatList
        data={items ?? []}
        keyExtractor={(b) => b.messageId}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!items}
            onRefresh={() => void load()}
            tintColor={c.accent}
          />
        }
        ListHeaderComponent={
          blocked || error || offline ? (
            <View
              style={{
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: alpha(error ? c.danger : blocked ? c.warning : c.accent, 0.12),
              }}
            >
              <Text
                variant="meta"
                style={{ color: error ? c.danger : blocked ? c.warning : c.accent }}
              >
                {error ??
                  blocked ??
                  'You are offline. These are the saved messages on this phone; changes sync when you reconnect.'}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item: b }) => {
          const m = b.message;
          return (
            <SavedMessageCard
              senderId={guestSenderLabel(m.metadata) ? null : m.senderId}
              senderName={
                m.senderId === selfId ? 'You' : (guestSenderLabel(m.metadata) ?? nameOf(m.senderId))
              }
              context={`${where(b.conversationId)} · saved ${shortDate(b.createdAt)}${b.pending ? ' · waiting to sync' : ''}`}
              text={m.content.text}
              createdAt={m.createdAt}
              deleted={!!m.deletedAt}
              onOpen={() =>
                router.push({
                  pathname: '/conversation/[id]',
                  params: { id: b.conversationId, focus: b.messageId },
                })
              }
              action={{
                label: 'Remove from saved',
                icon: 'bookmark',
                onPress: () => void remove(b),
                busy: busy === b.messageId,
                disabled: !!blocked,
              }}
            />
          );
        }}
        ListEmptyComponent={
          items && !loading ? (
            <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xxxl }}>
              <Ionicons name="bookmark-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                Nothing saved yet. Long-press a message and choose Save for later to find it here.
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
