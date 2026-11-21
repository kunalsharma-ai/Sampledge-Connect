import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { ConnectivityBanner } from '../../components/Connectivity';
import { MeetingRow } from '../../components/MeetingBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import type { LocalMeeting } from '../../db/store';
import { addDays, dayKey, dayLabel, startOfDay } from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { ConnectEngine } from '../../state/engine';
import { useCalls, useMeetings, useNow, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Your meetings, day by day, from the copy on this phone (refreshed when online). */
export default function Meetings() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { engineState, sessionState } = useApp();
  const nameOf = usePeople();
  const calls = useCalls();
  const now = useNow();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [day, setDay] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Stable window for the session; the engine keeps the same one fresh.
  const win = useMemo(() => ConnectEngine.meetingWindow(), []);
  const { meetings, loading } = useMeetings(win.from, win.to);

  const today = startOfDay(new Date(now));
  const strip = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(today, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayKey(today)],
  );
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of meetings)
      if (x.status === 'scheduled') {
        const k = dayKey(new Date(x.startsAt));
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  }, [meetings]);

  const sections = useMemo(() => {
    const list = meetings.filter((m) =>
      day
        ? dayKey(new Date(m.startsAt)) === day
        : tab === 'upcoming'
          ? Date.parse(m.endsAt) > now
          : Date.parse(m.endsAt) <= now,
    );
    if (tab === 'past' && !day) list.reverse();
    const groups = new Map<string, LocalMeeting[]>();
    for (const m of list) {
      const k = dayKey(new Date(m.startsAt));
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    return [...groups.values()].map((data) => ({
      title: dayLabel(new Date(data[0]!.startsAt), new Date(now)),
      data,
    }));
  }, [meetings, tab, day, now]);

  const refresh = async () => {
    setRefreshing(true);
    await engine.refreshMeetings();
    setRefreshing(false);
  };

  const demo = sessionState === 'demo';

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Meetings',
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <Pressable
                onPress={() => router.push('/settings/working-hours')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Working hours"
                style={{ paddingHorizontal: space.sm }}
              >
                <Ionicons name="time-outline" size={23} color={c.accent} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/meetings/new')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Schedule a meeting"
                style={{ paddingHorizontal: space.sm }}
              >
                <Ionicons name="add-circle-outline" size={24} color={c.accent} />
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={{ paddingTop: space.sm }}>
        <ConnectivityBanner />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={{ flexGrow: 0 }}
      >
        {strip.map((d) => {
          const k = dayKey(d);
          const on = day === k;
          const n = countByDay.get(k) ?? 0;
          return (
            <Pressable
              key={k}
              onPress={() => setDay(on ? null : k)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${dayLabel(d)}, ${n} meeting${n === 1 ? '' : 's'}`}
              style={[
                styles.day,
                {
                  backgroundColor: on ? c.accent : c.surfaceRaised,
                  borderColor: on ? c.accent : c.border,
                },
              ]}
            >
              <Text variant="meta" tone={on ? 'onAccent' : 'muted'}>
                {d.toLocaleDateString([], { weekday: 'short' })}
              </Text>
              <Text variant="heading" tone={on ? 'onAccent' : 'default'}>
                {d.getDate()}
              </Text>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: n ? (on ? c.onAccent : c.accent) : 'transparent',
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      {!day ? (
        <View style={styles.tabs}>
          {(['upcoming', 'past'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
              style={[
                styles.tab,
                {
                  backgroundColor: tab === t ? alpha(c.accent, 0.16) : 'transparent',
                  borderColor: tab === t ? alpha(c.accent, 0.5) : c.border,
                },
              ]}
            >
              <Text variant="label" tone={tab === t ? 'accent' : 'muted'}>
                {t === 'upcoming' ? 'Upcoming' : 'Past week'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(m) => m.meetingId}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 120, gap: space.sm }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={c.accent}
          />
        }
        renderSectionHeader={({ section }) => (
          <Text variant="overline" tone="subtle" style={styles.sectionHead}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <MeetingRow m={item} now={now} nameOf={nameOf} canJoin={!!calls.config?.enabled} />
        )}
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.empty}>
              <Ionicons name="calendar-clear-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {day
                  ? 'Nothing scheduled that day.'
                  : tab === 'upcoming'
                    ? demo
                      ? 'No upcoming meetings in the demo workspace.'
                      : engineState?.connectivity === 'offline'
                        ? 'No upcoming meetings saved on this phone. They load when you are online.'
                        : 'No upcoming meetings. Tap + to schedule one.'
                    : 'No meetings in the past week.'}
              </Text>
            </View>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  day: {
    width: 52,
    alignItems: 'center',
    gap: 1,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHead: { marginTop: space.md, marginBottom: space.xs, marginLeft: space.xs },
  empty: { alignItems: 'center', gap: space.md, padding: space.xxl },
});
