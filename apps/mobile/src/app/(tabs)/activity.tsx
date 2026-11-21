import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useConversations, useMentions, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Activity: @mentions of you from conversations saved on this device. Push notifications are planned. */
export default function Activity() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { selfId } = useWorkspace();
  const nameOf = usePeople();
  const { mentions, loading } = useMentions();
  const { conversations } = useConversations();
  const titles = useMemo(
    () =>
      new Map(conversations.map((x) => [x.conversationId, conversationTitle(x, nameOf, selfId)])),
    [conversations, nameOf, selfId],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Activity</Text>
        <Text tone="muted">Mentions of you, newest first.</Text>
      </View>
      <FlatList
        data={mentions}
        keyExtractor={(m) => m.clientId}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, flexGrow: 1 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/conversation/[id]', params: { id: item.conversationId } })
            }
            accessibilityRole="button"
          >
            <Glass style={styles.card}>
              <Avatar name={nameOf(item.senderId)} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.titleRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                    {nameOf(item.senderId)}
                    <Text tone="muted">
                      {' '}
                      in {titles.get(item.conversationId) ?? 'a conversation'}
                    </Text>
                  </Text>
                  <Text variant="meta" tone="subtle">
                    {when(item.createdAt)}
                  </Text>
                </View>
                <Text tone="muted" numberOfLines={2}>
                  {item.text}
                </Text>
              </View>
            </Glass>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.empty}>
              <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.14) }]}>
                <Ionicons name="at" size={26} color={c.accent} />
              </View>
              <Text variant="heading">No mentions yet</Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                When someone writes @ and your name, it shows up here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          <Text variant="meta" tone="subtle" style={{ textAlign: 'center', marginTop: space.lg }}>
            Push notifications and reply alerts are planned.
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.md, gap: 2 },
  card: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
