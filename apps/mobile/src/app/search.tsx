import { Ionicons } from '@expo/vector-icons';
import {
  matchRanges,
  snippetAround,
  type ConversationHit,
  type FileHit,
  type MeetingHit,
  type MessageHit,
  type PersonHit,
  type SearchResponse,
  type SearchType,
  type TaskHit,
} from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { formatBytes } from '../components/Attachments';
import { PersonAvatar } from '../components/Avatar';
import { relativeTime } from '../components/ConversationRow';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import type { LocalMessage } from '../db/store';
import { buildSearch, dropOperator, highlightParts, type SearchPlace } from '../lib/search';
import { dayLabel, timeRange } from '../lib/time';
import { useApp, useWorkspace } from '../state/AppProvider';
import {
  conversationTitle,
  useConversations,
  useDirectory,
  usePeople,
  useRecentSearches,
} from '../state/hooks';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Tab = 'all' | SearchType;
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'messages', label: 'Messages' },
  { key: 'people', label: 'People' },
  { key: 'conversations', label: 'Channels & chats' },
  { key: 'files', label: 'Files' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'meetings', label: 'Meetings' },
];
const GROUP_TITLE: Record<SearchType, string> = {
  messages: 'Messages',
  people: 'People',
  conversations: 'Channels & chats',
  files: 'Files',
  tasks: 'Tasks',
  meetings: 'Meetings',
};
const PAGE = 20;

/**
 * Universal Search: messages, people, channels and chats, files, tasks and meetings you may
 * open. Offline it searches the messages saved on this phone, including unsent ones.
 */
