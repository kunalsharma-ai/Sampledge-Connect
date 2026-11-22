import { Ionicons } from '@expo/vector-icons';
import { tenantCan, type ConnectorProvider } from '@sampledge/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ConnectivityBanner } from '../../components/Connectivity';
import { InboxRow, ProviderMark } from '../../components/InboxBits';
import { Screen } from '../../components/Screen';
import { ConversationSkeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { INBOX_VIEWS, isHandoff, PROVIDER_META, type InboxView } from '../../lib/inbox';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useNow, usePeople, useTenantRole } from '../../state/hooks';
import { useInboxChannels, useInboxList } from '../../state/useInbox';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * The Client Inbox: every client conversation from every connected channel (Telegram, Teams,
 * Slack...), worked by agents. Opens from the copy on this phone, updates live from other
 * agents and your other devices, and replies written offline are sent on reconnect.
 */
export default function Inbox() {
  const { theme } = useTheme();
  const c = theme.colors;
  const role = useTenantRole();
  const { sessionState, engineState } = useApp();
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const now = useNow();
  const [view, setView] = useState<InboxView>('mine');
  const [provider, setProvider] = useState<ConnectorProvider | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useInboxList({ view, provider, q: query });
  const channels = useInboxChannels(sessionState !== 'demo');
  const supervisor = tenantCan(role, 'inbox.supervise');
  const providers = useMemo(() => [...new Set(channels.map((x) => x.provider))], [channels]);
  const handoff = channels.some((x) => isHandoff(x.provider) && x.status !== 'paused');
  const offline = engineState?.connectivity === 'offline';

  if (!tenantCan(role, 'inbox.access') || list.error?.code === 'FORBIDDEN')
    return (
      <Screen>
        <View style={styles.header}>
          <Text variant="title">Client Inbox</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={36} color={c.textSubtle} />
          <Text variant="heading">No access to the Client Inbox</Text>
          <Text tone="muted" style={{ textAlign: 'center' }}>
            The Client Inbox is for members of your organization. Ask an admin for access.
          </Text>
        </View>
      </Screen>
    );

  const counts = list.counts;
  const countOf = (v: InboxView) =>
    !counts
      ? undefined
      : v === 'mine'
        ? counts.mine
        : v === 'unassigned'
          ? counts.unassigned
          : v === 'active'
            ? counts.active
            : v === 'breached'
              ? counts.breached
              : undefined;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Client Inbox</Text>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {supervisor ? (
            <Pressable
              onPress={() => router.push('/inbox/dashboard')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Inbox dashboard"
              style={[styles.iconBtn, { backgroundColor: c.surfaceRaised }]}
            >
              <Ionicons name="stats-chart-outline" size={19} color={c.accent} />
            </Pressable>
          ) : null}
          {handoff ? (
            <Pressable
              onPress={() => router.push('/inbox/new')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Log a conversation from Signal or iMessage"
              style={[styles.iconBtn, { backgroundColor: c.accent }]}
            >
              <Ionicons name="add" size={22} color={c.onAccent} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ConnectivityBanner />
      <View style={[styles.search, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
        <Ionicons name="search" size={16} color={c.textSubtle} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => setQuery(q)}
          onBlur={() => setQuery(q)}
          placeholder={offline ? 'Search needs a connection' : 'Search clients and messages'}
          placeholderTextColor={c.textSubtle}
          returnKeyType="search"
          accessibilityLabel="Search the inbox"
          style={[typeScale.body, { flex: 1, color: c.text, paddingVertical: 8 }]}
        />
        {q ? (
          <Pressable
            onPress={() => {
              setQ('');
              setQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={16} color={c.textSubtle} />
          </Pressable>
        ) : null}
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityRole="tablist"
          accessibilityLabel="Inbox view"
        >
          {INBOX_VIEWS.map((v) => {
            const on = v.key === view;
            const n = countOf(v.key);
            const danger = v.key === 'breached' && (n ?? 0) > 0;
            return (
              <Pressable
                key={v.key}
                onPress={() => setView(v.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                aria-selected={on}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? alpha(c.accent, 0.16) : c.surfaceRaised,
                    borderColor: on ? alpha(c.accent, 0.5) : c.border,
                  },
                ]}
              >
                <Text variant="label" tone={on ? 'accent' : 'muted'}>
                  {v.label}
                </Text>
                {n !== undefined ? (
                  <View
                    style={[
                      styles.count,
                      { backgroundColor: danger ? alpha(c.danger, 0.16) : alpha(c.text, 0.07) },
                    ]}
                  >
                    <Text variant="meta" style={{ color: danger ? c.danger : c.textSubtle }}>
                      {n}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {providers.length > 1 ? (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.chips, { paddingTop: 0 }]}
            accessibilityLabel="Channel"
          >
            {[null, ...providers].map((p) => {
              const on = p === provider;
              return (
                <Pressable
                  key={p ?? 'all'}
                  onPress={() => setProvider(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  accessibilityLabel={p ? PROVIDER_META[p].name : 'All channels'}
                  style={[
                    styles.chip,
                    styles.small,
                    {
                      backgroundColor: on ? alpha(c.accent, 0.16) : 'transparent',
                      borderColor: on ? alpha(c.accent, 0.5) : c.border,
                    },
                  ]}
                >
                  {p ? <ProviderMark provider={p} size={16} /> : null}
                  <Text variant="meta" tone={on ? 'accent' : 'muted'}>
                    {p ? PROVIDER_META[p].name : 'All channels'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      {list.loading && !list.items ? (
        <ConversationSkeleton />
      ) : (
        <FlatList
          data={list.items ?? []}
          keyExtractor={(x) => x.conversationId}
          renderItem={({ item }) => (
            <InboxRow
              c={item}
              now={now}
              mine={item.assigneeId === selfId}
              assigneeName={item.assigneeId ? nameOf(item.assigneeId) : null}
            />
          )}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => void engine.refreshInbox(null)}
              tintColor={c.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {sessionState === 'demo'
                  ? 'The demo workspace has no server. Sign in to see your clients here.'
                  : query
                    ? offline
                      ? 'Search needs a connection.'
                      : 'No conversations match.'
                    : list.items === null && offline
                      ? 'This view has not been opened on this phone yet. It loads when you are online.'
                      : view === 'mine'
                        ? 'Nothing assigned to you. Take one from Unassigned.'
                        : view === 'breached'
                          ? 'Nobody is waiting past their reply time.'
                          : 'No conversations here.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  small: { paddingHorizontal: space.sm, paddingVertical: 4 },
  count: { borderRadius: radius.pill, paddingHorizontal: 6, minWidth: 18, alignItems: 'center' },
  empty: { alignItems: 'center', gap: space.md, padding: space.xxl },
});
