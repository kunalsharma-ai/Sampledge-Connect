import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { SavedMessageCard, shortDate } from '../../components/SavedMessageCard';
import { Text } from '../../components/Text';
import { guestSenderLabel } from '../../lib/guests';
import { useWorkspace } from '../../state/AppProvider';
import { useConversation, usePeople, usePinned } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Every pinned message of one conversation. Read from the device, so it works offline. */
export default function Pinned() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const conv = useConversation(id);
  const pins = usePinned(id);
  const nameOf = usePeople();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPin = !!conv && conv.myRole !== null && !conv.archivedAt;
  const blocked = engine.serverActionBlocker();

  const unpin = async (messageId: string) => {
    setBusy(messageId);
    setError(null);
    try {
      await engine.pinMessage(messageId, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: title ? `Pinned · ${title}` : 'Pinned' }} />
      <FlatList
        data={pins}
        keyExtractor={(m) => m.clientId}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}
        ListHeaderComponent={
          error ? (
            <View
              style={{
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: alpha(c.danger, 0.12),
              }}
            >
              <Text variant="meta" style={{ color: c.danger }}>
                {error}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item: m }) => {
          const by = m.pinned!.pinnedBy === selfId ? 'you' : nameOf(m.pinned!.pinnedBy);
          return (
            <SavedMessageCard
              senderName={
                m.senderId === selfId ? 'You' : (guestSenderLabel(m.metadata) ?? nameOf(m.senderId))
              }
              context={`Pinned by ${by} · ${shortDate(m.pinned!.pinnedAt)}`}
              text={m.text}
              createdAt={m.createdAt}
              onOpen={() =>
                router.dismissTo({
                  pathname: '/conversation/[id]',
                  params: { id, focus: m.messageId! },
                })
              }
              action={
                canPin
                  ? {
                      label: 'Unpin',
                      icon: 'close-circle-outline',
                      onPress: () => void unpin(m.messageId!),
                      busy: busy === m.messageId,
                      disabled: !!blocked,
                    }
                  : undefined
              }
            />
          );
        }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xxxl }}>
            <Ionicons name="pin-outline" size={36} color={c.textSubtle} />
            <Text tone="muted" style={{ textAlign: 'center' }}>
              Nothing pinned. Long-press a message and choose Pin to conversation to keep it at the
              top for everyone.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}
