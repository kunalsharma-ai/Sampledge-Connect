import { Ionicons } from '@expo/vector-icons';
import type { NetworkPerson } from '@sampledge/contracts';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useStatusFeed } from '../state/useNetwork';
import { space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';

/** Status updates at the top of network Home: yours first, then people with new ones. */
export function StatusStrip({ me }: { me: NetworkPerson | null }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { feed } = useStatusFeed();
  const mine = feed?.mine ?? [];
  const ring = (on: boolean) => [
    styles.ring,
    { borderColor: on ? c.accent : c.border, borderWidth: on ? 2.5 : 1.5 },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
        Status
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Pressable
          onPress={() =>
            mine.length
              ? router.push({ pathname: '/network/status/[userId]', params: { userId: 'me' } })
              : router.push('/network/status/new')
          }
          accessibilityRole="button"
          accessibilityLabel={mine.length ? `Your status, ${mine.length}` : 'Add a status'}
          style={styles.item}
        >
          <View style={ring(mine.length > 0)}>
            <Avatar name={me?.displayName ?? 'Me'} size={56} />
          </View>
          <Pressable
            onPress={() => router.push('/network/status/new')}
            accessibilityRole="button"
            accessibilityLabel="New status"
            style={[styles.plus, { backgroundColor: c.accent, borderColor: c.background }]}
          >
            <Ionicons name="add" size={16} color={c.onAccent} />
          </Pressable>
          <Text variant="meta" numberOfLines={1} style={styles.name}>
            {mine.length ? 'My status' : 'Add status'}
          </Text>
        </Pressable>
        {(feed?.people ?? []).map((g) => (
          <Pressable
            key={g.person.userId}
            onPress={() =>
              router.push({
                pathname: '/network/status/[userId]',
                params: { userId: g.person.userId },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${g.person.displayName}’s status${g.unseen ? `, ${g.unseen} new` : ''}`}
            style={styles.item}
          >
            <View style={ring(g.unseen > 0)}>
              <Avatar name={g.person.displayName} size={56} />
            </View>
            <Text
              variant="meta"
              numberOfLines={1}
              style={styles.name}
              tone={g.unseen ? 'default' : 'muted'}
            >
              {g.person.displayName.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
        {feed && !feed.people.length ? (
          <Text variant="meta" tone="subtle" style={styles.empty}>
            Updates from your connections show here.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingHorizontal: space.xs, alignItems: 'flex-start' },
  item: { width: 70, alignItems: 'center', gap: 4 },
  ring: { borderRadius: 40, padding: 3 },
  plus: {
    position: 'absolute',
    top: 44,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { maxWidth: 70, textAlign: 'center' },
  empty: { alignSelf: 'center', maxWidth: 200 },
});
