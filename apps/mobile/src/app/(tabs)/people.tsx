import { Ionicons } from '@expo/vector-icons';
import {
  uuidv7,
  type Circle,
  type Connection,
  type ConnectionRequest,
  type NetworkPerson,
  type PersonWithRelationship,
} from '@sampledge/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import {
  Empty,
  PersonRow,
  QueuedTag,
  Section,
  SmallButton,
  Tag,
  netErrorText,
  useMessagePerson,
} from '../../components/NetworkBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  CIRCLE_LABEL,
  pendingFor,
  withPendingConnections,
  withPendingRelationship,
  withPendingRequests,
} from '../../lib/network';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useNet, useNetPending } from '../../state/useNetwork';
import { fonts, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Tab = 'find' | 'requests' | 'connections' | 'followers';
type Requests = { incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] };

/** People in SampConnect Network: find by Connect ID, requests, connections and followers. */
export default function People() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'find');
  useEffect(() => {
    if (params.tab) setTab(params.tab);
  }, [params.tab]);
  const requests = useNet<Requests>('/v1/network/requests');
  const pending = useNetPending();
  const waiting = requests.data ? withPendingRequests(requests.data, pending).incoming.length : 0;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xs }}>
          <Text variant="display">People</Text>
          <Text tone="muted">Connect with anyone on SampConnect, in any organization.</Text>
        </View>
        <Chips
          label="People"
          options={[
            { key: 'find', label: 'Find' },
            { key: 'requests', label: waiting ? `Requests (${waiting})` : 'Requests' },
            { key: 'connections', label: 'Connections' },
            { key: 'followers', label: 'Followers' },
          ]}
          selected={[tab]}
          onToggle={setTab}
        />
        {tab === 'find' ? <Find /> : null}
        {tab === 'requests' ? (
          <RequestLists data={requests.data} loading={requests.loading} />
        ) : null}
        {tab === 'connections' ? <Connections /> : null}
        {tab === 'followers' ? <Followers /> : null}
        <Glass>
          <View style={styles.links}>
            <SmallButton
              icon="person-add-outline"
              title="Invite someone"
              onPress={() => router.push('/network/invite')}
            />
            <SmallButton
              icon="ban-outline"
              title="Blocked"
              onPress={() => router.push('/network/blocked')}
            />
          </View>
        </Glass>
      </ScrollView>
    </Screen>
  );
}

