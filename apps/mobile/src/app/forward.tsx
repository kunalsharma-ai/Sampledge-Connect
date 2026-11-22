import { Ionicons } from '@expo/vector-icons';
import { MAX_FORWARD_TARGETS } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import type { LocalConversation, LocalMessage } from '../db/store';
import { forwardFrom, forwardSnapshot, forwardTargets } from '../lib/forward';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople } from '../state/hooks';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

const KIND_ICON: Record<LocalConversation['kind'], keyof typeof Ionicons.glyphMap> = {
  dm: 'person-outline',
  group: 'people-outline',
  channel_public: 'chatbubbles-outline',
  channel_private: 'lock-closed-outline',
};

/**
 * Forward a message to up to ten conversations with an optional comment. Each forward is an
 * ordinary queued send: it shows at once with the original quoted and goes out when online.
 */
export default function Forward() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, store, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const [source, setSource] = useState<LocalMessage | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.getMessage(clientId).then((m) => setSource(m ?? null));
  }, [store, clientId]);

  const from = conversations.find((x) => x.conversationId === source?.conversationId);
  const titleOf = (x: LocalConversation) => conversationTitle(x, nameOf, selfId);
  const targets = useMemo(() => {
    if (!from) return [];
    const q = filter.trim().toLowerCase();
    return forwardTargets(from, conversations).filter(
      (x) => !q || conversationTitle(x, nameOf, selfId).toLowerCase().includes(q),
    );
  }, [from, conversations, filter, nameOf, selfId]);
  const full = picked.length >= MAX_FORWARD_TARGETS;
  const quote = source ? forwardSnapshot(source, null) : null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));

  const send = async () => {
    if (!source || !from) return;
    setBusy(true);
    setError(null);
    try {
      await engine.forward(source, picked, comment, forwardFrom(from, nameOf, selfId));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Forward' }} />
      {quote ? (
        <View
          style={[
            styles.quote,
            { borderLeftColor: c.accent, backgroundColor: alpha(c.accent, 0.08) },
          ]}
        >
          <Text variant="label" tone="accent" numberOfLines={1}>
            {nameOf(quote.senderId)}
            {from ? ` · ${titleOf(from)}` : ''}
          </Text>
          <Text variant="meta" numberOfLines={3}>
            {quote.text ||
              (source?.attachments.length
                ? source.attachments.map((a) => a.fileName).join(', ')
                : '')}
          </Text>
        </View>
      ) : null}
      {from && !from.allowForwarding ? (
        <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
          <Ionicons name="lock-closed-outline" size={15} color={c.warning} />
          <Text variant="meta" style={{ color: c.warning, flex: 1 }}>
            Forwarding is turned off in {titleOf(from)}. You can only share it again there.
          </Text>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <View style={[styles.box, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Ionicons name="search" size={17} color={c.textSubtle} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Find a conversation"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Find a conversation"
            autoCorrect={false}
            style={[styles.input, { color: c.text }]}
          />
        </View>
        <Text variant="meta" tone="muted">
          {picked.length
            ? `${picked.length} of ${MAX_FORWARD_TARGETS} picked`
            : `Pick up to ${MAX_FORWARD_TARGETS} conversations`}
        </Text>
      </View>
      <FlatList
        data={targets}
        keyExtractor={(x) => x.conversationId}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, gap: 2 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: x }) => {
          const on = picked.includes(x.conversationId);
          const off = !on && full;
          return (
            <Pressable
              onPress={() => toggle(x.conversationId)}
              disabled={off}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: off }}
              aria-checked={on}
              accessibilityLabel={titleOf(x)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: on
                    ? alpha(c.accent, 0.12)
                    : pressed
                      ? c.surfaceRaised
                      : 'transparent',
                  opacity: off ? 0.45 : 1,
                },
              ]}
            >
              <Ionicons name={KIND_ICON[x.kind]} size={20} color={c.accent} />
              <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {titleOf(x)}
              </Text>
              <Ionicons
                name={on ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={on ? c.accent : c.textSubtle}
              />
            </Pressable>
          );
        }}
      />
      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.surface }]}>
        {error ? (
          <Text variant="meta" tone="danger">
            {error}
          </Text>
        ) : null}
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Add a comment (optional)"
          placeholderTextColor={c.textSubtle}
          accessibilityLabel="Comment"
          multiline
          style={[
            styles.comment,
            { color: c.text, backgroundColor: c.surfaceRaised, borderColor: c.border },
          ]}
        />
        <Button
          icon="arrow-redo"
          title={picked.length > 1 ? `Forward to ${picked.length}` : 'Forward'}
          onPress={() => void send()}
          disabled={!picked.length || busy || !source}
          busy={busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  quote: {
    margin: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    gap: 2,
  },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  comment: {
    fontFamily: fonts.regular,
    fontSize: 15,
    minHeight: 44,
    maxHeight: 110,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
