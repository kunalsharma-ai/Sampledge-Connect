import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { relativeTime } from '../components/ConversationRow';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import type { LocalMessage } from '../db/store';
import { useWorkspace } from '../state/AppProvider';
import { usePeople } from '../state/hooks';
import { fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Searches messages cached on this device, so it works offline. Server-side search is planned. */
export default function Search() {
  const { theme } = useTheme();
  const { store } = useWorkspace();
  const nameOf = usePeople();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LocalMessage[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => void store.searchMessages(q.trim()).then(setResults), 150);
    return () => clearTimeout(t);
  }, [q, store]);

  return (
    <Screen edges={[]}>
      <View style={{ padding: space.lg }}>
        <TextInput
          autoFocus
          value={q}
          onChangeText={setQ}
          placeholder="Search messages on this device"
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceRaised,
              borderColor: theme.colors.border,
            },
          ]}
          returnKeyType="search"
          accessibilityLabel="Search"
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={(m) => m.clientId}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              router.back();
              router.push({ pathname: '/conversation/[id]', params: { id: item.conversationId } });
            }}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: theme.colors.border },
              pressed && { backgroundColor: theme.colors.surfaceSunken },
            ]}
          >
            <View style={styles.line}>
              <Text variant="label">{nameOf(item.senderId)}</Text>
              <Text variant="meta" tone="subtle">
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            <Text tone="muted" numberOfLines={2}>
              {item.text}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          q.trim().length >= 2 ? (
            <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
              No matches in messages saved on this device.
            </Text>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});
