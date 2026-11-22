import { Ionicons } from '@expo/vector-icons';
import type { ConnectionRequest, MyNetworkProfile } from '@sampledge/contracts';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { isUnjoinedChannel } from '../lib/access';
import { count, withPendingProfile, withPendingRequests } from '../lib/network';
import { useApp, useWorkspace } from '../state/AppProvider';
import { useConversations, usePeople } from '../state/hooks';
import { useNet, useNetPending } from '../state/useNetwork';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { ConnectivityBanner } from './Connectivity';
import { ConversationRow } from './ConversationRow';
import { Glass } from './Glass';
import { Empty, PersonRow, Section, SmallButton, Tag } from './NetworkBits';
import { Screen } from './Screen';
import { Text } from './Text';

/** Home in SampConnect Network: requests waiting, recent chats and the way back to work. */
export function NetworkHome() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { sessions } = useApp();
  const { selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const pending = useNetPending();
  const me = useNet<MyNetworkProfile>('/v1/network/me');
  const req = useNet<{ incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] }>(
    '/v1/network/requests',
  );
  const profile = me.data ? withPendingProfile(me.data, pending) : null;
  const incoming = req.data ? withPendingRequests(req.data, pending).incoming : [];
  const recent = conversations.filter((x) => !isUnjoinedChannel(x)).slice(0, 5);
  const work = sessions.isPersonal ? null : sessions.primary;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}>
        <View style={{ gap: 4 }}>
          <Text variant="overline" tone="accent">
            SampConnect Network
          </Text>
          <Text variant="display">
            {profile ? `Hi, ${profile.displayName.split(' ')[0]}` : 'Your network'}
          </Text>
          <Text tone="muted">
            {profile
              ? `@${profile.handle} · ${count(profile.counts.connections, 'connection')}`
              : 'Your connections across every organization'}
          </Text>
        </View>
        <ConnectivityBanner />

        {work ? (
          <Pressable
            onPress={() => void sessions.openWork()}
            accessibilityRole="button"
            accessibilityLabel={`Switch to Work: ${work.tenant.name}`}
          >
            <Glass style={styles.space}>
              <Ionicons name="business-outline" size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Work: {work.tenant.name}</Text>
                <Text variant="meta" tone="muted">
                  Back to your organization. Each space keeps its own chats, offline too.
                </Text>
              </View>
              <Ionicons name="swap-horizontal" size={18} color={c.textSubtle} />
            </Glass>
          </Pressable>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quick}
        >
          {(
            [
              ['search', 'Find people', () => router.push('/people')],
              ['person-add-outline', 'Invite', () => router.push('/network/invite')],
              [
                'chatbubble-outline',
                'Message a connection',
                () => router.push({ pathname: '/people', params: { tab: 'connections' } }),
              ],
              ['id-card-outline', 'My profile', () => router.push('/network/profile')],
            ] as const
          ).map(([icon, label, go]) => (
            <Pressable
              key={label}
              onPress={go}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={[
                styles.q,
                { backgroundColor: alpha(c.accent, 0.1), borderColor: alpha(c.accent, 0.25) },
              ]}
            >
              <Ionicons name={icon} size={18} color={c.accent} />
              <Text variant="label" tone="accent">
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Section
          title={`Requests waiting for you (${incoming.length})`}
          right={
            incoming.length ? (
              <SmallButton
                title="See all"
                onPress={() => router.push({ pathname: '/people', params: { tab: 'requests' } })}
              />
            ) : null
          }
        >
          {incoming.length ? (
            incoming
              .slice(0, 3)
              .map((r, i) => (
                <PersonRow
                  key={r.requestId}
                  person={r.person}
                  divider={i > 0}
                  tags={r.message ? <Tag text={`“${r.message.slice(0, 40)}”`} /> : undefined}
                />
              ))
          ) : (
            <Empty
              icon="people-outline"
              title="No requests waiting"
              body="Find people by their Connect ID, or invite someone who isn’t here yet."
            />
          )}
        </Section>

        <Section title="Recent chats">
          {recent.length ? (
            recent.map((x) => (
              <ConversationRow key={x.conversationId} c={x} nameOf={nameOf} selfId={selfId} />
            ))
          ) : (
            <Empty
              icon="chatbubbles-outline"
              title="No chats yet"
              body="Message a connection to start."
            />
          )}
        </Section>

        <Glass style={styles.planned}>
          <Ionicons name="sparkles-outline" size={18} color={c.accentSecondary} />
          <Text variant="meta" tone="muted" style={{ flex: 1 }}>
            Status updates and communities are coming to the phone next. They already work on the
            web.
          </Text>
        </Glass>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  space: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  quick: { gap: space.sm },
  q: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  planned: { flexDirection: 'row', gap: space.md, padding: space.md, alignItems: 'center' },
});