export default function Search() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { q: initial } = useLocalSearchParams<{ q?: string }>();
  const { engine, selfId } = useWorkspace();
  const { engineState, session } = useApp();
  const nameOf = usePeople();
  const directory = useDirectory();
  const { conversations } = useConversations();
  const recent = useRecentSearches();
  const [raw, setRaw] = useState(initial ?? '');
  const [tab, setTab] = useState<Tab>('all');
  const [server, setServer] = useState<SearchResponse | null>(null);
  const [extra, setExtra] = useState<SearchResponse | null>(null);
  const [local, setLocal] = useState<LocalMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const people = useMemo(
    () => [
      ...directory,
      ...(session
        ? [{ userId: selfId, displayName: session.user.displayName, email: session.user.email }]
        : []),
    ],
    [directory, selfId, session],
  );
  const placeTitle = (p: SearchPlace) =>
    conversationTitle(
      conversations.find((x) => x.conversationId === p.conversationId) ??
        ({ ...p, name: p.name } as never),
      nameOf,
      selfId,
    );
  const built = useMemo(
    () =>
      buildSearch(raw, {
        people,
        places: conversations,
        selfId,
        placeTitle,
        type: tab === 'all' ? null : tab,
      }),
    // placeTitle only reads conversations and names, both deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, people, conversations, selfId, tab, nameOf],
  );
  const offline = !!engine.serverActionBlocker() || engineState?.connectivity === 'noServer';

  useEffect(() => {
    const id = ++run.current;
    setExtra(null);
    if (built.empty || built.problem) {
      setServer(null);
      setLocal(null);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      // The phone answers at once; the server's answer replaces it when it comes.
      if (tab === 'all' || tab === 'messages')
        void engine.searchOnPhone({ ...built.local, limit: 30 }).then((r) => {
          if (run.current === id) setLocal(r);
        });
      else setLocal(null);
      if (offline) {
        setServer(null);
        return;
      }
      setLoading(true);
      engine
        .search({ ...built.params, limit: tab === 'all' ? 5 : PAGE })
        .then((r) => {
          if (run.current !== id) return;
          setServer(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (run.current !== id) return;
          setServer(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => run.current === id && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [built, engine, offline, tab]);

  const remember = () => {
    if (!built.empty && !built.problem) void engine.rememberSearch(raw);
  };
  const openThen = (go: () => void) => {
    remember();
    go();
  };
  const more = async (type: SearchType) => {
    const base = extra ?? server;
    if (!base) return;
    const r = await engine.search({
      ...built.params,
      types: [type],
      limit: PAGE,
      offset: base[type].items.length,
    });
    setExtra({
      ...base,
      [type]: { items: [...base[type].items, ...r[type].items], more: r[type].more },
    } as SearchResponse);
  };

  const shown = extra ?? server;
  const terms = shown?.terms ?? built.local.terms;
  const counts = (t: SearchType) => shown?.[t].items.length ?? 0;

  const hl = (text: string, ranges: readonly (readonly [number, number])[]) =>
    highlightParts(text, ranges).map((p, i) =>
      p.hit ? (
        <Text
          key={i}
          style={{
            backgroundColor: alpha(c.accent, 0.22),
            color: c.text,
            fontFamily: fonts.semibold,
          }}
        >
          {p.text}
        </Text>
      ) : (
        <Text key={i}>{p.text}</Text>
      ),
    );
  const where = (conversationId: string) => {
    const conv = conversations.find((x) => x.conversationId === conversationId);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'a conversation';
  };

  const row = (key: string, onPress: () => void, label: string, children: React.ReactNode) => (
    <Pressable
      key={key}
      onPress={() => openThen(onPress)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.surfaceSunken },
      ]}
    >
      {children}
    </Pressable>
  );

  const messageRow = (m: MessageHit) =>
    row(
      `m:${m.messageId}`,
      () =>
        router.push({
          pathname: '/conversation/[id]',
          params: { id: m.conversationId, focus: m.messageId },
        }),
      `Message from ${nameOf(m.senderId)} in ${where(m.conversationId)}`,
      <>
        <View style={styles.line}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {nameOf(m.senderId)} ·{' '}
            <Text variant="label" tone="muted">
              {where(m.conversationId)}
            </Text>
          </Text>
          <Text variant="meta" tone="subtle">
            {relativeTime(m.createdAt)}
          </Text>
        </View>
        {m.snippet ? (
          <Text tone="muted" numberOfLines={3}>
            {hl(m.snippet, m.matches)}
          </Text>
        ) : null}
        {m.fileNames.length ? (
          <View style={styles.files}>
            <Ionicons name="attach" size={14} color={c.textSubtle} />
            <Text variant="meta" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {hl(m.fileNames.join(', '), matchRanges(m.fileNames.join(', '), terms))}
            </Text>
          </View>
        ) : null}
      </>,
    );

  const localRow = (m: LocalMessage) => {
    const { snippet, matches } = snippetAround(m.text, terms);
    const names = m.attachments.map((f) => f.fileName).join(', ');
    return row(
      `l:${m.clientId}`,
      () =>
        router.push({
          pathname: '/conversation/[id]',
          params: { id: m.conversationId, ...(m.messageId ? { focus: m.messageId } : {}) },
        }),
      `Message from ${nameOf(m.senderId)} in ${where(m.conversationId)}`,
      <>
        <View style={styles.line}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {nameOf(m.senderId)} ·{' '}
            <Text variant="label" tone="muted">
              {where(m.conversationId)}
            </Text>
          </Text>
          <Text variant="meta" tone="subtle">
            {m.messageId ? relativeTime(m.createdAt) : 'Not sent yet'}
          </Text>
        </View>
        {snippet ? (
          <Text tone="muted" numberOfLines={3}>
            {hl(snippet, matches)}
          </Text>
        ) : null}
        {names ? (
          <View style={styles.files}>
            <Ionicons name="attach" size={14} color={c.textSubtle} />
            <Text variant="meta" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {hl(names, matchRanges(names, terms))}
            </Text>
          </View>
        ) : null}
      </>,
    );
  };

  const personRow = (p: PersonHit) =>
    row(
      `p:${p.userId}`,
      () => router.push({ pathname: '/person/[id]', params: { id: p.userId } }),
      p.displayName,
      <View style={styles.inline}>
        <PersonAvatar userId={p.userId} name={p.displayName} size={36} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{hl(p.displayName, p.matches)}</Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {[p.title, p.email].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>,
    );

  const conversationRow = (h: ConversationHit) => {
    const title = h.name
      ? h.kind.startsWith('channel')
        ? `# ${h.name}`
        : h.name
      : h.memberIds
          .filter((m) => m !== selfId)
          .map((m) => nameOf(m))
          .join(', ');
    return row(
      `c:${h.conversationId}`,
      () => router.push({ pathname: '/conversation/[id]', params: { id: h.conversationId } }),
      title,
      <View style={styles.inline}>
        <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.14) }]}>
          <Ionicons
            name={h.kind.startsWith('channel') ? 'chatbubbles-outline' : 'person-outline'}
            size={18}
            color={c.accent}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{hl(title, matchRanges(title, terms))}</Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {[
              h.topic,
              `${h.memberIds.length} member${h.memberIds.length === 1 ? '' : 's'}`,
              h.isMember ? null : 'You can join',
              h.archived ? 'Archived' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>,
    );
  };

  const fileRow = (f: FileHit) =>
    row(
      `f:${f.attachmentId}`,
      () =>
        router.push({
          pathname: '/conversation/[id]',
          params: { id: f.conversationId, ...(f.messageId ? { focus: f.messageId } : {}) },
        }),
      `${f.fileName}, from ${nameOf(f.uploaderId)}`,
      <View style={styles.inline}>
        <View style={[styles.icon, { backgroundColor: alpha(c.accentSecondary, 0.14) }]}>
          <Ionicons
            name={f.mimeType.startsWith('image/') ? 'image-outline' : 'document-text-outline'}
            size={18}
            color={c.accentSecondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {hl(f.fileName, f.matches)}
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {formatBytes(f.sizeBytes)} · {nameOf(f.uploaderId)} · {where(f.conversationId)} ·{' '}
            {relativeTime(f.createdAt)}
          </Text>
        </View>
      </View>,
    );

  const taskRow = (t: TaskHit) =>
    row(
      `t:${t.taskId}`,
      () => router.push({ pathname: '/task/[id]', params: { id: t.taskId } }),
      t.title,
      <View style={styles.inline}>
        <View style={[styles.icon, { backgroundColor: alpha(c.success, 0.14) }]}>
          <Ionicons
            name={t.status === 'done' ? 'checkmark-done-outline' : 'checkbox-outline'}
            size={18}
            color={c.success}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {hl(t.title, t.matches)}
          </Text>
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {[
              t.status.replace(/_/g, ' '),
              t.dueAt ? `due ${dayLabel(new Date(t.dueAt))}` : null,
              t.assigneeIds.length ? t.assigneeIds.map((a) => nameOf(a)).join(', ') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>,
    );

  const meetingRow = (m: MeetingHit) =>
    row(
      `mt:${m.meetingId}`,
      () => router.push({ pathname: '/meeting/[id]', params: { id: m.meetingId } }),
      m.title,
      <View style={styles.inline}>
        <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.14) }]}>
          <Ionicons name="calendar-outline" size={18} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            style={m.status === 'cancelled' ? { textDecorationLine: 'line-through' } : undefined}
          >
            {hl(m.title, m.matches)}
          </Text>
          <Text variant="meta" tone="muted">
            {dayLabel(new Date(m.startsAt))} · {timeRange(m.startsAt, m.endsAt)}
            {m.status === 'cancelled' ? ' · Cancelled' : ''}
          </Text>
        </View>
      </View>,
    );

  const renderGroup = (t: SearchType) => {
    if (!shown) return null;
    const g = shown[t];
    if (!g.items.length) return null;
    const items =
      t === 'messages'
        ? (g.items as MessageHit[]).map(messageRow)
        : t === 'people'
          ? (g.items as PersonHit[]).map(personRow)
          : t === 'conversations'
            ? (g.items as ConversationHit[]).map(conversationRow)
            : t === 'files'
              ? (g.items as FileHit[]).map(fileRow)
              : t === 'tasks'
                ? (g.items as TaskHit[]).map(taskRow)
                : (g.items as MeetingHit[]).map(meetingRow);
    return (
      <View key={t} style={{ gap: space.xs }}>
        <View style={styles.groupHead}>
          <Text variant="overline" tone="subtle">
            {GROUP_TITLE[t]}
          </Text>
          {g.more ? (
            <Pressable
              onPress={() => (tab === 'all' ? setTab(t) : void more(t))}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text variant="label" tone="accent">
                {tab === 'all' ? 'See all' : 'Show more'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View style={[styles.group, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          {items}
        </View>
      </View>
    );
  };

  const types: SearchType[] =
    tab === 'all' ? ['people', 'conversations', 'messages', 'files', 'tasks', 'meetings'] : [tab];
  const nothing = !!shown && types.every((t) => shown[t].items.length === 0) && !loading && !error;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Search' }} />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <View style={[styles.box, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.textSubtle} />
          <TextInput
            autoFocus
            value={raw}
            onChangeText={setRaw}
            onSubmitEditing={remember}
            placeholder="Search messages, people, files…"
            placeholderTextColor={c.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search everything"
            style={[styles.input, { color: c.text }]}
          />
          {raw ? (
            <Pressable
              onPress={() => setRaw('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={c.textSubtle} />
            </Pressable>
          ) : null}
        </View>
        {built.filters.length ? (
          <View style={styles.chips}>
            {built.filters.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setRaw((r) => dropOperator(r, f.key))}
                accessibilityRole="button"
                accessibilityLabel={`Remove filter ${f.label}`}
                style={[
                  styles.chip,
                  { backgroundColor: alpha(c.accent, 0.14), borderColor: alpha(c.accent, 0.4) },
                ]}
              >
                <Text variant="label" tone="accent">
                  {f.label}
                </Text>
                <Ionicons name="close" size={13} color={c.accent} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {!built.empty ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
            accessibilityRole="tablist"
          >
            {TABS.map((t) => {
              const on = tab === t.key;
              const n = t.key === 'all' || !server || tab !== 'all' ? null : counts(t.key);
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  aria-selected={on}
                  style={[
                    styles.tab,
                    {
                      backgroundColor: on ? c.accent : c.surfaceRaised,
                      borderColor: on ? c.accent : c.border,
                    },
                  ]}
                >
                  <Text variant="label" tone={on ? 'onAccent' : 'default'}>
                    {t.label}
                    {n ? ` ${n}${server?.[t.key as SearchType].more ? '+' : ''}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
      >
        {built.problem ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {built.problem}
          </Text>
        ) : built.empty ? (
          <View style={{ gap: space.md }}>
            {recent.length ? (
              <View style={{ gap: space.xs }}>
                <View style={styles.groupHead}>
                  <Text variant="overline" tone="subtle">
                    Recent searches
                  </Text>
                  <Pressable
                    onPress={() => void engine.clearRecentSearches()}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text variant="label" tone="accent">
                      Clear all
                    </Text>
                  </Pressable>
                </View>
                <View
                  style={[
                    styles.group,
                    { backgroundColor: c.surfaceRaised, borderColor: c.border },
                  ]}
                >
                  {recent.map((r) => (
                    <View key={r} style={[styles.recent, { borderBottomColor: c.border }]}>
                      <Pressable
                        onPress={() => setRaw(r)}
                        accessibilityRole="button"
                        accessibilityLabel={`Search again for ${r}`}
                        style={styles.inline}
                      >
                        <Ionicons name="time-outline" size={16} color={c.textSubtle} />
                        <Text numberOfLines={1} style={{ flex: 1 }}>
                          {r}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void engine.forgetSearch(r)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${r} from recent searches`}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={16} color={c.textSubtle} />
                      </Pressable>
                    </View>
                  ))}
                </View>
                <Text variant="meta" tone="subtle">
                  Recent searches follow you to your other devices.
                </Text>
              </View>
            ) : null}
            <View style={[styles.tips, { backgroundColor: c.surfaceSunken }]}>
              <Text variant="label">Narrow it down</Text>
              <Text variant="meta" tone="muted">
                from:@name · in:#channel · has:file · after:2026-10-01 · before:2026-11-01 ·
                &quot;exact phrase&quot;
              </Text>
            </View>
          </View>
        ) : (
          <>
            {offline ? (
              <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
                <Ionicons name="cloud-offline-outline" size={16} color={c.warning} />
                <Text variant="meta" style={{ color: c.warning, flex: 1 }}>
                  You’re offline, so only messages saved on this phone are searched.
                </Text>
              </View>
            ) : null}
            {error && !offline ? (
              <Text variant="meta" tone="danger">
                {error}
              </Text>
            ) : null}
            {!shown && local && local.length ? (
              <View style={{ gap: space.xs }}>
                <Text variant="overline" tone="subtle">
                  Messages on this phone
                </Text>
                <View
                  style={[
                    styles.group,
                    { backgroundColor: c.surfaceRaised, borderColor: c.border },
                  ]}
                >
                  {local.map(localRow)}
                </View>
              </View>
            ) : null}
            {!shown && local && local.length === 0 && (offline || !loading) ? (
              <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
                No messages on this phone match.
              </Text>
            ) : null}
            {types.map(renderGroup)}
            {nothing ? (
              <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
                Nothing you can open matches “{raw.trim()}”.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: space.xs,
  },
  row: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  files: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tips: { padding: space.md, borderRadius: radius.md, gap: 4 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
});
