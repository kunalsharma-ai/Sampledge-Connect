import { Ionicons } from '@expo/vector-icons';
import type { FileItem, FileKind } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { formatBytes, iconFor, openAttachment, useSignedUrl } from '../components/Attachments';
import { relativeTime } from '../components/ConversationRow';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import type { LocalFile } from '../db/store';
import { FILE_FILTERS, mergeFiles, type FileRow } from '../lib/files';
import { useApp, useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople } from '../state/hooks';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

const PAGE = 40;

/**
 * Every file shared in conversations you can read, newest first: documents, images, audio and
 * video, wherever the bytes live (SampConnect storage or Nextcloud). Offline it lists the files
 * in the messages saved on this phone; files still uploading from this phone show at the top.
 */
export default function Files() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, store, selfId } = useWorkspace();
  const { engineState } = useApp();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [server, setServer] = useState<FileItem[] | null>(null);
  const [phone, setPhone] = useState<LocalFile[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const online = !!engineState?.networkUp;
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(t);
  }, [raw]);

  const query = useMemo(
    () => ({
      q: q || undefined,
      kind: kind === 'all' ? undefined : kind,
      in: conversationId || undefined,
    }),
    [q, kind, conversationId],
  );

  const loadPhone = useCallback(async () => {
    setPhone(await engine.filesOnPhone(query));
  }, [engine, query]);

  const loadServer = useCallback(
    async (before?: string) => {
      if (engine.serverActionBlocker()) {
        setServer(null);
        setNext(null);
        return;
      }
      const g = before ? gen.current : ++gen.current;
      setLoading(true);
      try {
        const page = await engine.listFiles({ ...query, before, limit: PAGE });
        if (g !== gen.current) return;
        setServer((prev) => (before ? [...(prev ?? []), ...page.items] : page.items));
        setNext(page.nextBefore);
        setError(null);
      } catch (e) {
        if (g === gen.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [engine, query],
  );

  useEffect(() => {
    setServer(null);
    void loadPhone();
    void loadServer();
  }, [loadPhone, loadServer, online]);

  // Live: a file sent from any device (or this one) lands in a message; refresh soon after.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = store.events.on('messages', (e) => {
      if (conversationId && e.conversationId !== conversationId) return;
      void loadPhone();
      clearTimeout(t);
      t = setTimeout(() => void loadServer(), 1200);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [store, conversationId, loadPhone, loadServer]);

  const rows = useMemo(() => mergeFiles(server, phone), [server, phone]);
  const placeName = useMemo(() => {
    const m = new Map(conversations.map((x) => [x.conversationId, x]));
    return (id: string) => {
      const conv = m.get(id);
      return conv ? conversationTitle(conv, nameOf, selfId) : 'Conversation';
    };
  }, [conversations, nameOf, selfId]);
  const showingPhone = !server;

  const showInChat = (r: FileRow) =>
    router.push({
      pathname: '/conversation/[id]',
      params: { id: r.conversationId, ...(r.messageId ? { focus: r.messageId } : {}) },
    });

  const renderItem = ({ item: r }: { item: FileRow }) => {
    const by = r.uploaderId === selfId ? 'You' : nameOf(r.uploaderId);
    return (
      <Glass style={styles.row}>
        <Pressable
          onPress={() =>
            void openAttachment(r, (id) => engine.attachmentUrl(id)).catch((e: unknown) =>
              setError(e instanceof Error ? e.message : String(e)),
            )
          }
          accessibilityRole="button"
          accessibilityLabel={`Open ${r.fileName}, ${formatBytes(r.sizeBytes)}`}
          style={styles.open}
        >
          <Thumb r={r} canFetch={online} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {r.fileName}
            </Text>
            <Text variant="meta" tone="muted" numberOfLines={1}>
              {conversationId ? '' : `${placeName(r.conversationId)} · `}
              {by} · {relativeTime(r.createdAt)} · {formatBytes(r.sizeBytes)}
            </Text>
            {r.waiting ? (
              <View style={styles.badgeRow}>
                <Ionicons name="time-outline" size={12} color={c.warning} />
                <Text variant="meta" style={{ color: c.warning }}>
                  Waiting to upload
                </Text>
              </View>
            ) : r.storage === 'nextcloud' ? (
              <View style={styles.badgeRow}>
                <Ionicons name="cloud-outline" size={12} color={c.textSubtle} />
                <Text variant="meta" tone="subtle">
                  Stored in Nextcloud
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => showInChat(r)}
          accessibilityRole="button"
          accessibilityLabel={`Show ${r.fileName} in the conversation`}
          hitSlop={8}
          style={styles.side}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={c.accent} />
        </Pressable>
      </Glass>
    );
  };

  const filtered = !!q || kind !== 'all';
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: title ? `Files · ${title}` : 'Files' }} />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <View style={[styles.box, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.textSubtle} />
          <TextInput
            value={raw}
            onChangeText={setRaw}
            placeholder="Search file names"
            placeholderTextColor={c.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search file names"
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
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          accessibilityRole="tablist"
        >
          {FILE_FILTERS.map((f) => {
            const on = f.key === kind;
            return (
              <Pressable
                key={f.key}
                onPress={() => setKind(f.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                aria-selected={on}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : alpha(c.text, 0.06),
                    borderColor: on ? c.accent : c.border,
                  },
                ]}
              >
                <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: space.sm,
          gap: space.sm,
          paddingBottom: 80,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!server}
            onRefresh={() => {
              void loadPhone();
              void loadServer();
            }}
            tintColor={c.accent}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (next && !loading) void loadServer(next);
        }}
        ListHeaderComponent={
          blocked || error ? (
            <View
              style={[styles.note, { backgroundColor: alpha(error ? c.danger : c.warning, 0.12) }]}
            >
              <Ionicons
                name={error ? 'alert-circle-outline' : 'cloud-offline-outline'}
                size={16}
                color={error ? c.danger : c.warning}
              />
              <Text variant="meta" style={{ color: error ? c.danger : c.warning, flex: 1 }}>
                {error ??
                  (online
                    ? `${blocked} Showing the files saved on this phone.`
                    : 'You are offline. Showing the files saved on this phone. Files others shared open once you are back online.')}
              </Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          !showingPhone || blocked ? (
            <View style={styles.empty}>
              <Ionicons name="folder-open-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {filtered
                  ? 'No files match.'
                  : blocked
                    ? 'No files are saved on this phone yet.'
                    : 'No files yet. Files you and others share in conversations show up here.'}
              </Text>
            </View>
          ) : (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          )
        }
        ListFooterComponent={next && loading ? <ActivityIndicator color={c.accent} /> : undefined}
      />
    </Screen>
  );
}

function Thumb({ r, canFetch }: { r: FileRow; canFetch: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const image = r.kind === 'images';
  const { url } = useSignedUrl(r.attachmentId, image && !r.localUri && canFetch);
  const src = image ? (r.localUri ?? url) : null;
  return (
    <View style={[styles.thumb, { backgroundColor: alpha(c.accent, 0.12) }]}>
      {src ? (
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Ionicons name={iconFor(r.mimeType)} size={20} color={c.accent} />
      )}
    </View>
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
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: space.md },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  side: { padding: space.xs },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    padding: space.md,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
});
