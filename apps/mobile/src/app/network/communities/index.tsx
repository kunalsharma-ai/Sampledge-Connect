import { Ionicons } from '@expo/vector-icons';
import type { Community } from '@sampledge/contracts';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { CommunityAvatar, Empty, QueuedTag, Tag } from '../../../components/NetworkBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import {
  ROLE_LABEL,
  count,
  pendingForCommunity,
  withPendingCommunities,
  withPendingCommunity,
  type PendingNet,
} from '../../../lib/network';
import { useNet, useNetPending } from '../../../state/useNetwork';
import { fonts, radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/** Communities: yours (made offline too) and public ones to discover. */
export default function Communities() {
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const pending = useNetPending();
  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text tone="muted">
          Groups of people across organizations, with announcements and topic groups.
        </Text>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Chips
              label="Communities"
              options={[
                { key: 'mine', label: 'My communities' },
                { key: 'discover', label: 'Discover' },
              ]}
              selected={[tab]}
              onToggle={setTab}
            />
          </View>
        </View>
        <Button
          title="New community"
          icon="add"
          onPress={() => router.push('/network/communities/new')}
        />
        {tab === 'mine' ? <Mine pending={pending} /> : <Discover pending={pending} />}
      </ScrollView>
    </Screen>
  );
}

function Mine({ pending }: { pending: PendingNet[] }) {
  const { data, loading } = useNet<Community[]>('/v1/network/communities');
  if (loading && !pending.length) return <ActivityIndicator style={{ marginTop: space.lg }} />;
  const list = withPendingCommunities(data ?? [], pending);
  if (!list.length)
    return (
      <Glass>
        <Empty
          icon="people-circle-outline"
          title="No communities yet"
          body="Create one for your clients, panel partners or industry peers, or discover public ones."
        />
      </Glass>
    );
  return (
    <View style={{ gap: space.md }}>
      {list.map((c) => (
        <CommunityCard
          key={c.communityId}
          c={c}
          queued={pendingForCommunity(c.communityId, pending)}
        />
      ))}
    </View>
  );
}

function Discover({ pending }: { pending: PendingNet[] }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading } = useNet<Community[]>(
    `/v1/network/communities/discover${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
  );
  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.search, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
        <Ionicons name="search" size={18} color={c.textSubtle} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search public communities"
          placeholderTextColor={c.textSubtle}
          accessibilityLabel="Search public communities"
          autoCorrect={false}
          style={[styles.searchInput, { color: c.text }]}
        />
      </View>
      {data?.length ? (
        data.map((x) => (
          <CommunityCard
            key={x.communityId}
            c={withPendingCommunity(x, pending)}
            queued={pendingForCommunity(x.communityId, pending)}
          />
        ))
      ) : loading ? (
        <ActivityIndicator />
      ) : (
        <Glass>
          <Empty
            icon="search-outline"
            title={data ? 'Nothing found' : 'Discover needs a connection'}
            body={data ? undefined : 'Public communities show here once you’re online.'}
          />
        </Glass>
      )}
    </View>
  );
}

function CommunityCard({ c, queued }: { c: Community; queued: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/network/communities/[id]', params: { id: c.communityId } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${c.name}, ${c.visibility === 'public' ? 'public' : 'private'}, ${count(c.memberCount, 'member')}`}
    >
      <Glass style={styles.card}>
        <View style={styles.cardHead}>
          <CommunityAvatar name={c.name} color={c.avatarColor} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {c.name}
            </Text>
            <Text variant="meta" tone="muted">
              {c.visibility === 'public' ? 'Public' : 'Private'} · {count(c.memberCount, 'member')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
        </View>
        {c.description ? (
          <Text variant="meta" tone="muted" numberOfLines={2}>
            {c.description}
          </Text>
        ) : null}
        <View style={styles.tags}>
          {c.myRole ? <Tag accent text={ROLE_LABEL[c.myRole]} /> : null}
          {c.myStatus === 'pending' ? <Tag text="Waiting for approval" /> : null}
          {c.myStatus === 'invited' ? <Tag accent text="Invited" /> : null}
          {c.following ? <Tag text="Following" /> : null}
          {c.joinPolicy === 'approval' ? <Tag text="Approval to join" /> : null}
          {queued ? <QueuedTag /> : null}
        </View>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  card: { padding: space.lg, gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 11 },
});
