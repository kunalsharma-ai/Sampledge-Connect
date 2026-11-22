import type { NetworkPerson } from '@sampledge/contracts';
import { ActivityIndicator, ScrollView } from 'react-native';
import { Empty, PersonRow, QueuedTag, Section, SmallButton } from '../../components/NetworkBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { useNet, useNetPending } from '../../state/useNetwork';
import { space } from '../../theme/themes';

/** People you blocked: they can't find you, message you or see your updates. */
export default function Blocked() {
  const { engine } = useWorkspace();
  const { data, loading } = useNet<NetworkPerson[]>('/v1/network/blocks');
  const pending = useNetPending();
  const unblocking = new Set(
    pending
      .filter((p) => p.method === 'DELETE' && p.path.startsWith('/v1/network/blocks/'))
      .map((p) => p.path.split('/').pop()!),
  );
  const list = (data ?? []).filter((p) => !unblocking.has(p.userId));
  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text tone="muted">
          Blocked people can’t find you, message you or see your updates, and any connection between
          you is removed.
        </Text>
        {loading && !data ? (
          <ActivityIndicator />
        ) : (
          <Section title={`Blocked (${list.length})`}>
            {list.length ? (
              list.map((p, i) => (
                <PersonRow
                  key={p.userId}
                  person={p}
                  divider={i > 0}
                  tags={pending.some((x) => x.path.endsWith(p.userId)) ? <QueuedTag /> : undefined}
                  actions={
                    <SmallButton
                      title="Unblock"
                      accessibilityLabel={`Unblock ${p.displayName}`}
                      onPress={() =>
                        void engine.netAct({
                          method: 'DELETE',
                          path: `/v1/network/blocks/${p.userId}`,
                          label: `Unblocking ${p.displayName}`,
                          scopes: ['blocks'],
                        })
                      }
                    />
                  }
                />
              ))
            ) : (
              <Empty icon="shield-checkmark-outline" title="You haven’t blocked anyone" />
            )}
          </Section>
        )}
      </ScrollView>
    </Screen>
  );
}
