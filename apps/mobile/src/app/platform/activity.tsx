import { Ionicons } from '@expo/vector-icons';
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type PlatformActivityEntry,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Empty, netErrorText } from '../../components/NetworkBits';
import { Pill, shortTime, usePlatformApi, usePlatformLive } from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ACTIVITY_CATEGORY_TEXT } from '../../lib/platform';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Key = AuditCategory | 'all';

/**
 * Everything people and admins do in every organization (or one, with ?org=): sign-ins,
 * password changes and resets, people, devices, exports. Never message contents or passwords.
 * New entries arrive live. CSV export and how long activity is kept are on the web console.
 */
export default function PlatformActivity() {
  const { org, name } = useLocalSearchParams<{ org?: string; name?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const api = usePlatformApi();
  const [category, setCategory] = useState<Key>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PlatformActivityEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const gen = useRef(0);
  const query = useCallback(
    (before?: string) => ({
      category: category === 'all' ? undefined : category,
      q: q.trim() || undefined,
      tenantId: org,
      before,
    }),
    [category, q, org],
  );

  const load = useCallback(() => {
    const mine = ++gen.current;
    api
      .activity(query())
      .then((p) => {
        if (mine !== gen.current) return;
        setItems(p.items);
        setNext(p.nextCursor);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)));
  }, [api, query]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  usePlatformLive(['activity'], load);

  const loadMore = () => {
    if (!next) return;
    setMore(true);
    api
      .activity(query(next))
      .then((p) => {
        setItems((x) => [...(x ?? []), ...p.items]);
        setNext(p.nextCursor);
      })
      .catch((e: unknown) => setError(netErrorText(e)))
      .finally(() => setMore(false));
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: name ? `${name}: activity` : 'Activity' }} />
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search actions, IP addresses or ids"
          placeholderTextColor={c.textSubtle}
          accessibilityLabel="Search activity"
          autoCorrect={false}
          autoCapitalize="none"
          style={[
            styles.search,
            { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
          ]}
        />
        <Chips
          label="Show"
          options={[
            { key: 'all' as Key, label: 'Everything' },
            ...AUDIT_CATEGORIES.map((k) => ({ key: k as Key, label: ACTIVITY_CATEGORY_TEXT[k] })),
          ]}
          selected={[category]}
          onToggle={setCategory}
        />
      </View>
      {!items ? (
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          {error ? <Text tone="muted">{error}</Text> : <ActivityIndicator color={c.accent} />}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{
            padding: space.lg,
            paddingTop: space.sm,
            gap: space.sm,
            paddingBottom: 80,
          }}
          ListEmptyComponent={<Empty icon="pulse-outline" title="Nothing matches" />}
          ListFooterComponent={
            next ? (
              <Button title="Show older" kind="quiet" busy={more} onPress={loadMore} />
            ) : undefined
          }
          renderItem={({ item: e }) => {
            const pw = e.action.startsWith('auth.password');
            return (
              <Pressable
                onPress={() => setOpen(open === e.id ? null : e.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open === e.id }}
              >
                <Glass style={styles.row}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    {pw ? <Ionicons name="key-outline" size={16} color={c.warning} /> : null}
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      {e.label}
                    </Text>
                    <Pill
                      text={ACTIVITY_CATEGORY_TEXT[e.category]}
                      tone={e.category === 'security' ? 'warn' : 'neutral'}
                    />
                  </View>
                  <Text variant="meta" tone="muted" numberOfLines={2}>
                    {e.actor?.name ??
                      (typeof e.metadata.by === 'string' ? e.metadata.by : 'Someone not signed in')}
                    {e.target?.type === 'user' && e.target.name && e.target.id !== e.actor?.userId
                      ? ` → ${e.target.name}`
                      : ''}
                    {org ? '' : ` · ${e.org.name}`}
                  </Text>
                  <Text variant="meta" tone="subtle">
                    {shortTime(e.at)}
                    {e.ip ? ` · ${e.ip}` : ''}
                  </Text>
                  {open === e.id ? (
                    <View style={[styles.detail, { backgroundColor: c.surfaceSunken }]}>
                      <Text variant="meta" tone="muted" selectable>
                        Device: {e.userAgent ?? '—'}
                      </Text>
                      <Text variant="meta" tone="muted" selectable>
                        {JSON.stringify(e.metadata)}
                      </Text>
                    </View>
                  ) : null}
                </Glass>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    height: 42,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    fontSize: 15,
  },
  row: { padding: space.md, gap: 4 },
  detail: { marginTop: 6, padding: space.sm, borderRadius: radius.sm, gap: 4 },
});
