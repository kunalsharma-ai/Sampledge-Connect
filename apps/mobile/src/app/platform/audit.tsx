import {
  PLATFORM_AUDIT_AREAS,
  type PlatformAuditArea,
  type PlatformAuditEntry,
} from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Empty, netErrorText } from '../../components/NetworkBits';
import { shortTime, usePlatformApi, usePlatformLive } from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { AUDIT_AREA_TEXT } from '../../lib/platform';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type AreaKey = PlatformAuditArea | 'all';

/** What super admins did, newest first. New entries arrive live. */
export default function PlatformAudit() {
  const { theme } = useTheme();
  const api = usePlatformApi();
  const [area, setArea] = useState<AreaKey>('all');
  const [items, setItems] = useState<PlatformAuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const gen = useRef(0);

  const load = useCallback(() => {
    const mine = ++gen.current;
    api
      .audit({ area: area === 'all' ? undefined : area })
      .then((p) => {
        if (mine !== gen.current) return;
        setItems(p.items);
        setNext(p.nextCursor);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)));
  }, [api, area]);
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);
  usePlatformLive(['audit'], load);

  const loadMore = () => {
    if (!next) return;
    setMore(true);
    api
      .audit({ area: area === 'all' ? undefined : area, before: next })
      .then((p) => {
        setItems((x) => [...(x ?? []), ...p.items]);
        setNext(p.nextCursor);
      })
      .catch((e: unknown) => setError(netErrorText(e)))
      .finally(() => setMore(false));
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Audit log' }} />
      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <Chips
          label="Area"
          options={[
            { key: 'all' as AreaKey, label: 'Everything' },
            ...PLATFORM_AUDIT_AREAS.map((a) => ({ key: a as AreaKey, label: AUDIT_AREA_TEXT[a] })),
          ]}
          selected={[area]}
          onToggle={setArea}
        />
      </View>
      {!items ? (
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          {error ? (
            <Text tone="muted">{error}</Text>
          ) : (
            <ActivityIndicator color={theme.colors.accent} />
          )}
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
          ListEmptyComponent={<Empty icon="list-outline" title="Nothing here yet" />}
          ListFooterComponent={
            next ? (
              <Button title="Show older" kind="quiet" busy={more} onPress={loadMore} />
            ) : undefined
          }
          renderItem={({ item: e }) => (
            <Glass style={styles.row}>
              <Text variant="bodyStrong">{e.label}</Text>
              {e.org || e.target ? (
                <Text variant="meta" tone="muted" numberOfLines={2}>
                  {[e.org?.name, e.target && e.target.label !== e.org?.name ? e.target.label : null]
                    .filter(Boolean)
                    .join(' · ')}
                  {typeof e.metadata.reason === 'string' ? ` · “${e.metadata.reason}”` : ''}
                </Text>
              ) : null}
              <Text variant="meta" tone="subtle">
                {e.actor ? `${e.actor.name} (${e.actor.orgName})` : 'SampConnect'} ·{' '}
                {shortTime(e.at)}
              </Text>
            </Glass>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { padding: space.md, gap: 3 },
});
