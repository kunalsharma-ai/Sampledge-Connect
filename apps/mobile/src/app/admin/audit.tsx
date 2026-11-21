import { AUDIT_CATEGORIES, type AuditCategory, type AuditEntry } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { auditLine, memberChange } from '../../lib/admin';
import { useWorkspace } from '../../state/AppProvider';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  'sign-in': 'Sign-in',
  members: 'Members',
  security: 'Security',
  conversations: 'Conversations',
  integrations: 'Integrations',
  billing: 'Billing',
  organization: 'Organization',
  other: 'Other',
};

/** The organization's audit log: who did what and when, newest first, 50 at a time. */
export default function Audit() {
  const { actorId, actorName } = useLocalSearchParams<{ actorId?: string; actorName?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [category, setCategory] = useState<AuditCategory | null>(null);
  const [actor, setActor] = useState(actorId ?? null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const gen = useRef(0);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(
    (before?: string) => {
      if (engine.serverActionBlocker()) return;
      const mine = before ? gen.current : ++gen.current;
      setLoading(true);
      engine
        .auditLog({
          category: category ?? undefined,
          actorId: actor ?? undefined,
          q: q.trim() || undefined,
          before,
          limit: 50,
        })
        .then((page) => {
          if (mine !== gen.current) return;
          setItems((xs) => (before ? [...(xs ?? []), ...page.items] : page.items));
          setCursor(page.nextCursor);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [engine, category, actor, q],
  );
  useEffect(() => {
    const t = setTimeout(() => load(), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Audit log' }} />
      <View style={{ paddingTop: space.md, gap: space.sm }}>
        <View style={{ paddingHorizontal: space.lg }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search actions, IP addresses, ids"
            placeholderTextColor={c.textSubtle}
            autoCapitalize="none"
            accessibilityLabel="Search the audit log"
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
            ]}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {actor ? (
            <Chip
              label={`${actorName ?? 'One person'} ✕`}
              on
              onPress={() => setActor(null)}
              a11y={`Showing ${actorName ?? 'one person'} only. Show everyone`}
            />
          ) : null}
          <Chip label="All" on={!category} onPress={() => setCategory(null)} />
          {AUDIT_CATEGORIES.map((k) => (
            <Chip
              key={k}
              label={CATEGORY_LABEL[k]}
              on={category === k}
              onPress={() => setCategory(k)}
            />
          ))}
        </ScrollView>
        {error || blocked ? (
          <Text variant="meta" tone="danger" style={{ paddingHorizontal: space.lg }}>
            {error ?? `${blocked} The audit log is kept on the server.`}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={items ?? []}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 80, gap: space.sm }}
        onEndReachedThreshold={0.4}
        onEndReached={() => cursor && !loading && load(cursor)}
        renderItem={({ item: e }) => {
          const expanded = open === e.id;
          const change = e.action === 'member.updated' ? memberChange(e.metadata) : null;
          return (
            <Pressable
              onPress={() => setOpen(expanded ? null : e.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
            >
              <Glass style={{ padding: space.md, gap: 4 }}>
                <View style={styles.head}>
                  <View
                    style={[
                      styles.cat,
                      {
                        backgroundColor: alpha(
                          e.category === 'security' || e.action.includes('failed')
                            ? c.warning
                            : c.accent,
                          0.14,
                        ),
                      },
                    ]}
                  >
                    <Text variant="meta" tone="muted">
                      {CATEGORY_LABEL[e.category]}
                    </Text>
                  </View>
                  <Text variant="meta" tone="subtle" style={{ flex: 1, textAlign: 'right' }}>
                    {new Date(e.at).toLocaleString([], {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text variant="label">{auditLine(e)}</Text>
                {change ? (
                  <Text variant="meta" tone="muted">
                    {change}
                  </Text>
                ) : null}
                {expanded ? (
                  <View style={{ gap: 2, marginTop: 4 }}>
                    <Text variant="meta" tone="muted">
                      {e.action}
                      {e.ip ? ` · ${e.ip}` : ''}
                    </Text>
                    {e.userAgent ? (
                      <Text variant="meta" tone="subtle" numberOfLines={2}>
                        {e.userAgent}
                      </Text>
                    ) : null}
                    {Object.keys(e.metadata).length ? (
                      <Text variant="meta" tone="subtle" style={{ fontFamily: 'monospace' }}>
                        {JSON.stringify(e.metadata, null, 1).slice(0, 600)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Glass>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          items ? (
            <Text tone="muted" style={{ textAlign: 'center', marginTop: space.xl }}>
              Nothing recorded for this filter.
            </Text>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
        ListFooterComponent={
          loading && items?.length ? <ActivityIndicator color={c.accent} /> : undefined
        }
      />
    </Screen>
  );
}

function Chip({
  label,
  on,
  onPress,
  a11y,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  a11y?: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={a11y ?? label}
      style={[
        styles.chip,
        {
          backgroundColor: on ? c.accent : alpha(c.text, 0.06),
          borderColor: on ? c.accent : c.border,
        },
      ]}
    >
      <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cat: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
});
