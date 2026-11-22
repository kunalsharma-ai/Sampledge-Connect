import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { SyncTag } from '../../components/WorkRows';
import { Text } from '../../components/Text';
import type { LocalBookingPage } from '../../db/work';
import { bookingSummary, hostLine } from '../../lib/booking';
import { shareLink } from '../../lib/shareLink';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useBookingPages, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Booking pages you host: public links where people outside the organization pick a free time
 * with you or your team. Free times follow each host's working hours and meetings. Pausing,
 * editing and new pages work offline and reach the server when you reconnect.
 */
export default function BookingPages() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState } = useApp();
  const nameOf = usePeople();
  const { items, error: loadError, reload } = useBookingPages();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const blocked = engine.queueBlocker();
  const offline = engineState?.connectivity === 'offline';

  const share = async (p: LocalBookingPage) => {
    setError(null);
    try {
      const how = await shareLink(p.url, p.title);
      setDone(how === 'copied' ? `Link copied: ${p.url}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const toggle = (p: LocalBookingPage, enabled: boolean) =>
    void engine
      .updateBookingPage(p.bookingPageId, { enabled })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  const note =
    error ??
    loadError ??
    blocked ??
    (offline
      ? 'You are offline. Changes here are kept on this phone and reach the server when you reconnect. Your links keep taking bookings.'
      : done);
  const noteTone = error || loadError ? c.danger : offline ? c.accent : c.success;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Booking pages',
          headerRight: () => (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/booking-pages/[id]', params: { id: 'new' } })
              }
              disabled={!!blocked}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New booking page"
              style={{ paddingHorizontal: space.sm }}
            >
              <Ionicons name="add-circle-outline" size={24} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={items ?? []}
        keyExtractor={(p) => p.bookingPageId}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={reload} tintColor={c.accent} />
        }
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <Text variant="meta" tone="muted">
              Share a link and people outside SampConnect pick a time that suits everyone. Each
              booking becomes a meeting with them as a guest, with an invite by email.
            </Text>
            {note ? (
              <View style={[styles.note, { backgroundColor: alpha(noteTone, 0.12) }]}>
                <Text variant="meta" style={{ color: noteTone }} accessibilityLiveRegion="polite">
                  {note}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item: p }) => (
          <Glass style={{ padding: space.md, gap: space.sm }}>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/booking-pages/[id]', params: { id: p.bookingPageId } })
              }
              accessibilityRole="button"
              accessibilityLabel={`Edit ${p.title}`}
              style={{ gap: 4 }}
            >
              <View style={styles.head}>
                <Ionicons
                  name={p.media === 'audio' ? 'call-outline' : 'videocam-outline'}
                  size={18}
                  color={p.enabled ? c.accent : c.textSubtle}
                />
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {p.title}
                </Text>
                {!p.enabled ? (
                  <View style={[styles.paused, { backgroundColor: alpha(c.warning, 0.14) }]}>
                    <Text variant="meta" style={{ color: c.warning }}>
                      Paused
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="meta" tone="muted">
                {bookingSummary(p)}
              </Text>
              <Text variant="meta" tone="muted" numberOfLines={2}>
                {hostLine(p, selfId, nameOf)}
              </Text>
              <Text variant="meta" tone="accent" numberOfLines={1}>
                {p.local ? `…/book/${p.slug}` : p.url}
              </Text>
            </Pressable>
            <SyncTag item={p} />
            <View style={styles.actions}>
              <Pressable
                onPress={() => void share(p)}
                disabled={!!p.local}
                accessibilityRole="button"
                accessibilityLabel={`Share link for ${p.title}`}
                style={[styles.action, { opacity: p.local ? 0.4 : 1 }]}
              >
                <Ionicons name="share-outline" size={17} color={c.accent} />
                <Text variant="meta" tone="accent">
                  Share link
                </Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Text variant="meta" tone="muted">
                Taking bookings
              </Text>
              <Switch
                value={p.enabled}
                disabled={!!blocked}
                onValueChange={(v) => toggle(p, v)}
                accessibilityLabel={`Taking bookings: ${p.title}`}
                trackColor={{ true: c.accent }}
              />
            </View>
          </Glass>
        )}
        ListEmptyComponent={
          items ? (
            <View style={styles.empty}>
              <Ionicons name="link-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                No booking pages yet. Tap + to make one, for example a 30 minute intro call.
              </Text>
            </View>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { padding: space.md, borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  paused: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  empty: { alignItems: 'center', gap: space.md, paddingTop: space.xl * 2 },
});