function Find() {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const online = !!engineState?.networkUp;
  const pending = useNetPending();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PersonWithRelationship[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Results change when someone accepts, follows or blocks (here or elsewhere).
  useEffect(() => engine.events.on('network', (e) => e.scope && setTick((t) => t + 1)), [engine]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      engine
        .netSearch<PersonWithRelationship[]>(query)
        .then((r) => {
          if (!live) return;
          setResults(r);
          setError(null);
        })
        .catch((e) => live && setError(netErrorText(e)))
        .finally(() => live && setBusy(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, engine, tick]);

  return (
    <View style={{ gap: space.md }}>
      <Glass style={{ padding: space.lg, gap: space.sm }}>
        <Text variant="label">Search by Connect ID, name, email or phone</Text>
        <View
          style={[
            styles.search,
            { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="search" size={16} color={theme.colors.textSubtle} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="@maria.lopez, Maria Lopez or maria@globex.com"
            placeholderTextColor={theme.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search people"
            style={[styles.searchInput, { color: theme.colors.text }]}
          />
          {busy ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
        </View>
        <Text variant="meta" tone="subtle">
          People choose whether they can be found by name, email or phone. An exact Connect ID
          always works.{online ? '' : ' You’re offline: search needs a connection.'}
        </Text>
      </Glass>
      {error ? (
        <Text tone="danger" variant="label">
          {error}
        </Text>
      ) : null}
      {results && !results.length && !busy ? (
        <Empty
          icon="person-outline"
          title="No one found"
          body="Check the Connect ID, or invite them to SampConnect."
        />
      ) : null}
      {results?.length ? (
        <Section title={`${results.length} ${results.length === 1 ? 'person' : 'people'}`}>
          {results.map((r, i) => {
            const rel = withPendingRelationship(r.person.userId, r.relationship, pending);
            return (
              <PersonRow
                key={r.person.userId}
                person={r.person}
                divider={i > 0}
                tags={
                  <>
                    {rel.connection === 'connected' && rel.circle ? (
                      <Tag accent text={CIRCLE_LABEL[rel.circle]} />
                    ) : null}
                    {rel.connection === 'outgoing' ? <Tag text="Request sent" /> : null}
                    {rel.connection === 'incoming' ? <Tag accent text="Wants to connect" /> : null}
                    {rel.following ? <Tag text="Following" /> : null}
                    {rel.followsYou ? <Tag text="Follows you" /> : null}
                    {rel.blocked ? <Tag text="Blocked" /> : null}
                    {pendingFor(r.person.userId, pending) ? <QueuedTag /> : null}
                  </>
                }
                actions={
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textSubtle} />
                }
              />
            );
          })}
        </Section>
      ) : null}
    </View>
  );
}

function RequestLists({ data, loading }: { data: Requests | undefined; loading: boolean }) {
  const { engine } = useWorkspace();
  const pending = useNetPending();
  const [circles, setCircles] = useState<Record<string, Circle>>({});
  const lists = data ? withPendingRequests(data, pending) : null;
  if (loading && !lists) return <ActivityIndicator style={{ marginTop: space.lg }} />;
  if (!lists)
    return (
      <Empty
        icon="cloud-offline-outline"
        title="Not loaded yet"
        body="Requests show here once you’ve been online."
      />
    );
  const respond = (r: ConnectionRequest, accept: boolean) => {
    const circle = circles[r.requestId] ?? r.circle;
    void engine.netAct({
      method: 'POST',
      path: `/v1/network/requests/${r.requestId}/respond`,
      body: { clientActionId: uuidv7(), accept, circle },
      label: `${accept ? 'Accepting' : 'Declining'} ${r.person.displayName}`,
      scopes: ['requests', 'connections'],
    });
  };
  return (
    <View style={{ gap: space.lg }}>
      <Section title={`Waiting for you (${lists.incoming.length})`}>
        {lists.incoming.length ? (
          lists.incoming.map((r, i) => {
            const circle = circles[r.requestId] ?? r.circle;
            return (
              <View key={r.requestId}>
                <PersonRow
                  person={r.person}
                  divider={i > 0}
                  tags={<Tag accent text={`Wants you in ${CIRCLE_LABEL[r.circle]}`} />}
                />
                {r.message ? (
                  <Text tone="muted" variant="meta" style={styles.note}>
                    “{r.message}”
                  </Text>
                ) : null}
                <View style={styles.respond}>
                  <Chips
                    label={`Circle for ${r.person.displayName}`}
                    options={[
                      { key: 'business', label: 'Business' },
                      { key: 'friends', label: 'Friends' },
                    ]}
                    selected={[circle]}
                    onToggle={(c) => setCircles((m) => ({ ...m, [r.requestId]: c }))}
                  />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <SmallButton
                      kind="primary"
                      icon="checkmark"
                      title="Accept"
                      accessibilityLabel={`Accept ${r.person.displayName}`}
                      onPress={() => respond(r, true)}
                    />
                    <SmallButton
                      title="Decline"
                      accessibilityLabel={`Decline ${r.person.displayName}`}
                      onPress={() => respond(r, false)}
                    />
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <Empty icon="mail-open-outline" title="No requests waiting" />
        )}
      </Section>
      <Section title={`Sent (${lists.outgoing.length})`}>
        {lists.outgoing.length ? (
          lists.outgoing.map((r, i) => (
            <PersonRow
              key={r.requestId}
              person={r.person}
              divider={i > 0}
              tags={
                <>
                  <Tag text={CIRCLE_LABEL[r.circle]} />
                  {r.requestId.startsWith('local:') || pendingFor(r.person.userId, pending) ? (
                    <QueuedTag />
                  ) : null}
                </>
              }
              actions={
                r.requestId.startsWith('local:') ? null : (
                  <SmallButton
                    title="Withdraw"
                    accessibilityLabel={`Withdraw request to ${r.person.displayName}`}
                    onPress={() =>
                      void engine.netAct({
                        method: 'DELETE',
                        path: `/v1/network/requests/${r.requestId}`,
                        label: `Withdrawing your request to ${r.person.displayName}`,
                        scopes: ['requests'],
                      })
                    }
                  />
                )
              }
            />
          ))
        ) : (
          <Empty icon="paper-plane-outline" title="No requests sent" />
        )}
      </Section>
    </View>
  );
}

function Connections() {
  const { engine } = useWorkspace();
  const { theme } = useTheme();
  const { data, loading } = useNet<Connection[]>('/v1/network/connections');
  const pending = useNetPending();
  const { message, error } = useMessagePerson();
  const [circle, setCircle] = useState<'all' | Circle>('all');
  const list = useMemo(
    () => (data ? withPendingConnections(data, pending) : null),
    [data, pending],
  );
  if (loading && !list) return <ActivityIndicator style={{ marginTop: space.lg }} />;
  const shown = (list ?? []).filter((c) => circle === 'all' || c.circle === circle);
  const count = (c: Circle) => (list ?? []).filter((x) => x.circle === c).length;
  return (
    <View style={{ gap: space.md }}>
      <Chips
        label="Circle"
        options={[
          { key: 'all', label: `All (${list?.length ?? 0})` },
          { key: 'business', label: `Business (${count('business')})` },
          { key: 'friends', label: `Friends (${count('friends')})` },
        ]}
        selected={[circle]}
        onToggle={setCircle}
      />
      {error ? (
        <Text tone="danger" variant="label">
          {error}
        </Text>
      ) : null}
      {shown.length ? (
        <Glass>
          {shown.map((c, i) => (
            <PersonRow
              key={c.person.userId}
              person={c.person}
              divider={i > 0}
              tags={
                <>
                  <Tag accent text={CIRCLE_LABEL[c.circle]} />
                  {pendingFor(c.person.userId, pending) ? <QueuedTag /> : null}
                </>
              }
              actions={
                <>
                  <SmallButton
                    icon="chatbubble-outline"
                    accessibilityLabel={`Message ${c.person.displayName}`}
                    onPress={() => void message(c.person.userId)}
                  />
                  <SmallButton
                    icon="swap-horizontal"
                    accessibilityLabel={`Move ${c.person.displayName} to ${c.circle === 'business' ? 'Friends' : 'Business'}`}
                    onPress={() =>
                      void engine.netAct({
                        method: 'PUT',
                        path: `/v1/network/connections/${c.person.userId}/circle`,
                        body: {
                          clientActionId: uuidv7(),
                          circle: c.circle === 'business' ? 'friends' : 'business',
                        },
                        label: `Moving ${c.person.displayName}`,
                        scopes: ['connections'],
                      })
                    }
                  />
                </>
              }
            />
          ))}
        </Glass>
      ) : (
        <Empty
          icon="people-outline"
          title={list?.length ? 'No one in this circle' : 'No connections yet'}
          body={list?.length ? undefined : 'Find people by their Connect ID and send a request.'}
        />
      )}
      <Text
        variant="meta"
        tone="subtle"
        style={{ textAlign: 'center', color: theme.colors.textSubtle }}
      >
        Swap moves someone between Business and Friends. Remove or block from their profile.
      </Text>
    </View>
  );
}

function Followers() {
  const { data, loading } = useNet<{
    followers: PersonWithRelationship[];
    following: PersonWithRelationship[];
  }>('/v1/network/follows');
  const pending = useNetPending();
  if (loading && !data) return <ActivityIndicator style={{ marginTop: space.lg }} />;
  const following = (data?.following ?? []).filter(
    (f) => withPendingRelationship(f.person.userId, f.relationship, pending).following,
  );
  const list = (title: string, people: NetworkPerson[]) => (
    <Section title={`${title} (${people.length})`}>
      {people.length ? (
        people.map((p, i) => (
          <PersonRow
            key={p.userId}
            person={p}
            divider={i > 0}
            tags={pendingFor(p.userId, pending) ? <QueuedTag /> : undefined}
          />
        ))
      ) : (
        <Empty
          icon="eye-outline"
          title={title === 'Followers' ? 'No followers yet' : 'Not following anyone'}
        />
      )}
    </Section>
  );
  return (
    <View style={{ gap: space.lg }}>
      {list(
        'Followers',
        (data?.followers ?? []).map((f) => f.person),
      )}
      {list(
        'Following',
        following.map((f) => f.person),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 11 },
  note: { paddingHorizontal: space.lg, marginTop: -4 },
  respond: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
});
