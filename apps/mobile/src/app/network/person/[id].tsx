import {
  REPORT_REASONS,
  uuidv7,
  type Circle,
  type ConnectionRequest,
  type NetworkProfile,
  type Relationship,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Empty, Field, QueuedTag, Tag, useMessagePerson } from '../../../components/NetworkBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import {
  CIRCLE_LABEL,
  count,
  pendingFor,
  personLine,
  withPendingRelationship,
} from '../../../lib/network';
import type { NetworkScope } from '../../../lib/networkSpace';
import { useWorkspace } from '../../../state/AppProvider';
import { useNet, useNetPending } from '../../../state/useNetwork';
import { space } from '../../../theme/themes';

const REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  impersonation: 'Impersonation',
  inappropriate: 'Inappropriate',
  other: 'Something else',
};

/** Someone in SampConnect Network: connect, follow, message, block or report. */
export default function NetworkPerson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { engine } = useWorkspace();
  const { data, loading } = useNet<{ profile: NetworkProfile; relationship: Relationship }>(
    `/v1/network/people/${id}`,
  );
  const requests = useNet<{ incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] }>(
    '/v1/network/requests',
  );
  const pending = useNetPending();
  const { message, busy: opening, error: messageError } = useMessagePerson();
  const [panel, setPanel] = useState<'connect' | 'report' | null>(null);
  const [circle, setCircle] = useState<Circle>('business');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('spam');
  const [details, setDetails] = useState('');
  const [reported, setReported] = useState(false);

  const requestsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...(requests.data?.incoming ?? []), ...(requests.data?.outgoing ?? [])])
      m.set(r.requestId, r.person.userId);
    return m;
  }, [requests.data]);

  if (!data)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        {loading ? (
          <ActivityIndicator style={{ marginTop: space.xl }} />
        ) : (
          <Empty
            icon="person-outline"
            title="Profile not available"
            body="Open it again once you’re online, or they may have blocked you."
          />
        )}
      </Screen>
    );

  const p = data.profile;
  const r = withPendingRelationship(p.userId, data.relationship, pending, requestsById);
  const incoming = requests.data?.incoming.find((x) => x.person.userId === p.userId);
  const act = (
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    label: string,
    scopes: NetworkScope[],
    body?: unknown,
  ) => void engine.netAct({ method, path, label, scopes, ...(body ? { body } : {}) });

  const confirm = (title: string, text: string, go: () => void) => {
    if (Platform.OS === 'web') {
      if ((globalThis as unknown as Window).confirm(`${title}\n\n${text}`)) go();
      return;
    }
    Alert.alert(title, text, [
      { text: 'Cancel', style: 'cancel' },
      { text: title.split(' ')[0]!, style: 'destructive', onPress: go },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Avatar name={p.displayName} size={104} />
          <Text variant="title" style={{ textAlign: 'center' }}>
            {p.displayName}
          </Text>
          <Text tone="muted" style={{ textAlign: 'center' }}>
            {personLine(p)}
          </Text>
          {p.headline ? <Text style={{ textAlign: 'center' }}>{p.headline}</Text> : null}
          <View style={styles.tags}>
            {r.connection === 'connected' && r.circle ? (
              <Tag accent text={`Connected · ${CIRCLE_LABEL[r.circle]}`} />
            ) : null}
            {r.connection === 'outgoing' ? <Tag text="Request sent" /> : null}
            {r.followsYou ? <Tag text="Follows you" /> : null}
            {r.blocked ? <Tag text="Blocked" /> : null}
            {pendingFor(p.userId, pending) ? <QueuedTag /> : null}
          </View>
          <Text variant="meta" tone="subtle">
            {count(p.counts.connections, 'connection')} · {count(p.counts.followers, 'follower')}
          </Text>
        </View>

        {p.bio ? (
          <Glass style={{ padding: space.lg }}>
            <Text>{p.bio}</Text>
          </Glass>
        ) : null}

        <View style={{ gap: space.sm }}>
          {r.connection === 'connected' ? (
            <Button
              title="Message"
              icon="chatbubble-outline"
              busy={opening}
              onPress={() => void message(p.userId)}
            />
          ) : null}
          {r.connection === 'incoming' && (r.requestId ?? incoming?.requestId) ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title="Accept"
                icon="checkmark"
                style={{ flex: 1 }}
                onPress={() =>
                  act(
                    'POST',
                    `/v1/network/requests/${r.requestId ?? incoming!.requestId}/respond`,
                    `Accepting ${p.displayName}`,
                    ['requests', 'connections'],
                    {
                      clientActionId: uuidv7(),
                      accept: true,
                      circle: incoming?.circle ?? 'business',
                    },
                  )
                }
              />
              <Button
                title="Decline"
                kind="quiet"
                style={{ flex: 1 }}
                onPress={() =>
                  act(
                    'POST',
                    `/v1/network/requests/${r.requestId ?? incoming!.requestId}/respond`,
                    `Declining ${p.displayName}`,
                    ['requests'],
                    { clientActionId: uuidv7(), accept: false },
                  )
                }
              />
            </View>
          ) : null}
          {r.connection === 'outgoing' && r.requestId ? (
            <Button
              title="Withdraw request"
              kind="quiet"
              onPress={() =>
                act(
                  'DELETE',
                  `/v1/network/requests/${r.requestId}`,
                  `Withdrawing your request to ${p.displayName}`,
                  ['requests'],
                )
              }
            />
          ) : null}
          {r.connection === 'none' && r.canRequest && !r.blocked ? (
            <Button
              title="Connect"
              icon="person-add-outline"
              onPress={() => setPanel(panel === 'connect' ? null : 'connect')}
            />
          ) : null}
          {messageError ? (
            <Text tone="danger" variant="label">
              {messageError}
            </Text>
          ) : null}
        </View>

        {panel === 'connect' && r.connection === 'none' ? (
          <Glass style={{ padding: space.lg, gap: space.md }}>
            <Text variant="heading">Connect with {p.displayName}</Text>
            <Text variant="meta" tone="muted">
              Free to send. Once they accept, you can message and call each other.
            </Text>
            <Text variant="label" tone="muted">
              Add to
            </Text>
            <Chips
              label="Add to"
              options={[
                { key: 'business', label: 'Business' },
                { key: 'friends', label: 'Friends' },
              ]}
              selected={[circle]}
              onToggle={setCircle}
            />
            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              maxLength={300}
              multiline
              placeholder="Hi Maria, we met at…"
            />
            <Button
              title="Send request"
              onPress={() => {
                act(
                  'POST',
                  '/v1/network/requests',
                  `Connection request to ${p.displayName}`,
                  ['requests', 'connections'],
                  { clientActionId: uuidv7(), toUserId: p.userId, circle, message: note.trim() },
                );
                setPanel(null);
                setNote('');
              }}
            />
          </Glass>
        ) : null}

        <Glass>
          {r.canFollow || r.following ? (
            <Row
              title={r.following ? 'Unfollow' : 'Follow'}
              hint={
                r.following
                  ? 'You see their public and follower updates.'
                  : 'See their public updates without connecting.'
              }
              onPress={() =>
                act(
                  r.following ? 'DELETE' : 'PUT',
                  `/v1/network/follows/user/${p.userId}`,
                  `${r.following ? 'Unfollowing' : 'Following'} ${p.displayName}`,
                  ['follows'],
                )
              }
            />
          ) : null}
          {r.connection === 'connected' ? (
            <>
              <Row
                divider
                title={`Move to ${r.circle === 'business' ? 'Friends' : 'Business'}`}
                onPress={() =>
                  act(
                    'PUT',
                    `/v1/network/connections/${p.userId}/circle`,
                    `Moving ${p.displayName}`,
                    ['connections'],
                    {
                      clientActionId: uuidv7(),
                      circle: r.circle === 'business' ? 'friends' : 'business',
                    },
                  )
                }
              />
              <Row
                divider
                danger
                title="Remove connection"
                onPress={() =>
                  confirm(
                    'Remove connection?',
                    `You and ${p.displayName} won’t be able to message each other until you connect again.`,
                    () =>
                      act(
                        'DELETE',
                        `/v1/network/connections/${p.userId}`,
                        `Removing ${p.displayName}`,
                        ['connections'],
                      ),
                  )
                }
              />
            </>
          ) : null}
          <Row
            divider
            danger={!r.blocked}
            title={r.blocked ? 'Unblock' : 'Block'}
            hint={r.blocked ? undefined : 'Hides you from each other and removes the connection.'}
            onPress={() =>
              r.blocked
                ? act('DELETE', `/v1/network/blocks/${p.userId}`, `Unblocking ${p.displayName}`, [
                    'blocks',
                  ])
                : confirm(
                    `Block ${p.displayName}?`,
                    'They won’t find you, message you or see your updates. You can unblock later.',
                    () =>
                      act('PUT', `/v1/network/blocks/${p.userId}`, `Blocking ${p.displayName}`, [
                        'blocks',
                        'connections',
                      ]),
                  )
            }
          />
          <Row
            divider
            danger
            title={reported ? 'Reported' : 'Report'}
            onPress={() => setPanel(panel === 'report' ? null : 'report')}
          />
        </Glass>

        {panel === 'report' ? (
          <Glass style={{ padding: space.lg, gap: space.md }}>
            <Text variant="heading">Report {p.displayName}</Text>
            <Text variant="meta" tone="muted">
              Reports are kept for review. {p.displayName} isn’t told who reported them.
            </Text>
            <Chips
              label="Reason"
              options={REPORT_REASONS.map((k) => ({ key: k, label: REASON_LABEL[k] }))}
              selected={[reason]}
              onToggle={setReason}
            />
            <Field
              label="Details (optional)"
              value={details}
              onChangeText={setDetails}
              maxLength={1000}
              multiline
            />
            <Button
              title="Send report"
              kind="danger"
              onPress={() => {
                act('POST', '/v1/network/reports', `Report about ${p.displayName}`, [], {
                  clientActionId: uuidv7(),
                  targetType: 'user',
                  targetId: p.userId,
                  reason,
                  details: details.trim(),
                });
                setPanel(null);
                setDetails('');
                setReported(true);
              }}
            />
          </Glass>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({
  title,
  hint,
  onPress,
  danger,
  divider,
}: {
  title: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  divider?: boolean;
}) {
  return (
    <View style={divider ? styles.divider : undefined}>
      <Button
        title={title}
        kind={danger ? 'danger' : 'quiet'}
        onPress={onPress}
        style={styles.rowButton}
      />
      {hint ? (
        <Text variant="meta" tone="subtle" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  divider: {},
  rowButton: { margin: space.sm, marginBottom: 0 },
  hint: { paddingHorizontal: space.lg, paddingTop: 4, paddingBottom: space.xs },
});
