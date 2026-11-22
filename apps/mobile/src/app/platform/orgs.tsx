import {
  PLATFORM_ORG_FILTERS,
  type PlatformOrgFilter,
  type PlatformOrgPage,
} from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Empty, netErrorText } from '../../components/NetworkBits';
import { Pill, shortDate, usePlatformApi, usePlatformLive } from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ORG_FILTER_TEXT, formatBytesShort, orgStateText } from '../../lib/platform';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Every organization: search, filter by state, open one. Live as other admins act. */
export default function PlatformOrgs() {
  const { theme } = useTheme();
  const c = theme.colors;
  const api = usePlatformApi();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<PlatformOrgFilter>('all');
  const [data, setData] = useState<PlatformOrgPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const load = useCallback(() => {
    const mine = ++gen.current;
    api
      .orgs({ q: q.trim() || undefined, status })
      .then((r) => {
        if (mine !== gen.current) return;
        setData(r);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)));
  }, [api, q, status]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  usePlatformLive(['orgs', 'billing'], load);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Organizations' }} />
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or address"
          placeholderTextColor={c.textSubtle}
          accessibilityLabel="Search organizations"
          autoCorrect={false}
          autoCapitalize="none"
          style={[
            styles.search,
            { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
          ]}
        />
        <Chips
          label="Show"
          options={PLATFORM_ORG_FILTERS.map((f) => ({ key: f, label: ORG_FILTER_TEXT[f] }))}
          selected={[status]}
          onToggle={setStatus}
        />
      </View>
      {!data ? (
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          {error ? <Text tone="muted">{error}</Text> : <ActivityIndicator color={c.accent} />}
        </View>
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(o) => o.tenantId}
          contentContainerStyle={{
            padding: space.lg,
            paddingTop: space.sm,
            gap: space.sm,
            paddingBottom: 80,
          }}
          ListEmptyComponent={<Empty icon="business-outline" title="No organizations match" />}
          ListFooterComponent={
            <Text variant="meta" tone="subtle" style={{ textAlign: 'center', marginTop: space.sm }}>
              {data.total} organization{data.total === 1 ? '' : 's'}
            </Text>
          }
          renderItem={({ item: o }) => {
            const st = orgStateText(o);
            return (
              <Pressable
                onPress={() => router.push(`/platform/org/${o.tenantId}`)}
                accessibilityRole="button"
                accessibilityLabel={`${o.name}, ${st.text}`}
              >
                <Glass style={{ padding: space.md, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Pill text={st.text} tone={st.tone} />
                  </View>
                  <Text variant="meta" tone="muted" numberOfLines={1}>
                    {o.slug} · {o.plan?.name ?? 'No plan'} · {o.members} member
                    {o.members === 1 ? '' : 's'} · {formatBytesShort(o.storageBytes)}
                  </Text>
                  <Text variant="meta" tone="subtle">
                    Last active {shortDate(o.lastActiveAt)}
                  </Text>
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
});
